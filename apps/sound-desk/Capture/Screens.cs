using System.Runtime.InteropServices;
using System.Text;

namespace SoundDesk.Capture;

/// <summary>Something the member can share: a whole display, or one window.</summary>
public sealed record ScreenChoice(string Kind, string Key, string Label, IntPtr Window)
{
    public bool IsDisplay => Kind == "display";
    public override string ToString() => Label;
}

public enum GrabResult { Ok, Gone, Hidden, Failed }

/// <summary>The displays and windows on this computer, and the pictures of one of them, taken
/// with Windows' own GDI calls (BitBlt for a display, PrintWindow for a window). This works on
/// every Windows 10 and 11 computer, needs no extra component and no permission prompt; it is
/// slower than the newer graphics-card capture, which is why the frame rate stays modest.</summary>
public static class Screens
{
    public static List<ScreenChoice> Displays()
    {
        var list = new List<ScreenChoice>();
        var index = 0;
        foreach (var (device, bounds, primary) in Monitors())
        {
            index++;
            list.Add(new ScreenChoice("display", device,
                $"Display {index}{(primary ? " (main)" : "")} — {bounds.Width}×{bounds.Height}", IntPtr.Zero));
        }
        return list;
    }

    public static List<ScreenChoice> Windows()
    {
        var list = new List<ScreenChoice>();
        var me = Environment.ProcessId;
        Native.EnumWindows((hwnd, _) =>
        {
            if (!Native.IsWindowVisible(hwnd) || Native.IsIconic(hwnd)) return true;
            if (Native.GetWindow(hwnd, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            var style = Native.GetWindowLongPtr(hwnd, -20 /* GWL_EXSTYLE */).ToInt64();
            if ((style & 0x80 /* WS_EX_TOOLWINDOW */) != 0) return true;
            if (Native.DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out int cloaked, 4) == 0 && cloaked != 0) return true;
            Native.GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == me) return true;
            var length = Native.GetWindowTextLength(hwnd);
            if (length == 0) return true;
            var text = new StringBuilder(length + 1);
            Native.GetWindowText(hwnd, text, text.Capacity);
            var title = text.ToString().Trim();
            if (title.Length == 0 || title == "Program Manager") return true;
            list.Add(new ScreenChoice("window", hwnd.ToString(), title.Length > 70 ? title[..70] + "…" : title, hwnd));
            return true;
        }, IntPtr.Zero);
        return list;
    }

    internal static List<(string Device, Native.Rect Bounds, bool Primary)> Monitors()
    {
        var found = new List<(string, Native.Rect, bool)>();
        Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (monitor, _, _, _) =>
        {
            var info = new Native.MonitorInfoEx { Size = Marshal.SizeOf<Native.MonitorInfoEx>() };
            if (Native.GetMonitorInfo(monitor, ref info)) found.Add((info.Device, info.Monitor, (info.Flags & 1) != 0));
            return true;
        }, IntPtr.Zero);
        return found;
    }
}

/// <summary>Takes pictures of one display or window into a reusable 32-bit buffer.</summary>
public sealed class Grabber : IDisposable
{
    private readonly ScreenChoice _choice;
    private IntPtr _screenDc, _memDc, _bitmap, _old, _bits;
    private int _width, _height;

    public int Width => _width;
    public int Height => _height;
    /// <summary>The picture: BGRA, top-down, stride = Width * 4. Valid until the next Grab.</summary>
    public IntPtr Bits => _bits;
    public string Detail { get; private set; } = "";

    public Grabber(ScreenChoice choice) => _choice = choice;

    public GrabResult Grab()
    {
        Native.Rect area;
        if (_choice.IsDisplay)
        {
            var monitor = Screens.Monitors().FirstOrDefault(m => m.Device == _choice.Key);
            if (monitor.Device == null) { Detail = "display disconnected"; return GrabResult.Gone; }
            area = monitor.Bounds;
        }
        else
        {
            if (!Native.IsWindow(_choice.Window)) { Detail = "window closed"; return GrabResult.Gone; }
            if (Native.IsIconic(_choice.Window)) { Detail = "window minimised"; return GrabResult.Hidden; }
            if (Native.DwmGetWindowAttribute(_choice.Window, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out area, Marshal.SizeOf<Native.Rect>()) != 0
                && !Native.GetWindowRect(_choice.Window, out area)) return GrabResult.Failed;
        }
        var width = Math.Max(2, area.Width) & ~1;
        var height = Math.Max(2, area.Height) & ~1;
        if (width != _width || height != _height) Allocate(width, height);
        bool ok;
        if (_choice.IsDisplay)
        {
            ok = Native.BitBlt(_memDc, 0, 0, width, height, _screenDc, area.Left, area.Top, 0x00CC0020 | 0x40000000 /* SRCCOPY | CAPTUREBLT */);
            DrawCursor(area);
        }
        else
        {
            ok = Native.PrintWindow(_choice.Window, _memDc, 2 /* PW_RENDERFULLCONTENT */);
            if (!ok) ok = Native.BitBlt(_memDc, 0, 0, width, height, _screenDc, area.Left, area.Top, 0x00CC0020);
        }
        Native.GdiFlush();
        Detail = $"{width}×{height}";
        return ok ? GrabResult.Ok : GrabResult.Failed;
    }

