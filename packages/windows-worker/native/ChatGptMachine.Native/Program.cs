using System.Text.Json;

namespace ChatGptMachine.Native;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    [STAThread]
    private static async Task<int> Main()
    {
        Console.InputEncoding = System.Text.Encoding.UTF8;
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        try
        {
            var line = await Console.In.ReadLineAsync();
            if (string.IsNullOrWhiteSpace(line)) throw new InvalidOperationException("A JSON request line is required.");
            using var request = JsonDocument.Parse(line);
            var root = request.RootElement;
            var id = root.GetProperty("id").GetString() ?? throw new InvalidOperationException("Request id is required.");
            var method = root.GetProperty("method").GetString() ?? throw new InvalidOperationException("Method is required.");
            var parameters = root.TryGetProperty("params", out var value) ? value : default;
            object? result = method switch
            {
                "process.run" => await SandboxRunner.RunAsync(parameters),
                "desktop.status" => DesktopAutomation.Status(),
                "desktop.list_windows" => DesktopAutomation.ListWindows(),
                "desktop.window_info" => DesktopAutomation.WindowInfo(parameters),
                "desktop.capture" => DesktopAutomation.Capture(parameters),
                "desktop.focus" => DesktopAutomation.Focus(parameters),
                "desktop.click" => DesktopAutomation.Click(parameters),
                "desktop.scroll" => DesktopAutomation.Scroll(parameters),
                "desktop.drag" => await DesktopAutomation.DragAsync(parameters),
                "desktop.type" => await DesktopAutomation.TypeAsync(parameters),
                "desktop.key" => DesktopAutomation.Key(parameters),
                "desktop.launch" => DesktopAutomation.Launch(parameters),
                "clipboard.read" => DesktopAutomation.ClipboardRead(),
                "clipboard.write" => DesktopAutomation.ClipboardWrite(parameters),
                "credential.store" => CredentialStore.Store(parameters),
                "credential.read" => CredentialStore.Read(),
                "credential.protect" => CredentialStore.Protect(parameters),
                "credential.unprotect" => CredentialStore.Unprotect(parameters),
                "credential.test" => CredentialStore.Test(),
                _ => throw new InvalidOperationException($"Unknown native method: {method}")
            };
            await Console.Out.WriteLineAsync(JsonSerializer.Serialize(new { id, ok = true, result }, JsonOptions));
            return 0;
        }
        catch (Exception exception)
        {
            await Console.Out.WriteLineAsync(JsonSerializer.Serialize(new
            {
                id = "unknown",
                ok = false,
                error = new { code = "NATIVE_ERROR", message = exception.Message }
            }, JsonOptions));
            return 1;
        }
    }
}
