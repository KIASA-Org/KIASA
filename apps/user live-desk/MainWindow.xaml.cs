using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using UserDesk.Net;

namespace UserDesk;

public partial class MainWindow : Window
{
    private readonly Account _account = new();
    private NotifyLink? _notifyLink;
    private (int X, int Y, int WindowX, int WindowY)? _moving;

    public MainWindow()
    {
        InitializeComponent();
        _account.Ended += () => Dispatcher.BeginInvoke(() => ShowSignIn("Your sign-in has ended. Please sign in again."));
        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        var dark = 1;
        DwmSetWindowAttribute(handle, 20, ref dark, sizeof(int));
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_account.MayBeSignedIn && await _account.Token() != null) EnterDesk();
        else ShowSignIn(null);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _notifyLink?.Dispose();
        Application.Current.Shutdown();
    }

    // ── Sign-in ──────────────────────────────────────────────────────────────

    private void ShowSignIn(string? message)
    {
        DeskView.Visibility = Visibility.Collapsed;
        SignInView.Visibility = Visibility.Visible;
        if (message != null)
        {
            SignInSaid.Text = message;
            SignInSaid.Visibility = Visibility.Visible;
        }
        else
        {
            SignInSaid.Visibility = Visibility.Collapsed;
        }
        EmailBox.Focus();
    }

    private void EnterDesk()
    {
        SignInView.Visibility = Visibility.Collapsed;
        DeskView.Visibility = Visibility.Visible;
        WhoAmI.Text = _account.Name;
        StartListening();
    }

    private void StartListening()
    {
        _notifyLink?.Dispose();
        _notifyLink = new NotifyLink(_account);
        _notifyLink.TextReceived += text => Dispatcher.BeginInvoke(() => ShowNotify(text));
        _notifyLink.Connected += () => Dispatcher.BeginInvoke(() =>
        {
            ConnDot.Fill = (Brush)FindResource("Leaf");
            ConnStatus.Text = "Connected";
        });
        _notifyLink.Disconnected += () => Dispatcher.BeginInvoke(() =>
        {
            ConnDot.Fill = (Brush)FindResource("Off");
            ConnStatus.Text = "Reconnecting…";
        });
        _notifyLink.Open();
    }

    private void ShowNotify(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            NotifyText.Visibility = Visibility.Collapsed;
            EmptyNote.Visibility = Visibility.Visible;
        }
        else
        {
            NotifyText.Text = text;
            NotifyText.Visibility = Visibility.Visible;
            EmptyNote.Visibility = Visibility.Collapsed;
        }
    }

    private async void SignIn_Click(object sender, RoutedEventArgs e) => await TrySignIn();
    private async void Field_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Return) await TrySignIn(); }

    private async Task TrySignIn()
    {
        var email = EmailBox.Text.Trim();
        var password = PasswordInput.Password;
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
        {
            SignInSaid.Text = "Please enter your email and password.";
            SignInSaid.Visibility = Visibility.Visible;
            return;
        }
        SignInButton.IsEnabled = false;
        SignInSaid.Visibility = Visibility.Collapsed;
        var error = await _account.SignIn(email, password);
        SignInButton.IsEnabled = true;
        if (error != null)
        {
            SignInSaid.Text = error;
            SignInSaid.Visibility = Visibility.Visible;
            return;
        }
        PasswordInput.Clear();
        EnterDesk();
    }

    private async void SignOut_Click(object sender, RoutedEventArgs e)
    {
        _notifyLink?.Dispose();
        _notifyLink = null;
        await _account.SignOut();
        ShowSignIn(null);
    }

    // ── Window chrome ────────────────────────────────────────────────────────

    private void TopBar_Down(object sender, MouseButtonEventArgs e)
    {
        var pos = e.GetPosition(this);
        _moving = ((int)pos.X, (int)pos.Y, (int)Left, (int)Top);
        ((UIElement)sender).CaptureMouse();
    }

    private void TopBar_Move(object sender, MouseEventArgs e)
    {
        if (_moving is not { } m || e.LeftButton != MouseButtonState.Pressed) return;
        var pos = e.GetPosition(this);
        Left = m.WindowX + (int)pos.X - m.X;
        Top  = m.WindowY + (int)pos.Y - m.Y;
    }

    private void TopBar_Up(object sender, MouseButtonEventArgs e)
    {
        _moving = null;
        ((UIElement)sender).ReleaseMouseCapture();
    }

    private void Minimise_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Close_Click(object sender, RoutedEventArgs e)    => Close();

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
