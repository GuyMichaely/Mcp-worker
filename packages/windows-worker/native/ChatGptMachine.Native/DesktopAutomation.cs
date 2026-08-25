using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace ChatGptMachine.Native;

internal static class DesktopAutomation
{
    private sealed record Bounds(int X, int Y, int Width, int Height);
    private sealed record Window(string WindowId, string Title, int ProcessId, string Executable, bool Visible, bool Minimized, Bounds Bounds);
    private sealed record Frame(long Hwnd, int X, int Y, int Width, int Height, long Created);

    internal static object Status() => new
    {
        interactive = Environment.UserInteractive,
        foreground_window = FormatHwnd(NativeMethods.GetForegroundWindow()),
        session_id = Process.GetCurrentProcess().SessionId
    };

    internal static IReadOnlyList<object> ListWindows()
    {
        var windows = new List<object>();
        NativeMethods.EnumWindows((hwnd, _) =>
        {
            try
            {
                if (NativeMethods.IsWindowVisible(hwnd) && NativeMethods.GetWindowTextLengthW(hwnd) > 0) windows.Add(Describe(hwnd));
            }
            catch { }
            return true;
        }, IntPtr.Zero);
        return windows;
    }

    internal static object WindowInfo(JsonElement parameters) => Describe(ParseHwnd(parameters.GetProperty("window_id").GetString()));

    internal static object Capture(JsonElement parameters)
    {
        IntPtr hwnd = IntPtr.Zero;
        Rectangle rectangle;
        if (parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty("window_id", out var id) && id.ValueKind == JsonValueKind.String)
        {
            hwnd = ParseHwnd(id.GetString());
            rectangle = GetRectangle(hwnd);
        }
        else rectangle = SystemInformation.VirtualScreen;
        if (rectangle.Width <= 0 || rectangle.Height <= 0) throw new InvalidOperationException("The capture area is empty.");
        using var bitmap = new Bitmap(rectangle.Width, rectangle.Height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(rectangle.Location, Point.Empty, rectangle.Size, CopyPixelOperation.SourceCopy);
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        var frame = new Frame(hwnd.ToInt64(), rectangle.X, rectangle.Y, rectangle.Width, rectangle.Height, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        return new { png_base64 = Convert.ToBase64String(stream.ToArray()), frame_id = EncodeFrame(frame), width = rectangle.Width, height = rectangle.Height };
    }

    internal static object Focus(JsonElement parameters)
    {
        var hwnd = ParseHwnd(parameters.GetProperty("window_id").GetString());
        NativeMethods.ShowWindow(hwnd, NativeMethods.SW_RESTORE);
        if (!NativeMethods.SetForegroundWindow(hwnd)) throw new InvalidOperationException("Windows refused to focus the requested window.");
        return new { focused = true, window_id = FormatHwnd(hwnd) };
    }

    internal static object Click(JsonElement parameters)
    {
        var hwnd = ParseHwnd(parameters.GetProperty("window_id").GetString());
        var frame = ValidateFrame(parameters.GetProperty("frame_id").GetString(), hwnd);
        var x = parameters.GetProperty("x").GetInt32();
        var y = parameters.GetProperty("y").GetInt32();
        if (x < 0 || y < 0 || x >= frame.Width || y >= frame.Height) throw new InvalidOperationException("Click coordinates fall outside the captured frame.");
        FocusWindow(hwnd);
        NativeMethods.SetCursorPos(frame.X + x, frame.Y + y);
        var button = parameters.GetProperty("button").GetString() ?? "left";
        var clicks = parameters.GetProperty("clicks").GetInt32();
        var (down, up) = button switch
        {
            "right" => (NativeMethods.MOUSEEVENTF_RIGHTDOWN, NativeMethods.MOUSEEVENTF_RIGHTUP),
            "middle" => (NativeMethods.MOUSEEVENTF_MIDDLEDOWN, NativeMethods.MOUSEEVENTF_MIDDLEUP),
            _ => (NativeMethods.MOUSEEVENTF_LEFTDOWN, NativeMethods.MOUSEEVENTF_LEFTUP)
        };
        for (var i = 0; i < clicks; i++) SendMouse(down, 0, up);
        return new { clicked = true };
    }

    internal static object Scroll(JsonElement parameters)
    {
        var hwnd = ParseHwnd(parameters.GetProperty("window_id").GetString());
        var frame = ValidateFrame(parameters.GetProperty("frame_id").GetString(), hwnd);
        var x = parameters.GetProperty("x").GetInt32();
        var y = parameters.GetProperty("y").GetInt32();
        FocusWindow(hwnd);
        NativeMethods.SetCursorPos(frame.X + x, frame.Y + y);
        SendMouse(NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)parameters.GetProperty("delta").GetInt32()));
        return new { scrolled = true };
    }

