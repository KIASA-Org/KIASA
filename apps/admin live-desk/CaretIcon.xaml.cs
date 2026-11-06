using System.Diagnostics;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using LiveDesk.Win;

namespace LiveDesk;

/// <summary>The window of the small icon that stays beside the cursor. It can't be clicked and never
/// takes the keyboard: it is only there to be seen. How it looks and moves is in <see cref="CaretFace"/>;
/// this keeps it beside the cursor, on the screen, and runs its frames only while something is moving.</summary>
public partial class CaretIcon : Window
{
    private const int MostWords = 110;      // characters given to the bubble: the newest
    private const double GlideFromDip = 60; // nearer than this it stays right on the cursor; further, it glides
    private const double GlideSeconds = 0.05;
    // Frames on a timer, not on every render: measured, that ran at 180 a second and took half a CPU core
    // to draw a line moving 15 pixels a second. This keeps to about 30, and 60 while gliding across the screen.
    // (Windows' timers tick about every 16 ms: asking for 33 gave only 21 frames a second.)
    private static readonly TimeSpan FrameEvery = TimeSpan.FromMilliseconds(24);
    private static readonly TimeSpan GlideFrameEvery = TimeSpan.FromMilliseconds(16);

    private readonly CaretFace _face = new();
    private readonly Stopwatch _clock = new();
    private readonly DispatcherTimer _frames = new(DispatcherPriority.Render) { Interval = FrameEvery };
    private readonly object _gate = new();
    private readonly bool _still = !SystemParameters.ClientAreaAnimation;
    private IntPtr _handle;
    private bool _running;
    private double _last;
    private string _words = "";
    private bool _warn;
    private volatile int _widthPx = 64;
    private volatile int _heightPx = 64;
    private double _roomPx = CaretFace.Room;
    private double _scale = 1;
    private double _atX, _atY, _goX, _goY;
    private bool _placed, _gliding;
    private (int X, int Y, int Height)? _cursor;

    public CaretIcon()
    {
        InitializeComponent();
        Content = _face;
        _frames.Tick += (_, _) => Frame();
    }

    public string Showing => _words;

