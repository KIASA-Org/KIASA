using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using Color = System.Windows.Media.Color;

namespace SoundDesk.Support;

/// <summary>Always on top, always visible while sharing: who sees it, what is on, and Stop all.
/// It is left out of the shared picture itself (Windows' capture exclusion), so the manager
/// sees the member's screen, not the bar.</summary>
public partial class SharingBar : Window
{
    private readonly SupportSession _session;

    public SharingBar(SupportSession session)
    {
        _session = session;
        InitializeComponent();
        SourceInitialized += (_, _) =>
        {
            // WDA_EXCLUDEFROMCAPTURE (Windows 10 2004+); older Windows: the bar shows in the picture.
            SetWindowDisplayAffinity(new WindowInteropHelper(this).Handle, 0x11);
        };
        Loaded += (_, _) =>
        {
            var area = SystemParameters.WorkArea;
            Left = area.Left + (area.Width - ActualWidth) / 2;
            Top = area.Top + 8;
        };
        _session.Changed += () => Dispatcher.BeginInvoke(Refresh);
        Refresh();
    }

    private void Refresh()
    {
        var s = _session;
        Who.Text = $"Sharing with {s.ManagerName}";
        StateText.Text = s.State switch
        {
            SupportState.Waiting => "waiting for them to open it",
            SupportState.Connecting => "connecting…",
            SupportState.Live => "live",
            SupportState.Degraded => "poor connection — voice first",
            SupportState.Reconnecting => "reconnecting…",
            _ => "stopped",
        };
        var amber = s.State is SupportState.Degraded or SupportState.Reconnecting;
        Dot.Fill = new SolidColorBrush(amber ? Color.FromRgb(0xF2, 0xD3, 0x6B) : Color.FromRgb(0xE5, 0x48, 0x4D));
        ScreenButton.Content = s.ScreenPaused ? "Screen: paused (sound continues) — Resume" : s.ScreenState == "lost" ? "Screen: not available" : "Screen: on — Pause";
        SystemButton.Content = s.SystemOn ? "Computer sound: on" : "Computer sound: off";
        MicButton.Content = s.MicOn ? "Microphone: on" : "Microphone: off";
        ProblemText.Text = s.Problem;
        ProblemText.Visibility = string.IsNullOrEmpty(s.Problem) ? Visibility.Collapsed : Visibility.Visible;
        if (s.State == SupportState.Ended) Close();
    }

    private void Screen_Click(object sender, RoutedEventArgs e) => _session.SetScreenPaused(!_session.ScreenPaused);
    private void System_Click(object sender, RoutedEventArgs e) => _session.SetSystem(!_session.SystemOn);
    private void Mic_Click(object sender, RoutedEventArgs e) => _session.SetMic(!_session.MicOn);
    private void Stop_Click(object sender, RoutedEventArgs e) => _session.Stop(EndReason.MemberStopped);
    private void Drag(object sender, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); }

    [DllImport("user32.dll")] private static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
}
