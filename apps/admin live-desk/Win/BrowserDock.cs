using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Interop;
using LiveDesk.Core;

namespace LiveDesk.Win;

/// <summary>Reads a proxy pasted in any familiar shape into a URL the browser understands.</summary>
internal static partial class ProxyText
{
    [GeneratedRegex(@"^(socks5|socks4|socks|https|http)\b[\s:\-]+", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingScheme();

    /// <summary>Turns a pasted proxy into a proxy URL: a provider's "host:port:user:pass", a
    /// "SOCKS5 - host:port:user:pass", "user:pass@host:port", or an already-made URL all become, e.g.,
    /// socks5://user:pass@host:port. Blank stays blank; anything unreadable is returned unchanged.</summary>
    public static string Normalize(string? raw)
    {
        raw = (raw ?? "").Trim();
        if (raw.Length == 0) return "";
        string? scheme = null;
        var rest = raw;
        var mark = raw.IndexOf("://", StringComparison.Ordinal);
        if (mark > 0) { scheme = raw[..mark].Trim().ToLowerInvariant(); rest = raw[(mark + 3)..].Trim(); }
        else { var m = LeadingScheme().Match(raw); if (m.Success) { scheme = m.Groups[1].Value.ToLowerInvariant(); rest = raw[m.Length..].Trim(); } }

        string? user = null, pass = null, host, port;
        var at = rest.LastIndexOf('@');
        if (at >= 0)
        {
            var creds = rest[..at].Split(':');
            user = creds.ElementAtOrDefault(0); pass = creds.ElementAtOrDefault(1);
            var hp = rest[(at + 1)..].Split(':');
            host = hp.ElementAtOrDefault(0); port = hp.ElementAtOrDefault(1);
        }
        else
        {
            var p = rest.Split(':');
            if (p.Length >= 4) { host = p[0]; port = p[1]; user = p[2]; pass = p[3]; }
            else if (p.Length == 2) { host = p[0]; port = p[1]; }
            else return raw;   // cannot read it: leave it for the browser to report
        }
        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(port)) return raw;
        scheme = scheme switch { null or "" => "http", "socks" => "socks5", _ => scheme };
        var authority = string.IsNullOrEmpty(user) ? $"{host}:{port}" : $"{Uri.EscapeDataString(user)}:{Uri.EscapeDataString(pass ?? "")}@{host}:{port}";
        return $"{scheme}://{authority}";
    }
}

/// <summary>The browser proxy the Live Desk keeps for the embedded browser, sealed to this Windows user
/// (separate from the Live Desk's own connection proxy in Route). Passed to the browser with -proxy.</summary>
internal static class BrowserProxy
{
    private static string PathIn(string folder) => Path.Combine(folder, "browser-proxy.bin");

    public static string Load(string folder)
    {
        try
        {
            var file = PathIn(folder);
            if (!File.Exists(file)) return "";
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(file), null, DataProtectionScope.CurrentUser));
        }
        catch { return ""; }
    }

    public static void Save(string folder, string value)
    {
        try
        {
            var file = PathIn(folder);
            value = value.Trim();
            if (value.Length == 0) { if (File.Exists(file)) File.Delete(file); return; }
            File.WriteAllBytes(file, ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser));
        }
        catch { }
    }
}

/// <summary>Launches the KIASA stealth browser — a separate real Chrome, driven by the Go app — and
/// embeds its window INSIDE the Live Desk, filling a host panel, so the browser lives in the admin app
/// itself. The browser stays a real Chrome: its stealth and automation are untouched; we only reparent
/// and resize its top window, and pass it the proxy. Clicking the panel lets the admin use it.</summary>
internal sealed class BrowserDock
{
    private readonly Window _desk;
    private readonly FrameworkElement _host;   // the panel the browser fills, inside the window
    private IntPtr _browser;                    // the stealth browser's own Chrome window, once embedded
    private IntPtr _deskHandle;                 // the Live Desk window, the browser's new parent
    private Process? _app;                      // the launched browser process (Chrome is its descendant)
    private long _savedStyle;                   // the browser window's own style, to restore when freed
    private uint _deskThread, _browserThread;   // input threads tied together so the browser gets the keyboard
    private IntPtr _moveHook;                    // fires the instant the browser's window moves, to snap it back
    private Native.WinEventProc? _moveProc;      // kept alive while the hook is set

    public BrowserDock(Window desk, FrameworkElement host) { _desk = desk; _host = host; }

    public bool Docked => _browser != IntPtr.Zero;