    /// <summary>Makes the window ready, without showing it.</summary>
    public void Prepare() => new WindowInteropHelper(this).EnsureHandle();

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _handle = new WindowInteropHelper(this).Handle;
        var style = Native.GetWindowLong(_handle, Native.GWL_EXSTYLE);
        Native.SetWindowLong(_handle, Native.GWL_EXSTYLE, style | Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | Native.WS_EX_TRANSPARENT);
        SizeChanged += (_, _) => Measured();
        DpiChanged += (_, _) => Measured();
        Measured();
    }

    private void Measured()
    {
        var dpi = VisualTreeHelper.GetDpi(this);
        _scale = dpi.DpiScaleX;
        _roomPx = CaretFace.Room * dpi.DpiScaleX;
        _widthPx = (int)Math.Ceiling(ActualWidth * dpi.DpiScaleX);
        _heightPx = (int)Math.Ceiling(ActualHeight * dpi.DpiScaleY);
        // Grown wider, it may need to move to stay on the screen.
        if (_cursor is { } cursor) Place(cursor.X, cursor.Y, cursor.Height, false);
    }

    public void ShowWords(string words, bool warn)
    {
        var shown = Newest(words);
        if (shown == _words && warn == _warn) return;
        _words = shown;
        _warn = warn;
        _face.ShowWords(shown, warn);
        Run();
    }

    public void SetState(FaceState state)
    {
        if (_face.State == state) return;
        _face.State = state;
        Run();
    }

    /// <summary>Comes into view. True if it was not in view: it should start from the cursor, not glide there.</summary>
    public bool Appear()
    {
        if (!IsVisible)
        {
            lock (_gate) _placed = false;
            Show();
            _face.Appear();
            Run();
            return true;
        }
        if (_face.IsLeaving)
        {
            _face.Appear();
            Run();
        }
        return false;
    }

    public void Leave()
    {
        if (!IsVisible || _face.IsLeaving) return;
        _face.Leave();
        Run();
    }

    /// <summary>Words went in. Any thread.</summary>
    public void Landed() => Dispatcher.BeginInvoke(() =>
    {
        _face.Landed();
        Run();
    });

    private static string Newest(string words)
    {
        words = words.Replace('\n', ' ');
        if (words.Length <= MostWords) return words;
        var from = words.Length - MostWords;
        var space = words.IndexOf(' ', from);
        return words[(space >= 0 && space < words.Length - 1 ? space + 1 : from)..];
    }

    /// <summary>Stays beside the cursor, kept on the screen. Called from the cursor's thread, and doesn't
    /// wait for this window's: that is what keeps it on the cursor as it moves.</summary>
    public void MoveTo(in Target target)
    {
        if (_handle == IntPtr.Zero || !target.HasPlace) return;
        _cursor = (target.X, target.Y, target.Height);
        Place(target.X, target.Y, target.Height, false);
    }

    private void Place(int x, int y, int height, bool snap)
    {
        var work = WorkArea(x, y);
        var room = _roomPx;
        var width = _widthPx - room * 2;
        var tall = _heightPx - room * 2;
        // Below the line, or above it where the screen ends. The room for the shadow does not count.
        double faceX = x + 2;
        double faceY = y + height + 6;
        if (faceY + tall > work.Bottom) faceY = y - tall - 6;
        faceX = Math.Clamp(faceX, work.Left, Math.Max(work.Left, work.Right - width));
        faceY = Math.Clamp(faceY, work.Top, Math.Max(work.Top, work.Bottom - tall));
        var goX = faceX - room;
        var goY = faceY - room;
        lock (_gate)
        {
            _goX = goX;
            _goY = goY;
            var far = Math.Abs(goX - _atX) + Math.Abs(goY - _atY);
            if (snap || _still || !_placed || far <= GlideFromDip * _scale)
            {
                _atX = goX;
                _atY = goY;
                _placed = true;
                _gliding = false;
                Native.SetWindowPos(_handle, IntPtr.Zero, (int)goX, (int)goY, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_ASYNCWINDOWPOS);
                return;
            }
            if (_gliding) return;
            _gliding = true;
        }
        Dispatcher.BeginInvoke(Run);
    }

    private void Run()
    {
        if (_running) return;
        _running = true;
        _clock.Restart();
        _last = 0;
        Frame();
        if (_running) _frames.Start();
    }

    private void Frame()
    {
        var now = _clock.Elapsed.TotalSeconds;
        var seconds = now - _last;
        _last = now;

        var busy = _face.Advance(seconds);
        if (_face.HasLeft && IsVisible)
        {
            Hide();
            _cursor = null;
        }

        lock (_gate)
        {
            if (_gliding)
            {
                var step = 1 - Math.Exp(-seconds / GlideSeconds);
                _atX += (_goX - _atX) * step;
                _atY += (_goY - _atY) * step;
                if (Math.Abs(_goX - _atX) + Math.Abs(_goY - _atY) < 1)
                {
                    _atX = _goX;
                    _atY = _goY;
                    _gliding = false;
                }
                Native.SetWindowPos(_handle, IntPtr.Zero, (int)_atX, (int)_atY, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
                busy = true;
            }
            var every = _gliding ? GlideFrameEvery : FrameEvery;
            if (_frames.Interval != every) _frames.Interval = every;
        }

        if (busy) return;
        _frames.Stop();
        _running = false;
    }

    private static Native.RECT WorkArea(int x, int y)
    {
        var monitor = Native.MonitorFromPoint(new Native.POINT { X = x, Y = y }, Native.MONITOR_DEFAULTTONEAREST);
        var info = new Native.MONITORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Native.MONITORINFO>() };
        Native.GetMonitorInfo(monitor, ref info);
        return info.rcWork;
    }
}
