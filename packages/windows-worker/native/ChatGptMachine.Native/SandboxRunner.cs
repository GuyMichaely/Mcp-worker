using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace ChatGptMachine.Native;

internal static class SandboxRunner
{
    private const string ProfileName = "ChatGptMachineMcp.Strict";
    private const int AlreadyExists = unchecked((int)0x800700B7);

    internal static async Task<object> RunAsync(JsonElement parameters)
    {
        var executable = parameters.GetProperty("executable").GetString() ?? throw new InvalidOperationException("Executable is required.");
        var arguments = parameters.GetProperty("args").EnumerateArray().Select(value => value.GetString() ?? "").ToArray();
        var cwd = Path.GetFullPath(parameters.GetProperty("cwd").GetString() ?? throw new InvalidOperationException("cwd is required."));
        var allowed = parameters.GetProperty("read_write_paths").EnumerateArray().Select(value => Path.GetFullPath(value.GetString() ?? "")).ToArray();
        if (!allowed.Any(root => IsWithin(cwd, root))) throw new InvalidOperationException("SANDBOX_DENIED: cwd is outside the declared read/write paths.");
        foreach (var root in allowed) GrantWorkspaceAccess(root);

        var appSid = GetAppContainerSid();
        IntPtr capabilitySid = IntPtr.Zero, capabilityArray = IntPtr.Zero, securityPointer = IntPtr.Zero, attributeList = IntPtr.Zero, environmentPointer = IntPtr.Zero;
        SafeFileHandle? stdinRead = null, stdinWrite = null, stdoutRead = null, stdoutWrite = null, stderrRead = null, stderrWrite = null;
        NativeMethods.PROCESS_INFORMATION processInfo = default;
        try
        {
            var network = parameters.GetProperty("network").GetBoolean();
            uint capabilityCount = 0;
            if (network)
            {
                if (!NativeMethods.ConvertStringSidToSidW("S-1-15-3-1", out capabilitySid)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var capability = new NativeMethods.SID_AND_ATTRIBUTES { Sid = capabilitySid, Attributes = 0x00000004 };
                capabilityArray = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.SID_AND_ATTRIBUTES>());
                Marshal.StructureToPtr(capability, capabilityArray, false);
                capabilityCount = 1;
            }
            var security = new NativeMethods.SECURITY_CAPABILITIES { AppContainerSid = appSid, Capabilities = capabilityArray, CapabilityCount = capabilityCount };
            securityPointer = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.SECURITY_CAPABILITIES>());
            Marshal.StructureToPtr(security, securityPointer, false);
            IntPtr attributeSize = IntPtr.Zero;
            NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            attributeList = Marshal.AllocHGlobal(attributeSize);
            if (!NativeMethods.InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!NativeMethods.UpdateProcThreadAttribute(attributeList, 0, (IntPtr)NativeMethods.PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, securityPointer, (IntPtr)Marshal.SizeOf<NativeMethods.SECURITY_CAPABILITIES>(), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());

            CreatePipe(out stdoutRead, out stdoutWrite);
            CreatePipe(out stderrRead, out stderrWrite);
            CreateInputPipe(out stdinRead, out stdinWrite);
            var startup = new NativeMethods.STARTUPINFOEX
            {
                StartupInfo = new NativeMethods.STARTUPINFO
                {
                    cb = Marshal.SizeOf<NativeMethods.STARTUPINFOEX>(), dwFlags = NativeMethods.STARTF_USESTDHANDLES,
                    hStdInput = stdinRead.DangerousGetHandle(), hStdOutput = stdoutWrite.DangerousGetHandle(), hStdError = stderrWrite.DangerousGetHandle()
                },
                lpAttributeList = attributeList
            };
            var commandLine = new StringBuilder(string.Join(" ", new[] { Quote(executable) }.Concat(arguments.Select(Quote))));
            environmentPointer = BuildEnvironment(parameters);
            if (!NativeMethods.CreateProcessW(null, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                NativeMethods.EXTENDED_STARTUPINFO_PRESENT | NativeMethods.CREATE_NO_WINDOW | NativeMethods.CREATE_UNICODE_ENVIRONMENT,
                environmentPointer, cwd, ref startup, out processInfo)) throw new Win32Exception(Marshal.GetLastWin32Error());
            stdoutWrite.Dispose(); stdoutWrite = null;
            stderrWrite.Dispose(); stderrWrite = null;
            stdinRead.Dispose(); stdinRead = null;
            NativeMethods.CloseHandle(processInfo.hThread);
            var stdoutTask = ReadPipeAsync(stdoutRead);
            var stderrTask = ReadPipeAsync(stderrRead);
            var stdinTask = WritePipeAsync(stdinWrite, parameters.TryGetProperty("stdin", out var stdinValue) ? stdinValue.GetString() ?? "" : "");
            stdinWrite = null;
            var timeout = parameters.GetProperty("timeout_ms").GetInt32();
            var wait = NativeMethods.WaitForSingleObject(processInfo.hProcess, unchecked((uint)timeout));
            var timedOut = wait == 0x00000102;
            if (timedOut) NativeMethods.TerminateProcess(processInfo.hProcess, 124);
            NativeMethods.WaitForSingleObject(processInfo.hProcess, 10_000);
            NativeMethods.GetExitCodeProcess(processInfo.hProcess, out var exitCode);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            await stdinTask;
            return new { exit_code = unchecked((int)exitCode), timed_out = timedOut, stdout, stderr, sandbox = "appcontainer", network };
        }
        finally
        {
            stdinRead?.Dispose(); stdinWrite?.Dispose(); stdoutRead?.Dispose(); stdoutWrite?.Dispose(); stderrRead?.Dispose(); stderrWrite?.Dispose();
            if (processInfo.hProcess != IntPtr.Zero) NativeMethods.CloseHandle(processInfo.hProcess);
            if (attributeList != IntPtr.Zero) { NativeMethods.DeleteProcThreadAttributeList(attributeList); Marshal.FreeHGlobal(attributeList); }
            if (securityPointer != IntPtr.Zero) Marshal.FreeHGlobal(securityPointer);
            if (capabilityArray != IntPtr.Zero) Marshal.FreeHGlobal(capabilityArray);
            if (capabilitySid != IntPtr.Zero) NativeMethods.LocalFree(capabilitySid);
            if (appSid != IntPtr.Zero) NativeMethods.LocalFree(appSid);
            if (environmentPointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentPointer);
        }
    }

