#if DESK_TEST
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using LiveDesk.Win;

namespace LiveDesk;

/// <summary>Only in a test build: lets a test drive the app, one command a line. Never in the app
/// people install (build.ps1 does not set DESK_TEST). Keys and clicks go only to a window whose title
/// has the test's marker: the tests run on a computer someone is using.</summary>
internal static class TestPipe
{
    [DllImport("user32")] private static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32")] private static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra);
    [DllImport("user32")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32")] private static extern bool EnumWindows(EnumProc proc, IntPtr data);
    [DllImport("user32")] private static extern bool IsWindowVisible(IntPtr h);
    private delegate bool EnumProc(IntPtr h, IntPtr data);

    private static string Marker => Environment.GetEnvironmentVariable("KIASA_DESK_ONLY_INTO") ?? "\0";

    public static void Start(MainWindow window)
    {
        var thread = new Thread(() =>
        {
            while (true)
            {
                using var pipe = new NamedPipeServerStream("kiasa-desk-test", PipeDirection.InOut);
                pipe.WaitForConnection();
                using var reader = new StreamReader(pipe);
                using var writer = new StreamWriter(pipe) { AutoFlush = true };
                string? line;
                while ((line = reader.ReadLine()) != null)
                {
                    var parts = line.Split(' ');
                    var answer = Off(parts) ?? window.Dispatcher.Invoke(() => Do(window, parts));
                    writer.WriteLine(JsonSerializer.Serialize(answer));
                }
            }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }

    /// <summary>Commands that must not run on the window's thread, as they talk to other programs.</summary>
    private static object? Off(string[] parts)
    {
        switch (parts[0])
        {
            case "boxtext":
                // Only the test's own window: never what the person has open.
                if (!Native.TitleOf(Native.GetForegroundWindow()).Contains(Marker, StringComparison.OrdinalIgnoreCase)) return new { text = "" };
                var element = AutomationElement.FocusedElement;
                if (element.TryGetCurrentPattern(TextPattern.Pattern, out var text)) return new { text = ((TextPattern)text).DocumentRange.GetText(-1) };
                return new { text = element.TryGetCurrentPattern(ValuePattern.Pattern, out var value) ? ((ValuePattern)value).Current.Value : "" };
            case "fg":
                return new { title = Native.TitleOf(Native.GetForegroundWindow()) };
            case "front":
                return new { ok = Front(string.Join(' ', parts[1..])) };
            case "selectall": return new { ok = Chord(0x11, 0x41) };
            case "toend": return new { ok = Chord(0x11, 0x23) };
            // Closing as a person would, and only with this test's window in front. Nothing is killed.
            case "closetab": return new { ok = Chord(0x11, 0x57) };
            case "quitapp": return new { ok = Chord(0x11, 0x51) };
            case "save":
                var saved = Chord(0x11, 0x53);
                Thread.Sleep(300);
                return new { ok = saved };
            case "realclick":
                return new { ok = RealClick(int.Parse(parts[1]), int.Parse(parts[2])) };
            case "realdrag":
                return new { ok = RealDrag(int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]), int.Parse(parts[4])) };
        }
        return null;
    }

    private static bool Front(string title)
    {
        var found = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            if (IsWindowVisible(h) && Native.TitleOf(h).Contains(title, StringComparison.OrdinalIgnoreCase)) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        var ok = SetForegroundWindow(found);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        Thread.Sleep(150);
        if (Native.GetForegroundWindow() == found) { keybd_event(0x1B, 0, 0, UIntPtr.Zero); keybd_event(0x1B, 0, 2, UIntPtr.Zero); }
        return ok;
    }

    private static bool Chord(byte modifier, byte key)
    {
        if (!Native.TitleOf(Native.GetForegroundWindow()).Contains(Marker, StringComparison.OrdinalIgnoreCase)) return false;
        keybd_event(modifier, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 2, UIntPtr.Zero);
        keybd_event(modifier, 0, 2, UIntPtr.Zero);
        return true;
    }

    /// <summary>A real click, to prove the window leaves the keyboard where it is. The mouse goes back.</summary>
    private static bool RealClick(int x, int y)
    {
        Native.GetCursorPos(out var was);
        SetCursorPos(x, y);
        Thread.Sleep(40);
        mouse_event(2, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        mouse_event(4, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        SetCursorPos(was.X, was.Y);
        return true;
    }

    private static bool RealDrag(int x, int y, int toX, int toY)
    {
        Native.GetCursorPos(out var was);
        SetCursorPos(x, y);
        Thread.Sleep(40);
        mouse_event(2, 0, 0, 0, UIntPtr.Zero);
        for (var i = 1; i <= 10; i++)
        {
            SetCursorPos(x + (toX - x) * i / 10, y + (toY - y) * i / 10);
            Thread.Sleep(15);
        }
        mouse_event(4, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        SetCursorPos(was.X, was.Y);
        return true;
    }

    private static object Do(MainWindow window, string[] parts)
    {
        switch (parts[0])
        {
            case "signin": window.TestSignIn(parts[1], parts[2]); break;
            case "open": window.TestOpen(parts[1]); break;
            case "click": window.TestDown(int.Parse(parts[1]), parts.Length > 2); window.TestUp(); break;
            case "drag":
                window.TestDown(int.Parse(parts[1]), false);
                window.TestEnter(int.Parse(parts[2]));
                window.TestUp();
                break;
            case "stop": window.TestStop(); break;
            case "hotkey": window.TestHotkey(); break;
            case "close": window.Close(); return new { };
            case "cardpos":
                var centre = window.TestCardCentre(int.Parse(parts[1]));
                return new { found = centre != null, x = centre?.X ?? 0, y = centre?.Y ?? 0 };
            case "barpos":
                var bar = window.TestBarPoint();
                Native.GetWindowRect(window.TestHandle, out var frame);
                return new { x = bar.X, y = bar.Y, left = frame.Left, top = frame.Top, right = frame.Right, bottom = frame.Bottom };
        }
        return window.TestState();
    }
}
#endif
