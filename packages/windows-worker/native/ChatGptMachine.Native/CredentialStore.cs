using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ChatGptMachine.Native;

internal static class CredentialStore
{
    private const string Target = "ChatGptMachineMcp.WorkerRelay";

    internal static object Store(JsonElement parameters)
    {
        var secret = parameters.GetProperty("secret").GetString() ?? throw new InvalidOperationException("Secret is required.");
        Write(Target, secret);
        return new { target = Target };
    }

    internal static object Test()
    {
        var target = $"ChatGptMachineMcp.Test.{Guid.NewGuid():N}";
        try
        {
            Write(target, "credential-manager-test");
            if (!NativeMethods.CredReadW(target, 1, 0, out var pointer)) throw new Win32Exception(Marshal.GetLastWin32Error());
            NativeMethods.CredFree(pointer);
            return new { available = true };
        }
        finally { NativeMethods.CredDeleteW(target, 1, 0); }
    }

    private static void Write(string target, string secret)
    {
        var bytes = Encoding.Unicode.GetBytes(secret);
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            var credential = new NativeMethods.CREDENTIAL
            {
                Type = 1,
                TargetName = target,
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = pointer,
                Persist = 2,
                UserName = Environment.UserName
            };
            if (!NativeMethods.CredWriteW(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            Marshal.FreeHGlobal(pointer);
        }
    }

    internal static object Read()
    {
        if (!NativeMethods.CredReadW(Target, 1, 0, out var pointer)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var credential = Marshal.PtrToStructure<NativeMethods.CREDENTIAL>(pointer);
            var bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            try { return new { secret = Encoding.Unicode.GetString(bytes) }; }
            finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        finally { NativeMethods.CredFree(pointer); }
    }

    internal static object Protect(JsonElement parameters)
    {
        var secret = parameters.GetProperty("secret").GetString() ?? throw new InvalidOperationException("Secret is required.");
        var plain = Encoding.UTF8.GetBytes(secret);
        try { return new { protected_base64 = Convert.ToBase64String(ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser)) }; }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }

    internal static object Unprotect(JsonElement parameters)
    {
        var encrypted = Convert.FromBase64String(parameters.GetProperty("protected_base64").GetString() ?? "");
        var plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
        try { return new { secret = Encoding.UTF8.GetString(plain) }; }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }
}