    internal static async Task<object> DragAsync(JsonElement parameters)
    {
        var hwnd = ParseHwnd(parameters.GetProperty("window_id").GetString());
        var frame = ValidateFrame(parameters.GetProperty("frame_id").GetString(), hwnd);
        var startX = parameters.GetProperty("start_x").GetInt32();
        var startY = parameters.GetProperty("start_y").GetInt32();
        var endX = parameters.GetProperty("end_x").GetInt32();
        var endY = parameters.GetProperty("end_y").GetInt32();
        if (new[] { startX, endX }.Any(value => value < 0 || value >= frame.Width) || new[] { startY, endY }.Any(value => value < 0 || value >= frame.Height)) throw new InvalidOperationException("Drag coordinates fall outside the captured frame.");
        var duration = parameters.GetProperty("duration_ms").GetInt32();
        FocusWindow(hwnd);
        NativeMethods.SetCursorPos(frame.X + startX, frame.Y + startY);
        SendMouse(NativeMethods.MOUSEEVENTF_LEFTDOWN);
        var steps = Math.Max(2, duration / 16);
        for (var step = 1; step <= steps; step++)
        {
            var fraction = (double)step / steps;
            NativeMethods.SetCursorPos(frame.X + (int)Math.Round(startX + (endX - startX) * fraction), frame.Y + (int)Math.Round(startY + (endY - startY) * fraction));
            await Task.Delay(Math.Max(1, duration / steps));
        }
        SendMouse(NativeMethods.MOUSEEVENTF_LEFTUP);
        return new { dragged = true };
    }

    internal static async Task<object> TypeAsync(JsonElement parameters)
    {
        var hwnd = ParseHwnd(parameters.GetProperty("window_id").GetString());
        var text = parameters.GetProperty("text").GetString() ?? "";
        var interval = parameters.GetProperty("interval_ms").GetInt32();
        FocusWindow(hwnd);
        foreach (var character in text)
        {
            SendKey(0, character, NativeMethods.KEYEVENTF_UNICODE);
            SendKey(0, character, NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP);
            if (interval > 0) await Task.Delay(interval);
        }
        return new { characters_typed = text.Length };
    }

    internal static object Key(JsonElement parameters)
    {
        var hwnd = ParseHwnd(parameters.GetProperty("window_id").GetString());
        var keys = parameters.GetProperty("keys").EnumerateArray().Select(value => ParseVirtualKey(value.GetString())).ToArray();
        FocusWindow(hwnd);
        foreach (var key in keys) SendKey(key, '\0', 0);
        foreach (var key in keys.Reverse()) SendKey(key, '\0', NativeMethods.KEYEVENTF_KEYUP);
        return new { sent = keys.Length };
    }

    internal static object Launch(JsonElement parameters)
    {
        var executable = parameters.GetProperty("executable").GetString() ?? throw new InvalidOperationException("Executable is required.");
        var start = new ProcessStartInfo(executable) { UseShellExecute = false };
        foreach (var argument in parameters.GetProperty("args").EnumerateArray()) start.ArgumentList.Add(argument.GetString() ?? "");
        var process = Process.Start(start) ?? throw new InvalidOperationException("Windows did not start the application.");
        return new { process_id = process.Id };
    }