    private static IntPtr GetAppContainerSid()
    {
        var result = NativeMethods.CreateAppContainerProfile(ProfileName, "ChatGPT Machine MCP strict sandbox", "Isolates commands requested through the MCP server.", IntPtr.Zero, 0, out var sid);
        if (result == AlreadyExists) result = NativeMethods.DeriveAppContainerSidFromAppContainerName(ProfileName, out sid);
        if (result < 0) Marshal.ThrowExceptionForHR(result);
        return sid;
    }

    private static void GrantWorkspaceAccess(string root)
    {
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException(root);
        var sid = GetAppContainerSid();
        try
        {
            var sidText = new System.Security.Principal.SecurityIdentifier(sid).Value;
            var start = new ProcessStartInfo("icacls.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(root); start.ArgumentList.Add("/grant"); start.ArgumentList.Add($"*{sidText}:(OI)(CI)M"); start.ArgumentList.Add("/q");
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start icacls.");
            process.WaitForExit();
            if (process.ExitCode != 0) throw new InvalidOperationException($"Could not grant the strict sandbox access to {root}: {process.StandardError.ReadToEnd()}");
        }
        finally { NativeMethods.LocalFree(sid); }
    }

    private static bool IsWithin(string candidate, string root)
    {
        var normalizedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        return candidate.Equals(normalizedRoot, StringComparison.OrdinalIgnoreCase) || candidate.StartsWith(normalizedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }
    private static string Quote(string value) => value.Length > 0 && !value.Any(character => char.IsWhiteSpace(character) || character == '"') ? value : "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    private static void CreatePipe(out SafeFileHandle read, out SafeFileHandle write)
    {
        var attributes = new NativeMethods.SECURITY_ATTRIBUTES { Length = Marshal.SizeOf<NativeMethods.SECURITY_ATTRIBUTES>(), InheritHandle = true };
        if (!NativeMethods.CreatePipe(out read, out write, ref attributes, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!NativeMethods.SetHandleInformation(read, NativeMethods.HANDLE_FLAG_INHERIT, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    private static void CreateInputPipe(out SafeFileHandle read, out SafeFileHandle write)
    {
        var attributes = new NativeMethods.SECURITY_ATTRIBUTES { Length = Marshal.SizeOf<NativeMethods.SECURITY_ATTRIBUTES>(), InheritHandle = true };
        if (!NativeMethods.CreatePipe(out read, out write, ref attributes, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!NativeMethods.SetHandleInformation(write, NativeMethods.HANDLE_FLAG_INHERIT, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    private static async Task WritePipeAsync(SafeFileHandle handle, string input)
    {
        await using var stream = new FileStream(handle, FileAccess.Write, 65_536, false);
        var bytes = Encoding.UTF8.GetBytes(input);
        await stream.WriteAsync(bytes);
    }
    private static async Task<string> ReadPipeAsync(SafeFileHandle handle)
    {
        await using var stream = new FileStream(handle, FileAccess.Read, 65_536, false);
        using var reader = new StreamReader(stream, Encoding.UTF8, true, 65_536, false);
        var buffer = new char[65_536];
        var output = new StringBuilder();
        while (output.Length < 16_777_216)
        {
            var read = await reader.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, 16_777_216 - output.Length)));
            if (read == 0) break;
            output.Append(buffer, 0, read);
        }
        return output.ToString();
    }
    private static IntPtr BuildEnvironment(JsonElement parameters)
    {
        var environment = Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string && entry.Value is string)
            .ToDictionary(entry => (string)entry.Key, entry => (string)entry.Value!, StringComparer.OrdinalIgnoreCase);
        if (parameters.TryGetProperty("environment", out var supplied)) foreach (var property in supplied.EnumerateObject()) environment[property.Name] = property.Value.GetString() ?? "";
        var block = string.Join('\0', environment.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase).Select(pair => $"{pair.Key}={pair.Value}")) + "\0\0";
        return Marshal.StringToHGlobalUni(block);
    }
}
