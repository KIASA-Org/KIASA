using System.Diagnostics;
using System.Runtime.InteropServices;
using LiveDesk.Core;

namespace LiveDesk.Win;

/// <summary>Watches which box has the keyboard and where the cursor is in it, on a thread of its
/// own so that a slow program can never hold up the app's window.
///
/// What was measured on Windows 11 (Nov 2026):
/// - Chrome: the older accessibility cursor gives the exact spot, including for rich text boxes, and
///   says "invisible" on a button or a plain page.
/// - Notepad: the plain Windows cursor gives it at once.
/// - A terminal reports no cursor, as Text. Never written to: words there would be commands.
/// - LibreOffice reports only its window. It is known by its window class, and the icon goes where
///   the person last clicked in it.</summary>
public sealed class CaretTracker : IDisposable
{
    private const uint LookEveryMs = 50;        // while something is showing
    private const uint IdleEveryMs = 250;       // while nothing is
    private const long AskAgainMs = 400;        // a backstop: the focus can move with no event

    private readonly Thread _thread;
    private readonly BoxLooker _looker = new();
    private readonly uint _ownProcess = (uint)Environment.ProcessId;
    private readonly Native.WinEventProc _hook;   // Kept: Windows holds only a pointer to it.
    private volatile bool _stop;
    private volatile bool _watching;
    private volatile bool _stirred;
    private volatile Target _latest = Target.None;
    private volatile BoxFacts? _facts;
    private IntPtr _factsFor;
    private long _askedAt;
    private (int X, int Y, IntPtr Window)? _lastClick;
    private bool _wasDown;
    private readonly Dictionary<uint, bool> _reachable = new();

    /// <summary>The place changed. Runs on this thread: quick work only.</summary>
    public event Action<Target>? Changed;

    public CaretTracker()
    {
        _hook = OnWinEvent;
        _thread = new Thread(Run) { IsBackground = true, Name = "caret" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    public Target Latest => _latest;

    /// <summary>Only while there is something to show does this look often, and into other programs.</summary>
    public bool Watching { get => _watching; set { _watching = value; _stirred = true; } }

    /// <summary>A fresh look, for just before writing, or null if Windows does not answer quickly.</summary>
    internal BoxFacts? LookNow(int waitMs = 300)
    {
        BoxFacts? result = null;
        var thread = new Thread(() => result = BoxFacts.Look()) { IsBackground = true, Name = "box look now" };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
        return thread.Join(waitMs) ? result : null;
    }

    private void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (ev == Native.EVENT_OBJECT_LOCATIONCHANGE && idObject != Native.OBJID_CARET) return;
        if (ev != Native.EVENT_OBJECT_LOCATIONCHANGE) _facts = null;   // The focus moved: not known now.
        _stirred = true;
    }

    private void Run()
    {
        var hooks = new[]
        {
            Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _hook, 0, 0, Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS),
            Native.SetWinEventHook(Native.EVENT_OBJECT_FOCUS, Native.EVENT_OBJECT_FOCUS, IntPtr.Zero, _hook, 0, 0, Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS),
            Native.SetWinEventHook(Native.EVENT_OBJECT_LOCATIONCHANGE, Native.EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, _hook, 0, 0, Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS),
        };
        long lastLook = 0;
        while (!_stop)
        {
            Native.MsgWaitForMultipleObjects(0, null, false, _watching ? LookEveryMs : IdleEveryMs, Native.QS_ALLINPUT);
            while (Native.PeekMessage(out var message, IntPtr.Zero, 0, 0, Native.PM_REMOVE))
            {
                Native.TranslateMessage(ref message);
                Native.DispatchMessage(ref message);
            }
            // Any window moving wakes this thread: it looks when the cursor or focus moved, or on time.
            var now = Environment.TickCount64;
            if (!_watching || !(_stirred || now - lastLook >= LookEveryMs)) continue;
            _stirred = false;
            lastLook = now;
            try { Look(); }
            catch (Exception ex) { Debug.WriteLine(ex); }
        }
        foreach (var hook in hooks) Native.UnhookWinEvent(hook);
    }