    private void DrawCursor(Native.Rect area)
    {
        var info = new Native.CursorInfo { Size = Marshal.SizeOf<Native.CursorInfo>() };
        if (!Native.GetCursorInfo(ref info) || (info.Flags & 1) == 0) return;
        if (!Native.GetIconInfo(info.Cursor, out var icon)) return;
        try
        {
            Native.DrawIconEx(_memDc, info.X - area.Left - icon.HotX, info.Y - area.Top - icon.HotY, info.Cursor, 0, 0, 0, IntPtr.Zero, 3 /* DI_NORMAL */);
        }
        finally
        {
            if (icon.Mask != IntPtr.Zero) Native.DeleteObject(icon.Mask);
            if (icon.Color != IntPtr.Zero) Native.DeleteObject(icon.Color);
        }
    }

    private void Allocate(int width, int height)
    {
        Release();
        _screenDc = Native.GetDC(IntPtr.Zero);
        _memDc = Native.CreateCompatibleDC(_screenDc);
        var header = new Native.BitmapInfoHeader { Size = 40, Width = width, Height = -height, Planes = 1, BitCount = 32 };
        _bitmap = Native.CreateDIBSection(_screenDc, ref header, 0, out _bits, IntPtr.Zero, 0);
        if (_bitmap == IntPtr.Zero) throw new InvalidOperationException("Could not make a picture buffer");
        _old = Native.SelectObject(_memDc, _bitmap);
        _width = width;
        _height = height;
    }

    private void Release()
    {
        if (_memDc != IntPtr.Zero) { Native.SelectObject(_memDc, _old); Native.DeleteDC(_memDc); _memDc = IntPtr.Zero; }
        if (_bitmap != IntPtr.Zero) { Native.DeleteObject(_bitmap); _bitmap = IntPtr.Zero; }
        if (_screenDc != IntPtr.Zero) { Native.ReleaseDC(IntPtr.Zero, _screenDc); _screenDc = IntPtr.Zero; }
        _bits = IntPtr.Zero;
        _width = _height = 0;
    }

    public void Dispose() => Release();
}

/// <summary>BGRA to NV12 (BT.601, limited range, what browsers assume for H.264 without
/// colour information), scaled to the size the encoder takes. Scaling averages the source
/// pixels under each output pixel, which keeps thin text readable when shrinking.</summary>
public static unsafe class Nv12
{
    public static void Convert(IntPtr bgra, int srcW, int srcH, byte[] dst, int dstW, int dstH)
    {
        var srcBase = (nint)bgra;
        var stride = srcW * 4;
        fixed (byte* outPtr = dst)
        {
            var same = srcW == dstW && srcH == dstH;
            var outBase = (nint)outPtr;
            Parallel.For(0, dstH / 2, pair =>
            {
                var src = (byte*)srcBase;
                var yPlane = (byte*)outBase;
                var uvPlane = yPlane + dstW * dstH;
                for (var row = pair * 2; row < pair * 2 + 2; row++)
                {
                    var sy0 = same ? row : row * srcH / dstH;
                    var sy1 = same ? row + 1 : Math.Max(sy0 + 1, (row + 1) * srcH / dstH);
                    for (var x = 0; x < dstW; x++)
                    {
                        int r, g, b;
                        if (same)
                        {
                            var p = src + sy0 * stride + x * 4;
                            b = p[0]; g = p[1]; r = p[2];
                        }
                        else
                        {
                            var sx0 = x * srcW / dstW;
                            var sx1 = Math.Max(sx0 + 1, (x + 1) * srcW / dstW);
                            int sr = 0, sg = 0, sb = 0, n = 0;
                            for (var yy = sy0; yy < sy1 && yy < srcH; yy++)
                            {
                                var line = src + yy * stride;
                                for (var xx = sx0; xx < sx1 && xx < srcW; xx++) { var p = line + xx * 4; sb += p[0]; sg += p[1]; sr += p[2]; n++; }
                            }
                            n = Math.Max(1, n);
                            r = sr / n; g = sg / n; b = sb / n;
                        }
                        yPlane[row * dstW + x] = (byte)(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
                        if ((row & 1) == 0 && (x & 1) == 0)
                        {
                            var uv = uvPlane + (row / 2) * dstW + x;
                            uv[0] = (byte)Math.Clamp(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128, 0, 255);
                            uv[1] = (byte)Math.Clamp(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128, 0, 255);
                        }
                    }
                }
            });
        }
    }
}

internal static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; public readonly int Width => Right - Left; public readonly int Height => Bottom - Top; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MonitorInfoEx
    {
        public int Size; public Rect Monitor; public Rect Work; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BitmapInfoHeader
    {
        public uint Size; public int Width; public int Height; public ushort Planes; public ushort BitCount;
        public uint Compression, SizeImage; public int XPelsPerMeter, YPelsPerMeter; public uint ClrUsed, ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CursorInfo { public int Size; public int Flags; public IntPtr Cursor; public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct IconInfo { public bool IsIcon; public int HotX; public int HotY; public IntPtr Mask; public IntPtr Color; }

    public delegate bool MonitorProc(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);
    public delegate bool WindowProc(IntPtr hwnd, IntPtr data);

    [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorProc proc, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfoEx info);
    [DllImport("user32.dll")] public static extern bool EnumWindows(WindowProc proc, IntPtr data);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect value, int size);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CursorInfo info);
    [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr icon, out IconInfo info);
    [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int w, int h, int step, IntPtr brush, int flags);
    [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfoHeader header, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    [DllImport("gdi32.dll")] public static extern bool GdiFlush();
}
