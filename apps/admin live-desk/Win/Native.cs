using System.Runtime.InteropServices;
using System.Text;

namespace LiveDesk.Win;

/// <summary>The parts of Windows the app calls directly.</summary>
internal static class Native
{
    public const int WM_MOUSEACTIVATE = 0x0021, MA_NOACTIVATE = 3, WM_HOTKEY = 0x0312;
    public const int GWL_EXSTYLE = -20, GWL_STYLE = -16;
    public const long WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x80, WS_EX_TRANSPARENT = 0x20, WS_EX_APPWINDOW = 0x40000, WS_EX_TOPMOST = 0x8;
    public const long ES_MULTILINE = 0x4;
    public const uint SWP_NOSIZE = 1, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_ASYNCWINDOWPOS = 0x4000;
    public const uint EVENT_SYSTEM_FOREGROUND = 0x0003, EVENT_OBJECT_FOCUS = 0x8005, EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
    public const uint WINEVENT_OUTOFCONTEXT = 0, WINEVENT_SKIPOWNPROCESS = 2;
    public const int OBJID_CARET = -8;
    public const uint OBJID_CARET_U = 0xFFFFFFF8;
    public const int VK_BACK = 8, VK_LBUTTON = 1, VK_RBUTTON = 2, VK_MBUTTON = 4, VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_RETURN = 0x0D, VK_SPACE = 0x20;
    public const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_NOREPEAT = 0x4000;
    public const uint INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 2, KEYEVENTF_UNICODE = 4;
    public const uint STATE_SYSTEM_INVISIBLE = 0x8000;
    public const uint QS_ALLINPUT = 0x04FF, PM_REMOVE = 1;
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 8;
    public const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; public readonly int Width => Right - Left; public readonly int Height => Bottom - Top; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO
    {
        public int cbSize, flags;
        public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
        public RECT rcCaret;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }

    public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

    [DllImport("user32")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32")] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint pid, uint thread, uint flags);
    [DllImport("user32")] public static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32")] public static extern uint MsgWaitForMultipleObjects(uint n, IntPtr[]? handles, bool all, uint ms, uint mask);
    [DllImport("user32")] public static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
    [DllImport("user32")] public static extern bool TranslateMessage(ref MSG m);
    [DllImport("user32")] public static extern IntPtr DispatchMessage(ref MSG m);
    [DllImport("user32")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
    [DllImport("user32", EntryPoint = "GetWindowLongPtrW")] public static extern long GetWindowLong(IntPtr h, int index);
    [DllImport("user32", EntryPoint = "SetWindowLongPtrW")] public static extern long SetWindowLong(IntPtr h, int index, long value);
    [DllImport("user32")] public static extern IntPtr MonitorFromPoint(POINT p, uint flags);
    [DllImport("user32")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO info);
    [DllImport("user32")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32")] public static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("oleacc")] public static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible o);
    [DllImport("dwmapi")] public static extern int DwmSetWindowAttribute(IntPtr h, int attribute, ref int value, int size);
    [DllImport("kernel32", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("advapi32", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    public static string ClassOf(IntPtr h)
    {
        if (h == IntPtr.Zero) return "";
        var s = new StringBuilder(256);
        GetClassName(h, s, 256);
        return s.ToString();
    }

    public static string TitleOf(IntPtr h)
    {
        var s = new StringBuilder(256);
        GetWindowText(h, s, 256);
        return s.ToString();
    }

    public static bool IsDown(int key) => (GetAsyncKeyState(key) & 0x8000) != 0;

    /// <summary>Whether this app may look into that process. Windows quietly drops typing sent to a
    /// program running as administrator, so such a program is told apart first.</summary>
    public static bool CanReach(uint pid)
    {
        var process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return false;
        var ok = OpenProcessToken(process, TOKEN_QUERY, out var token);
        if (ok) CloseHandle(token);
        CloseHandle(process);
        return ok;
    }
}

/// <summary>Windows' older way to ask a program about itself: the quickest way to its text cursor.</summary>
[ComImport, Guid("618736E0-3C3D-11CF-810C-00AA00389B71"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
internal interface IAccessible
{
    [PreserveSig] int get_accParent([MarshalAs(UnmanagedType.IDispatch)] out object p);
    [PreserveSig] int get_accChildCount(out int n);
    [PreserveSig] int get_accChild(object child, [MarshalAs(UnmanagedType.IDispatch)] out object d);
    [PreserveSig] int get_accName(object child, [MarshalAs(UnmanagedType.BStr)] out string s);
    [PreserveSig] int get_accValue(object child, [MarshalAs(UnmanagedType.BStr)] out string s);
    [PreserveSig] int get_accDescription(object child, [MarshalAs(UnmanagedType.BStr)] out string s);
    [PreserveSig] int get_accRole(object child, out object role);
    [PreserveSig] int get_accState(object child, out object state);
    [PreserveSig] int get_accHelp(object child, [MarshalAs(UnmanagedType.BStr)] out string s);
    [PreserveSig] int get_accHelpTopic([MarshalAs(UnmanagedType.BStr)] out string file, object child, out int topic);
    [PreserveSig] int get_accKeyboardShortcut(object child, [MarshalAs(UnmanagedType.BStr)] out string s);
    [PreserveSig] int get_accFocus(out object child);
    [PreserveSig] int get_accSelection(out object children);
    [PreserveSig] int get_accDefaultAction(object child, [MarshalAs(UnmanagedType.BStr)] out string s);
    [PreserveSig] int accSelect(int flags, object child);
    [PreserveSig] int accLocation(out int left, out int top, out int width, out int height, object child);
}
