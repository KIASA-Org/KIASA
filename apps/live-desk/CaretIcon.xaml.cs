using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using LiveDesk.Win;

namespace LiveDesk;

/// <summary>The small icon that stays beside the cursor, with the words not yet written beside it.
/// It can't be clicked and never takes the keyboard: it is only there to be seen.</summary>
public partial class CaretIcon : Window
{
    private const int MostWords = 72;     // characters in the bubble: the newest
    private IntPtr _handle;
    private volatile int _widthPx = 26;
    private volatile int _heightPx = 26;
    private string _words = "";

    public CaretIcon() => InitializeComponent();

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _handle = new WindowInteropHelper(this).Handle;
        var style = Native.GetWindowLong(_handle, Native.GWL_EXSTYLE);
        Native.SetWindowLong(_handle, Native.GWL_EXSTYLE, style | Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | Native.WS_EX_TRANSPARENT);
        SizeChanged += (_, _) => Measured();
        Measured();
    }

    private void Measured()
    {
        var scale = VisualTreeHelper.GetDpi(this);
        _widthPx = (int)Math.Ceiling(ActualWidth * scale.DpiScaleX);
        _heightPx = (int)Math.Ceiling(ActualHeight * scale.DpiScaleY);
    }

    public void ShowWords(string words, bool warn = false)
    {
        var shown = Newest(words);
        if (shown != _words)
        {
            _words = shown;
            Words.Text = shown;
            Bubble.Visibility = shown.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
        }
        Bubble.BorderBrush = warn ? (Brush)FindResource("Warn") : Mark.BorderBrush;
    }

    public string Showing => _words;

    private static string Newest(string words)
    {
        words = words.Replace('\n', ' ');
        if (words.Length <= MostWords) return words;
        var from = words.Length - MostWords;
        var space = words.IndexOf(' ', from);
        return "… " + words[(space >= 0 && space < words.Length - 1 ? space + 1 : from)..];
    }

    /// <summary>Goes beside the cursor, kept on the screen. Called from the cursor's thread, and
    /// doesn't wait for this window's: that is what keeps it on the cursor as it moves.</summary>
    public void MoveTo(in Target target)
    {
        if (_handle == IntPtr.Zero || !target.HasPlace) return;
        var work = WorkArea(target.X, target.Y);
        var x = target.X + 2;
        var y = target.Y + target.Height + 5;
        // Below the line, or above it where the screen ends.
        if (y + _heightPx > work.Bottom) y = target.Y - _heightPx - 5;
        x = Math.Clamp(x, work.Left, Math.Max(work.Left, work.Right - _widthPx));
        y = Math.Clamp(y, work.Top, Math.Max(work.Top, work.Bottom - _heightPx));
        Native.SetWindowPos(_handle, IntPtr.Zero, x, y, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_ASYNCWINDOWPOS);
    }

    private static Native.RECT WorkArea(int x, int y)
    {
        var monitor = Native.MonitorFromPoint(new Native.POINT { X = x, Y = y }, Native.MONITOR_DEFAULTTONEAREST);
        var info = new Native.MONITORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Native.MONITORINFO>() };
        Native.GetMonitorInfo(monitor, ref info);
        return info.rcWork;
    }
}