    /// <summary>Launches the browser (through the given proxy, or direct if blank) and embeds ITS OWN
    /// window — found by process descent from the one we launched, never one of the admin's own Chrome
    /// windows. Returns a message to show the admin on failure, or null on success.</summary>
    public async Task<string?> Dock(string? proxy)
    {
        if (Docked) { Reposition(); return null; }
        var exe = FindExe();
        if (exe == null) return "The KIASA browser was not found. Install it, or set KIASA_BROWSER_EXE to its path.";
        // Clear any earlier copy: the browser is single-instance, so a second copy would only wake the
        // first and exit, and we would never see a window of our own. (Its own Chrome only — not the
        // admin's other Chrome windows, which are a different program.)
        var name = Path.GetFileNameWithoutExtension(exe);
        foreach (var old in Process.GetProcessesByName(name)) { try { old.Kill(entireProcessTree: true); } catch { } }
        if (Process.GetProcessesByName(name).Length > 0) await Task.Delay(500);

        var start = new ProcessStartInfo { FileName = exe, UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) ?? "" };
        // Only -proxy: it is the one launch flag every build of the browser understands. (An older build
        // exits on an unknown flag like -no-update, which looked like "the browser won't open".)
        if (!string.IsNullOrWhiteSpace(proxy)) start.Arguments = $"-proxy \"{proxy.Trim().Replace("\"", "")}\"";
        try { _app = Process.Start(start); }
        catch (Exception ex) { return "The KIASA browser could not start: " + ex.Message.Split('\n')[0]; }

        // Let Chrome settle its real main window before we take it over.
        var window = await WaitForBrowserWindow(TimeSpan.FromSeconds(75));
        if (window == IntPtr.Zero)
            return _app is { HasExited: true }
                ? "The browser closed before it opened — most often the proxy was rejected. Check the proxy and press Reopen."
                : "The browser is taking too long to open (a slow proxy can do this). Press Reopen to try again.";
        await Task.Delay(400);
        return Embed(window) ? null : "The browser opened but could not be placed in the window. It is open as its own window.";
    }

    /// <summary>Makes the browser's window a child of the Live Desk, filling the panel, and ties their
    /// input together so a click in it gives it the keyboard. Returns false if the reparent did not take
    /// (in which case nothing is left half-attached). </summary>
    private bool Embed(IntPtr chrome)
    {
        _deskHandle = new WindowInteropHelper(_desk).Handle;
        _savedStyle = Native.GetWindowLong(chrome, Native.GWL_STYLE);
        // Make it a child and drop its own frame, then reparent. Order matters: style first, then parent.
        var style = (_savedStyle & ~Native.WS_POPUP & ~Native.WS_CAPTION & ~Native.WS_THICKFRAME & ~Native.WS_SYSMENU & ~Native.WS_MINIMIZEBOX & ~Native.WS_MAXIMIZEBOX) | Native.WS_CHILD;
        Native.SetWindowLong(chrome, Native.GWL_STYLE, style);
        Native.SetParent(chrome, _deskHandle);
        if (Native.GetParent(chrome) != _deskHandle)
        {
            // The reparent did not take: put the window back the way it was and leave it free.
            Native.SetWindowLong(chrome, Native.GWL_STYLE, _savedStyle);
            Native.SetParent(chrome, IntPtr.Zero);
            _savedStyle = 0;
            return false;
        }
        _browser = chrome;
        // Tie the browser's input thread to the Live Desk's, so a click in it gives it the keyboard. This
        // is sound only now that the reparent is confirmed (otherwise it would strand a free window).
        _deskThread = Native.GetWindowThreadProcessId(_deskHandle, out _);
        _browserThread = Native.GetWindowThreadProcessId(chrome, out _);
        if (_deskThread != 0 && _browserThread != 0 && _deskThread != _browserThread)
            Native.AttachThreadInput(_deskThread, _browserThread, true);
        Reposition();
        // Bring the Live Desk forward so its child browser can hold the keyboard (the admin agreed the
        // Desk may take focus while the browser is open).
        Native.SetForegroundWindow(_deskHandle);
        Native.SetFocus(chrome);
        // Snap the browser back the instant it is moved, so dragging its tab strip can't shift it out of
        // the panel. Scoped to the browser's process; the drift check in Reposition stops any loop.
        Native.GetWindowThreadProcessId(chrome, out var browserPid);
        _moveProc = (_, _, h, idObject, _, _, _) => { if (h == _browser && idObject == 0) Reposition(); };
        _moveHook = Native.SetWinEventHook(Native.EVENT_OBJECT_LOCATIONCHANGE, Native.EVENT_OBJECT_LOCATIONCHANGE,
            IntPtr.Zero, _moveProc, browserPid, 0, Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS);
        return true;
    }

    /// <summary>Keeps the embedded browser exactly over the host panel (relative to the Live Desk's
    /// client area, in real pixels, right at any display scale), snapping it back if dragged.</summary>
    public void Reposition()
    {
        if (_browser == IntPtr.Zero) return;
        if (!Native.IsWindowVisible(_browser)) { _browser = IntPtr.Zero; return; }   // the browser was closed
        if (_host.ActualWidth < 2 || _host.ActualHeight < 2) return;
        if (PresentationSource.FromVisual(_host) == null) return;
        try
        {
            var topLeft = _host.PointToScreen(new Point(0, 0));
            var bottomRight = _host.PointToScreen(new Point(_host.ActualWidth, _host.ActualHeight));
            var origin = new Native.POINT { X = 0, Y = 0 };
            Native.ClientToScreen(_deskHandle, ref origin);
            var x = (int)Math.Round(topLeft.X) - origin.X;
            var y = (int)Math.Round(topLeft.Y) - origin.Y;
            var w = (int)Math.Round(bottomRight.X - topLeft.X);
            var h = (int)Math.Round(bottomRight.Y - topLeft.Y);
            // Move it only when it has drifted more than a few pixels. A tight exact check would re-fire
            // on 1-pixel DPI rounding every event the move hook delivers, and the constant SetWindowPos
            // was stealing the browser's keyboard. A real drag moves it far more than this tolerance.
            Native.GetWindowRect(_browser, out var at);
            if (Math.Abs(at.Left - origin.X - x) <= 3 && Math.Abs(at.Top - origin.Y - y) <= 3 &&
                Math.Abs(at.Width - w) <= 3 && Math.Abs(at.Height - h) <= 3) return;
            Native.SetWindowPos(_browser, IntPtr.Zero, x, y, w, h, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
        }
        catch { /* a layout pass mid-change: the next Reposition catches up */ }
    }

    /// <summary>Closes the embedded browser and its whole process tree (its own Chrome only, never the
    /// admin's other windows), e.g. to turn it off or to reopen through a different proxy.</summary>
    public void CloseBrowser()
    {
        var chrome = _browser;
        _browser = IntPtr.Zero;
        try { if (_moveHook != IntPtr.Zero) Native.UnhookWinEvent(_moveHook); } catch { }
        _moveHook = IntPtr.Zero; _moveProc = null;
        try { if (_deskThread != 0 && _browserThread != 0 && _deskThread != _browserThread) Native.AttachThreadInput(_deskThread, _browserThread, false); } catch { }
        _deskThread = _browserThread = 0;
        try { if (chrome != IntPtr.Zero) { Native.SetParent(chrome, IntPtr.Zero); if (_savedStyle != 0) Native.SetWindowLong(chrome, Native.GWL_STYLE, _savedStyle); } } catch { }
        try { if (_app is { HasExited: false }) _app.Kill(entireProcessTree: true); } catch { }
        _app = null;
        _savedStyle = 0;
    }

    public void Close() => CloseBrowser();

    public void OnDeskState(WindowState state) { if (_browser != IntPtr.Zero && state != WindowState.Minimized) Reposition(); }

    /// <summary>Opens the browser's own Settings window (its other options beyond the proxy).</summary>
    public string? OpenSettings()
    {
        var exe = FindExe();
        if (exe == null) return "The KIASA browser was not found. Install it, or set KIASA_BROWSER_EXE to its path.";
        try { Process.Start(new ProcessStartInfo { FileName = exe, Arguments = "-settings", UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) ?? "" }); return null; }
        catch (Exception ex) { return "Could not open the browser settings: " + ex.Message.Split('\n')[0]; }
    }

    private static string? FindExe()
    {
        var set = Environment.GetEnvironmentVariable("KIASA_BROWSER_EXE");
        if (!string.IsNullOrWhiteSpace(set) && File.Exists(set)) return set;
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var path in new[]
        {
            Path.Combine(local, "Programs", "KIASA", "KIASA.exe"),
            Path.Combine(local, "Programs", "KIASA", "stealth-app.exe"),
        }) if (File.Exists(path)) return path;
        return null;
    }

    /// <summary>A visible Chrome/Chromium window (class Chrome_WidgetWin_1), large enough to be a real
    /// browser window and not a hidden helper. The title is not required — it is empty until the first
    /// page has a name.</summary>
    private static bool IsChromeWindow(IntPtr h)
    {
        if (!Native.IsWindowVisible(h)) return false;
        if (Native.ClassOf(h) != "Chrome_WidgetWin_1") return false;
        return Native.GetWindowRect(h, out var r) && r.Width > 400 && r.Height > 300;
    }

    /// <summary>Waits for the Chrome window that belongs to the browser WE launched — found by matching
    /// the window's process against our launched process and its descendants, so the admin's own Chrome
    /// windows can never be picked.</summary>
    private async Task<IntPtr> WaitForBrowserWindow(TimeSpan timeout)
    {
        if (_app == null) return IntPtr.Zero;
        var root = (uint)_app.Id;
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            if (_app.HasExited) { if (Timing.On) Timing.Line("BrowserDock: the browser process exited before a window appeared"); return IntPtr.Zero; }
            var family = Native.DescendantPids(root);
            // The biggest of our browser's windows: the main one, never a transient little startup window.
            var best = IntPtr.Zero;
            long bestArea = 0;
            Native.EnumWindows((h, _) =>
            {
                if (!IsChromeWindow(h)) return true;
                Native.GetWindowThreadProcessId(h, out var pid);
                if (!family.Contains(pid)) return true;
                Native.GetWindowRect(h, out var r);
                long area = (long)r.Width * r.Height;
                if (area > bestArea) { bestArea = area; best = h; }
                return true;
            }, IntPtr.Zero);
            if (best != IntPtr.Zero) return best;
            await Task.Delay(400);
        }
        return IntPtr.Zero;
    }
}
