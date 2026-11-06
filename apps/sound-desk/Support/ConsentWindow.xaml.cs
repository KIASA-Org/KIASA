using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using SoundDesk.Audio;
using SoundDesk.Capture;

namespace SoundDesk.Support;

/// <summary>The member's own decision, every time: who sees it, what is shown, which sounds.
/// For an invitation the manager is fixed (the one who invited); for a request the member
/// picks from the managers the database says may support them.</summary>
public partial class ConsentWindow : Window
{
    private readonly SupportApi _api;
    private readonly SessionView? _invite;
    private List<(string Id, string Name)> _mics = [];

    public SessionView? Session { get; private set; }
    public Consent? Chosen { get; private set; }

    public ConsentWindow(SupportApi api, SessionView? invite)
    {
        _api = api;
        _invite = invite;
        InitializeComponent();
        SourceInitialized += (_, _) => { var dark = 1; DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, 20, ref dark, sizeof(int)); };
        Loaded += async (_, _) => await Fill();
    }

    private async Task Fill()
    {
        foreach (var screen in Screens.Displays()) ScreenList.Items.Add(screen);
        foreach (var window in Screens.Windows()) ScreenList.Items.Add(window);
        ScreenList.SelectedIndex = 0;
        try { _mics = Microphone.List(); } catch { }
        MicDevice.Items.Add("Windows' default microphone for calls");
        foreach (var mic in _mics) MicDevice.Items.Add(mic.Name);
        MicDevice.SelectedIndex = 0;
        if (!SystemSound.ProcessLoopbackSupported)
            SoundNote.Text += " On this version of Windows the computer sound includes the manager's voice, so it is lowered while they speak.";

        if (_invite != null)
        {
            Heading.Text = $"{_invite.ManagerName} asks to see your screen";
            ManagerBox.Visibility = Visibility.Collapsed;
            ManagerFixed.Visibility = Visibility.Visible;
            ManagerName.Text = $"{_invite.ManagerName} ({_invite.ManagerRole})";
            NoButton.Content = "Decline";
            return;
        }
        try
        {
            var managers = await _api.Managers();
            foreach (var manager in managers) ManagerBox.Items.Add(manager);
            if (managers.Count > 0) ManagerBox.SelectedIndex = 0;
            else Show("No manager can support you yet. Ask an admin to put you in a team.");
        }
        catch (Exception ex) { Show("KIASA could not be reached: " + ex.Message); }
    }

    private async void Start_Click(object sender, RoutedEventArgs e)
    {
        if (ScreenList.SelectedItem is not ScreenChoice screen) { Show("Choose a display or a window to show."); return; }
        var manager = _invite == null ? ManagerBox.SelectedItem as ManagerChoice : null;
        if (_invite == null && manager == null) { Show("Choose the manager who will see it."); return; }
        var system = SystemBox.IsChecked == true;
        var mic = MicBox.IsChecked == true;
        var micDevice = MicDevice.SelectedIndex > 0 ? _mics[MicDevice.SelectedIndex - 1].Id : null;
        StartButton.IsEnabled = false;
        // What is written: the kind of screen, never a window's title (it may be private).
        var consent = SupportApi.Consent(screen.IsDisplay ? "display" : "window", system, mic);
        try
        {
            Session = _invite != null ? await _api.Accept(_invite.Id, consent) : await _api.Request(manager!.Id, consent);
            Chosen = new Consent { Screen = screen, SystemAudio = system, Mic = mic, MicDevice = micDevice };
            DialogResult = true;
            Close();
        }
        catch (SupportApiException ex)
        {
            StartButton.IsEnabled = true;
            Show(ex.Message.Contains("already open") ? "You already have a support session open." :
                 ex.Message.Contains("not open") ? "This invitation has ended or expired." :
                 ex.Message.Contains("not allowed") ? "That manager cannot support you." : "That did not work: " + ex.Message);
        }
        catch (Exception ex) { StartButton.IsEnabled = true; Show("KIASA could not be reached: " + ex.Message); }
    }

    private async void No_Click(object sender, RoutedEventArgs e)
    {
        if (_invite != null) { try { await _api.Decline(_invite.Id); } catch { } }
        DialogResult = false;
        Close();
    }

    private void Show(string text) { Said.Text = text; Said.Visibility = Visibility.Visible; }

    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