    private void Look()
    {
        var window = Native.GetForegroundWindow();
        var thread = Native.GetWindowThreadProcessId(window, out var pid);
        WatchClicks(window);
        if (window == IntPtr.Zero || pid == _ownProcess) { Publish(_latest with { Writable = false, Why = "" }); return; }

        var gui = new Native.GUITHREADINFO { cbSize = Marshal.SizeOf<Native.GUITHREADINFO>() };
        Native.GetGUIThreadInfo(thread, ref gui);
        var focus = gui.hwndFocus != IntPtr.Zero ? gui.hwndFocus : window;
        var windowClass = Native.ClassOf(window);

        var title = Native.TitleOf(window);
        if (BoxRules.IsTerminal(windowClass)) { Publish(Nowhere(window, focus, title, "A terminal: words there would be commands")); return; }
        if (BoxRules.IsShell(windowClass)) { Publish(Nowhere(window, focus, "", "")); return; }
        if (!Reachable(pid)) { Publish(Nowhere(window, focus, title, "This program runs as administrator")); return; }

        // Fresh facts about the box, without waiting for them.
        var now = Environment.TickCount64;
        if (focus != _factsFor) { _facts = null; _factsFor = focus; }
        if (_facts == null ? now - _askedAt > 30 : now - _askedAt > AskAgainMs)
        {
            _askedAt = now;
            var askedFor = focus;
            _looker.Ask(facts => { if (askedFor == _factsFor) _facts = facts; _stirred = true; });
        }
        var box = _facts;

        var caret = CaretOf(gui, focus);
        var hasCaret = caret != null;
        var document = BoxRules.IsDocument(windowClass);
        var type = box?.Type ?? "";

        string why = "";
        var writable = false;
        if (box == null && !hasCaret && !document) why = "";
        else if (box is { Password: true }) why = "A password box";
        else if (box is { ValueReadOnly: true }) why = "";
        else if (box is { Type: "Text" }) why = "";
        else if (hasCaret || document || box is { ValueReadOnly: false }) writable = box != null || document;

        var newLines = writable && (type == "Document" || document || IsPlainMultiLine(focus));

        int x, y, height;
        var hasPlace = true;
        if (caret is { } c) (x, y, height) = c;
        else if (box is { CaretX: not null }) (x, y, height) = (box.CaretX.Value, box.CaretY!.Value, box.CaretH!.Value);
        else if (_lastClick is { } click && click.Window == window) (x, y, height) = (click.X, click.Y, 18);
        else if (box is { BoxW: > 0 } && (type is "Edit" or "Document" or "Group")) (x, y, height) = (box.BoxX + Math.Min(12, box.BoxW / 2), box.BoxY, Math.Min(box.BoxH, 24));
        else if (Native.GetWindowRect(window, out var frame)) (x, y, height) = (frame.Left + frame.Width / 2, frame.Top + 90, 18);
        else { (x, y, height) = (0, 0, 0); hasPlace = false; }

        Publish(new Target(window, focus, title, writable, newLines, why, x, y, height, hasPlace));
    }

    private static Target Nowhere(IntPtr window, IntPtr focus, string title, string why) =>
        new(window, focus, title, false, false, why, 0, 0, 0, false);

    private void Publish(Target target)
    {
        if (target == _latest) return;
        _latest = target;
        Changed?.Invoke(target);
    }

    private bool Reachable(uint pid)
    {
        if (_reachable.TryGetValue(pid, out var known)) return known;
        if (_reachable.Count > 64) _reachable.Clear();
        return _reachable[pid] = Native.CanReach(pid);
    }

    private static bool IsPlainMultiLine(IntPtr focus) =>
        Native.ClassOf(focus).Equals("Edit", StringComparison.OrdinalIgnoreCase) && (Native.GetWindowLong(focus, Native.GWL_STYLE) & Native.ES_MULTILINE) != 0;

    /// <summary>The cursor, where a program says: the plain Windows one, then the accessibility one.</summary>
    private static (int X, int Y, int Height)? CaretOf(in Native.GUITHREADINFO gui, IntPtr focus)
    {
        if (gui.hwndCaret != IntPtr.Zero && gui.rcCaret.Height > 0)
        {
            var point = new Native.POINT { X = gui.rcCaret.Left, Y = gui.rcCaret.Top };
            Native.ClientToScreen(gui.hwndCaret, ref point);
            return (point.X, point.Y, gui.rcCaret.Height);
        }
        IAccessible? accessible = null;
        try
        {
            var iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
            if (Native.AccessibleObjectFromWindow(focus, Native.OBJID_CARET_U, ref iid, out accessible) != 0 || accessible == null) return null;
            object self = 0;
            if (accessible.get_accState(self, out var state) != 0) return null;
            if ((Convert.ToUInt32(state) & Native.STATE_SYSTEM_INVISIBLE) != 0) return null;
            if (accessible.accLocation(out var left, out var top, out var width, out var height, self) != 0 || height <= 0) return null;
            return (left, top, height);
        }
        catch (Exception)
        {
            return null;
        }
        finally
        {
            if (accessible != null) Marshal.ReleaseComObject(accessible);
        }
    }

    /// <summary>Where the mouse last went down: the nearest thing to a cursor in a program that says nothing.</summary>
    private void WatchClicks(IntPtr window)
    {
        var state = Native.GetAsyncKeyState(Native.VK_LBUTTON);
        var down = (state & 0x8000) != 0;
        if ((down && !_wasDown) || (!down && (state & 1) != 0))
        {
            if (Native.GetCursorPos(out var point)) _lastClick = (point.X, point.Y, window);
        }
        _wasDown = down;
    }

    public void Dispose()
    {
        _stop = true;
        _looker.Dispose();
    }
}
