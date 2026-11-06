using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using UserDesk.Net;

namespace UserDesk;

public partial class MainWindow : Window
{
    private readonly Account _account = new();
    private NotifyLink? _notifyLink;
    private PresenceLink? _presence;
    private readonly DispatcherTimer _blink = new() { Interval = TimeSpan.FromMilliseconds(530) };
    private readonly Brush _selBrush = new SolidColorBrush(Color.FromArgb(0x99, 0x2F, 0x6F, 0xC5));
    private (int X, int Y, int WindowX, int WindowY)? _moving;

    public MainWindow()
    {
        InitializeComponent();
        _account.Ended += () => Dispatcher.BeginInvoke(() => ShowSignIn("Your sign-in has ended. Please sign in again."));
        _blink.Tick += (_, _) => Caret.Opacity = Caret.Opacity > 0 ? 0 : 1;
        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        _handle = new WindowInteropHelper(this).Handle;
        var dark = 1;
        DwmSetWindowAttribute(_handle, 20, ref dark, sizeof(int));
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_account.MayBeSignedIn && await _account.Token() != null) EnterDesk();
        else ShowSignIn(null);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _notifyLink?.Dispose();
        _presence?.Dispose();
        Application.Current.Shutdown();
    }

    // ── Sign-in ──────────────────────────────────────────────────────────────

    private void ShowSignIn(string? message)
    {
        DeskView.Visibility = Visibility.Collapsed;
        ConnInfo.Visibility = Visibility.Collapsed;
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
        ConnInfo.Visibility = Visibility.Visible;
        WhoAmI.Text = _account.Name;
        StartListening();
    }

    private void StartListening()
    {
        _presence?.Dispose();
        _presence = new PresenceLink(_account);
        _presence.Open();
        _notifyLink?.Dispose();
        _notifyLink = new NotifyLink(_account);
        _notifyLink.TextReceived += (text, start, len) => Dispatcher.BeginInvoke(DispatcherPriority.Send, () => ShowNotify(text, start, len));
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

    private void ShowNotify(string text, int start, int len)
    {
        if (string.IsNullOrEmpty(text))
        {
            NotifyBox.Visibility = Visibility.Collapsed;
            EmptyNote.Visibility = Visibility.Visible;
            Caret.Visibility = Visibility.Collapsed;
            SelCanvas.Children.Clear();
            _blink.Stop();
            return;
        }
        EmptyNote.Visibility = Visibility.Collapsed;
        NotifyBox.Visibility = Visibility.Visible;
        if (NotifyBox.Text != text) NotifyBox.Text = text;
        // Mirror the admin's highlight, clamped to the text we have.
        start = Math.Clamp(start, 0, text.Length);
        len = Math.Clamp(len, 0, text.Length - start);
        NotifyBox.UpdateLayout();
        DrawSelection(start, len);
        PlaceCaret(start + len);
    }

    /// <summary>Draws the admin's selection as blue rectangles behind the text, line by line.</summary>
    private void DrawSelection(int start, int len)
    {
        SelCanvas.Children.Clear();
        var end = start + len;
        if (len <= 0) return;
        var i = start;
        while (i < end)
        {
            var r0 = NotifyBox.GetRectFromCharacterIndex(i, false);
            if (r0.IsEmpty || double.IsInfinity(r0.X)) break;
            var top = r0.Top;
            var k = i + 1;
            while (k < end)
            {
                var rk = NotifyBox.GetRectFromCharacterIndex(k, false);
                if (rk.IsEmpty || double.IsInfinity(rk.X) || Math.Abs(rk.Top - top) > 0.5) break;
                k++;
            }
            var rEnd = NotifyBox.GetRectFromCharacterIndex(k - 1, true);
            var left = r0.X;
            var right = rEnd.IsEmpty || double.IsInfinity(rEnd.X) ? r0.X : rEnd.X;
            if (right < left) right = left;
            var band = new Rectangle { Width = Math.Max(2, right - left), Height = r0.Height, Fill = _selBrush };
            Canvas.SetLeft(band, left);
            Canvas.SetTop(band, top);
            SelCanvas.Children.Add(band);
            i = k;
        }
    }

    /// <summary>Puts the hand-drawn caret where the admin's is and starts it blinking.</summary>
    private void PlaceCaret(int index)
    {
        var rect = NotifyBox.GetRectFromCharacterIndex(index);
        if (rect.IsEmpty || double.IsInfinity(rect.X) || double.IsInfinity(rect.Y))
        {
            Caret.Visibility = Visibility.Collapsed;
            _blink.Stop();
            return;
        }
        Caret.Margin = new Thickness(rect.X, rect.Y, 0, 0);
        Caret.Height = rect.Height > 0 ? rect.Height : NotifyBox.FontSize * 1.3;
        Caret.Opacity = 1;
        Caret.Visibility = Visibility.Visible;
        _blink.Stop();
        _blink.Start();
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
        _presence?.Dispose();
        _presence = null;
        await _account.SignOut();
        ShowSignIn(null);
    }

    // ── Window chrome ────────────────────────────────────────────────────────

    private IntPtr _handle;

    private void TopBar_Down(object sender, MouseButtonEventArgs e)
    {
        // Screen coordinates, not window-relative: measuring against the window while it moves
        // feeds back on itself and the window shakes.
        var pressed = TopBar.PointToScreen(e.GetPosition(TopBar));
        if (!GetWindowRect(_handle, out var frame)) return;
        _moving = ((int)pressed.X, (int)pressed.Y, frame.Left, frame.Top);
        TopBar.CaptureMouse();
    }

    private void TopBar_Move(object sender, MouseEventArgs e)
    {
        if (_moving is not { } start || !GetCursorPos(out var point)) return;
        SetWindowPos(_handle, IntPtr.Zero, start.WindowX + point.X - start.X, start.WindowY + point.Y - start.Y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    private void TopBar_Up(object sender, MouseButtonEventArgs e)
    {
        _moving = null;
        TopBar.ReleaseMouseCapture();
    }

    private void Pin_Click(object sender, RoutedEventArgs e)
    {
        Topmost = !Topmost;
        PinMark.Fill = (Brush)FindResource(Topmost ? "Leaf" : "InkMute");
    }

    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        SettingsPopup.IsOpen = !SettingsPopup.IsOpen;
    }

    private static readonly Color NightColor = (Color)ColorConverter.ConvertFromString("#030807");
    private static readonly Color PanelColor = (Color)ColorConverter.ConvertFromString("#0A120D");

    private void Opacity_Changed(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        // Fade only the dark fills, not the text: lower the alpha of the backgrounds so the screen
        // behind shows through while the message stays sharp.
        var a = (byte)Math.Round(e.NewValue * 255);
        Background = new SolidColorBrush(Color.FromArgb(a, NightColor.R, NightColor.G, NightColor.B));
        if (PanelBorder != null) PanelBorder.Background = new SolidColorBrush(Color.FromArgb(a, PanelColor.R, PanelColor.G, PanelColor.B));
        if (OpacityValue != null) OpacityValue.Text = $"{(int)Math.Round(e.NewValue * 100)}%";
    }

    private void Minimise_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Close_Click(object sender, RoutedEventArgs e)    => Close();

    private const uint SWP_NOSIZE = 0x0001, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X, Y; }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out NativePoint point);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