    internal static object ClipboardRead()
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            try { return new { text = Clipboard.ContainsText() ? Clipboard.GetText() : "" }; }
            catch (ExternalException) { Thread.Sleep(50); }
        }
        throw new InvalidOperationException("The clipboard is busy.");
    }

    internal static object ClipboardWrite(JsonElement parameters)
    {
        var text = parameters.GetProperty("text").GetString() ?? "";
        for (var attempt = 0; attempt < 10; attempt++)
        {
            try { Clipboard.SetText(text); return new { characters_written = text.Length }; }
            catch (ExternalException) { Thread.Sleep(50); }
        }
        throw new InvalidOperationException("The clipboard is busy.");
    }

    private static object Describe(IntPtr hwnd)
    {
        NativeMethods.GetWindowThreadProcessId(hwnd, out var processId);
        var process = Process.GetProcessById((int)processId);
        var length = NativeMethods.GetWindowTextLengthW(hwnd);
        var title = new StringBuilder(length + 1);
        NativeMethods.GetWindowTextW(hwnd, title, title.Capacity);
        string executable;
        try { executable = process.MainModule?.FileName ?? process.ProcessName; } catch { executable = process.ProcessName; }
        var rect = GetRectangle(hwnd);
        return new Window(FormatHwnd(hwnd), title.ToString(), (int)processId, executable, NativeMethods.IsWindowVisible(hwnd),
            (NativeMethods.GetWindowLongPtrW(hwnd, NativeMethods.GWL_STYLE) & NativeMethods.WS_MINIMIZE) != 0,
            new Bounds(rect.X, rect.Y, rect.Width, rect.Height));
    }

    private static Rectangle GetRectangle(IntPtr hwnd)
    {
        if (!NativeMethods.GetWindowRect(hwnd, out var rect)) throw new InvalidOperationException("The window no longer exists.");
        return Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
    }
    private static string FormatHwnd(IntPtr hwnd) => $"0x{hwnd.ToInt64():X}";
    private static IntPtr ParseHwnd(string? value) => value is not null && value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
        ? new IntPtr(Convert.ToInt64(value[2..], 16)) : throw new InvalidOperationException("Invalid window id.");
    private static string EncodeFrame(Frame frame) => Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(frame)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static Frame ValidateFrame(string? value, IntPtr hwnd)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("A recent frame id is required.");
        var padded = value.Replace('-', '+').Replace('_', '/').PadRight((value.Length + 3) / 4 * 4, '=');
        var frame = JsonSerializer.Deserialize<Frame>(Convert.FromBase64String(padded)) ?? throw new InvalidOperationException("Invalid frame id.");
        if (frame.Hwnd != hwnd.ToInt64() || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - frame.Created > 30_000) throw new InvalidOperationException("The captured frame is stale or belongs to another window.");
        var current = GetRectangle(hwnd);
        if (current.X != frame.X || current.Y != frame.Y || current.Width != frame.Width || current.Height != frame.Height) throw new InvalidOperationException("The window moved or resized after capture. Capture it again.");
        return frame;
    }
    private static void FocusWindow(IntPtr hwnd) { NativeMethods.ShowWindow(hwnd, NativeMethods.SW_RESTORE); if (!NativeMethods.SetForegroundWindow(hwnd)) throw new InvalidOperationException("Windows refused to focus the requested window."); Thread.Sleep(75); }
    private static void SendMouse(uint first, uint data = 0, uint second = 0)
    {
        var inputs = second == 0 ? new[] { Mouse(first, data) } : new[] { Mouse(first, data), Mouse(second, 0) };
        if (NativeMethods.SendInput((uint)inputs.Length, inputs, System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.INPUT>()) != inputs.Length) throw new InvalidOperationException("Windows rejected mouse input.");
    }
    private static NativeMethods.INPUT Mouse(uint flags, uint data) => new() { type = NativeMethods.INPUT_MOUSE, U = new NativeMethods.InputUnion { mi = new NativeMethods.MOUSEINPUT { dwFlags = flags, mouseData = data } } };
    private static void SendKey(ushort key, char scan, uint flags)
    {
        var input = new[] { new NativeMethods.INPUT { type = NativeMethods.INPUT_KEYBOARD, U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = key, wScan = scan, dwFlags = flags } } } };
        if (NativeMethods.SendInput(1, input, System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.INPUT>()) != 1) throw new InvalidOperationException("Windows rejected keyboard input.");
    }
    private static ushort ParseVirtualKey(string? name)
    {
        var normalized = name?.Trim().ToUpperInvariant() ?? "";
        normalized = normalized switch { "CTRL" => "CONTROLKEY", "CONTROL" => "CONTROLKEY", "ALT" => "MENU", "WIN" => "LWIN", "ESC" => "ESCAPE", "RETURN" => "ENTER", _ => normalized };
        if (Enum.TryParse<Keys>(normalized, true, out var key)) return unchecked((ushort)key);
        if (normalized.Length == 1) return unchecked((ushort)char.ToUpperInvariant(normalized[0]));
        throw new InvalidOperationException($"Unknown key: {name}");
    }
}
