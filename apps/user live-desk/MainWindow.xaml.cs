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
    private readonly Settings _settings;
    private readonly object _drawGate = new();
    private (string Text, int Start, int Len)? _pending;

    public MainWindow()
    {
        InitializeComponent();
        _settings = Settings.Load(_account.Folder);
        OpacitySlider.Value = _settings.Opacity;
        ApplyFont();
        PlaceFromSettings();
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
        HwndSource.FromHwnd(_handle)?.AddHook(WndProc);
        RegisterKeys();
        ApplyHide();
        ShowGhost();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // A kept sign-in opens the desk even with no connection yet: the links keep trying and the top
        // bar says "Reconnecting…". Only a sign-in the server turns down goes back to signing in
        // (Account.Ended).
        if (_account.MayBeSignedIn) { EnterDesk(); _ = _account.Token(); }
        else ShowSignIn(null);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        KeepPlace();
        foreach (var id in new[] { KeyGhost1, KeyGhost2, KeyHide }) UnregisterHotKey(_handle, id);
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
        var notify = _notifyLink;
        _presence.State = () => (notify.Version, notify.NeedsFull);
        _notifyLink.FullWanted += () => _presence?.BeatSoon();
        _notifyLink.Applied += () => _presence?.Report();
        // Messages held up on the line arrive together; draw only the newest of them.
        _notifyLink.TextReceived += (text, start, len) =>
        {
            bool schedule;
            lock (_drawGate) { schedule = _pending == null; _pending = (text, start, len); }
            if (!schedule) return;
            Dispatcher.BeginInvoke(DispatcherPriority.Send, () =>
            {
                (string Text, int Start, int Len)? next;
                lock (_drawGate) { next = _pending; _pending = null; }
                if (next is { } n) ShowNotify(n.Text, n.Start, n.Len);
            });
        };
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
        var drawAt = Environment.TickCount64;
        EmptyNote.Visibility = Visibility.Collapsed;
        NotifyBox.Visibility = Visibility.Visible;
        var changed = NotifyBox.Text != text;
        if (changed) NotifyBox.Text = text;
        // Mirror the admin's highlight, clamped to the text we have.
        start = Math.Clamp(start, 0, text.Length);
        len = Math.Clamp(len, 0, text.Length - start);
        NotifyBox.UpdateLayout();
        var laidAt = Environment.TickCount64;
        var moved = changed || start != _shownStart || len != _shownLen;
        _shownStart = start;
        _shownLen = len;
        // Follow the admin: keep where they are writing in view, as the text grows past the window.
        if (moved) FollowCaret(start + len);
        DrawSelection(start, len);
        PlaceCaret(start + len);
        if (Trace.On) Trace.Line($"draw len={text.Length} sel={len} layout={laidAt - drawAt}ms selection={Environment.TickCount64 - laidAt}ms");
    }

    private int _shownStart, _shownLen;

    /// <summary>Scrolls so the admin's caret is in view, only when it is not: a third of the way
    /// down, so the lines being written have room below.</summary>
    private void FollowCaret(int index)
    {
        var view = NotifyBox.ActualHeight;
        if (view <= 0) return;
        var rect = NotifyBox.GetRectFromCharacterIndex(index);
        if (rect.IsEmpty || double.IsInfinity(rect.Y))
        {
            // Far off screen the box has not laid that line out yet: bring the line in first.
            var line = NotifyBox.GetLineIndexFromCharacterIndex(index);
            if (line >= 0) NotifyBox.ScrollToLine(line);
            NotifyBox.UpdateLayout();
            rect = NotifyBox.GetRectFromCharacterIndex(index);
            if (rect.IsEmpty || double.IsInfinity(rect.Y)) return;
        }
        if (rect.Top >= 0 && rect.Bottom <= view) return;
        NotifyBox.ScrollToVerticalOffset(Math.Max(0, NotifyBox.VerticalOffset + rect.Top - view / 3));
        NotifyBox.UpdateLayout();
    }

    /// <summary>The highlight and caret are drawn over the box, so they move when its text does.</summary>
    private void NotifyBox_Scrolled(object sender, ScrollChangedEventArgs e) => Redraw();
    private void NotifyBox_SizeChanged(object sender, SizeChangedEventArgs e) => Redraw();

    private void Redraw()
    {
        if (NotifyBox.Visibility != Visibility.Visible) return;
        var length = NotifyBox.Text.Length;
        var start = Math.Clamp(_shownStart, 0, length);
        var len = Math.Clamp(_shownLen, 0, length - start);
        DrawSelection(start, len);
        PlaceCaret(start + len);
    }

    /// <summary>Draws the admin's selection as blue rectangles behind the text, line by line.</summary>
    private void DrawSelection(int start, int len)
    {
        SelCanvas.Children.Clear();
        var end = start + len;
        if (len <= 0) return;
        // One band per wrapped line, measured at its two ends only: measuring every character took
        // 281 ms for a 2,478-character Ctrl+A (2026-11-08); this is a few calls per line.
        var first = NotifyBox.GetLineIndexFromCharacterIndex(start);
        var last = NotifyBox.GetLineIndexFromCharacterIndex(end - 1);
        if (first < 0 || last < first) return;
        for (var line = first; line <= last; line++)
        {
            var lineStart = NotifyBox.GetCharacterIndexFromLineIndex(line);
            var lineLen = NotifyBox.GetLineLength(line);
            if (lineStart < 0 || lineLen < 0) break;
            var from = Math.Max(start, lineStart);
            var to = Math.Min(end, lineStart + lineLen);   // exclusive
            if (to <= from) continue;
            var r0 = NotifyBox.GetRectFromCharacterIndex(from, false);
            var r1 = NotifyBox.GetRectFromCharacterIndex(to - 1, true);
            if (r0.IsEmpty || double.IsInfinity(r0.X)) continue;
            var left = r0.X;
            var right = r1.IsEmpty || double.IsInfinity(r1.X) ? r0.X : r1.X;
            if (right < left) right = left;
            var band = new Rectangle { Width = Math.Max(2, right - left), Height = r0.Height, Fill = _selBrush };
            Canvas.SetLeft(band, left);
            Canvas.SetTop(band, r0.Top);
            SelCanvas.Children.Add(band);
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
        if (rect.Bottom < 0 || rect.Top > NotifyBox.ActualHeight)
        {
            Caret.Visibility = Visibility.Collapsed;   // scrolled away; it comes back with the text
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
        var wasMoving = _moving != null;
        _moving = null;
        TopBar.ReleaseMouseCapture();
        if (wasMoving) KeepPlace();
    }

    // ── Where the window was, and the text size ───────────────────────────────

    /// <summary>Opens where it was last closed, if that place is still on a screen (a monitor may
    /// have been unplugged since).</summary>
    private void PlaceFromSettings()
    {
        if (_settings.Width is { } w && _settings.Height is { } h)
        {
            Width = Math.Max(MinWidth, w);
            Height = Math.Max(MinHeight, h);
        }
        if (_settings.Left is not { } left || _settings.Top is not { } top) return;
        var screen = new System.Windows.Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
                              SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        // The top bar must be reachable: at least its first 120 x 30 inside the screens.
        if (!screen.IntersectsWith(new System.Windows.Rect(left, top, 120, 30))) return;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = left;
        Top = top;
    }

    private void KeepPlace()
    {
        var r = WindowState == WindowState.Normal ? new System.Windows.Rect(Left, Top, ActualWidth, ActualHeight) : RestoreBounds;
        if (r.IsEmpty || r.Width <= 0) return;
        _settings.Left = r.Left;
        _settings.Top = r.Top;
        _settings.Width = r.Width;
        _settings.Height = r.Height;
        _settings.Save();
    }

    private void FontDown_Click(object sender, RoutedEventArgs e) => SetFont(_settings.FontSize - 2);
    private void FontUp_Click(object sender, RoutedEventArgs e) => SetFont(_settings.FontSize + 2);

    private void SetFont(double size)
    {
        _settings.FontSize = Math.Clamp(size, Settings.SmallestFont, Settings.LargestFont);
        _settings.Save();
        ApplyFont();
        NotifyBox.UpdateLayout();
        Redraw();
    }

    private void ApplyFont()
    {
        NotifyBox.FontSize = _settings.FontSize;
        FontValue.Text = $"{_settings.FontSize:0}";
        FontDown.IsEnabled = _settings.FontSize > Settings.SmallestFont;
        FontUp.IsEnabled = _settings.FontSize < Settings.LargestFont;
        FontDown.Opacity = FontDown.IsEnabled ? 1 : 0.4;
        FontUp.Opacity = FontUp.IsEnabled ? 1 : 0.4;
    }

    private void Pin_Click(object sender, RoutedEventArgs e)
    {
        Topmost = PinSwitch.IsChecked == true;
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
        if (_settings != null && Math.Abs(_settings.Opacity - e.NewValue) > 0.001)
        {
            _settings.Opacity = e.NewValue;
            _settings.Save();
        }
    }

    // ── Hide from screen sharing, and ghost (clicks pass through) ────────────

    private const int KeyGhost1 = 1, KeyGhost2 = 2, KeyHide = 3;
    private bool _ghostKey, _hideKey, _ghost;

    /// <summary>Shortcut keys that work from any app, so ghost can be left even though this window
    /// takes no clicks then. Another app (or a second copy of an older desk) may already hold one.</summary>
    private void RegisterKeys()
    {
        const uint ctrl = 0x2, alt = 0x1, shift = 0x4, noRepeat = 0x4000;
        var g1 = RegisterHotKey(_handle, KeyGhost1, ctrl | alt | noRepeat, 0x5A);   // Ctrl+Alt+Z
        var g2 = RegisterHotKey(_handle, KeyGhost2, ctrl | shift | noRepeat, 0x5A); // Ctrl+Shift+Z
        _ghostKey = g1 || g2;
        _ghostKeyName = g1 ? "Ctrl+Alt+Z" : g2 ? "Ctrl+Shift+Z" : null;
        _hideKey = RegisterHotKey(_handle, KeyHide, ctrl | shift | noRepeat, 0x41); // Ctrl+Shift+A
    }

    private string? _ghostKeyName;

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WM_HOTKEY = 0x0312;
        if (msg != WM_HOTKEY) return IntPtr.Zero;
        switch (wParam.ToInt32())
        {
            case KeyGhost1:
            case KeyGhost2: SetGhost(!_ghost); handled = true; break;
            case KeyHide: SetHide(!_settings.HideFromShare); handled = true; break;
        }
        return IntPtr.Zero;
    }

    private void Hide_Click(object sender, RoutedEventArgs e) => SetHide(HideSwitch.IsChecked == true);
    private void Ghost_Click(object sender, RoutedEventArgs e) => SetGhost(GhostSwitch.IsChecked == true);

    private void SetHide(bool on)
    {
        _settings.HideFromShare = on;
        _settings.Save();
        ApplyHide();
    }

    /// <summary>Asks Windows to leave this window (and the settings popup) out of every screen capture:
    /// screen sharing, recording and screenshots. The person at this computer still sees it.</summary>
    private void ApplyHide()
    {
        var on = _settings.HideFromShare;
        var worked = Exclude(_handle, on);
        if (SettingsPopup.Child != null && PresentationSource.FromVisual(SettingsPopup.Child) is HwndSource popup)
            Exclude(popup.Handle, on);
        HideSwitch.IsChecked = on;
        var key = _hideKey ? "\nShortcut: Ctrl+Shift+A" : "";
        HideNote.Text = !worked && on
            ? "This version of Windows cannot hide the window from screen sharing."
            : $"You see it; shares and recordings don't.{key}";
    }

    private static bool Exclude(IntPtr hwnd, bool on)
    {
        const uint WDA_NONE = 0, WDA_MONITOR = 1, WDA_EXCLUDEFROMCAPTURE = 0x11;
        if (hwnd == IntPtr.Zero) return false;
        if (!on) return SetWindowDisplayAffinity(hwnd, WDA_NONE);
        // Windows 10 before 2004 knows only "show black instead", which is still hidden.
        return SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) || SetWindowDisplayAffinity(hwnd, WDA_MONITOR);
    }

    private void SettingsPopup_Opened(object? sender, EventArgs e)
    {
        if (PresentationSource.FromVisual(SettingsPopup.Child) is HwndSource popup)
            Exclude(popup.Handle, _settings.HideFromShare);
    }

    /// <summary>Ghost: every click goes through to the window behind. Only the shortcut key brings
    /// clicks back, so ghost is refused when no shortcut could be had.</summary>
    private void SetGhost(bool on)
    {
        if (on && !_ghostKey) { GhostSwitch.IsChecked = false; return; }
        if (_ghost == on) return;
        _ghost = on;
        if (on) SettingsPopup.IsOpen = false;
        const int GWL_EXSTYLE = -20;
        const long WS_EX_TRANSPARENT = 0x20, WS_EX_LAYERED = 0x80000;
        var style = GetWindowLongPtr(_handle, GWL_EXSTYLE).ToInt64();
        style = on ? style | WS_EX_TRANSPARENT | WS_EX_LAYERED : style & ~WS_EX_TRANSPARENT;
        SetWindowLongPtr(_handle, GWL_EXSTYLE, new IntPtr(style));
        ShowGhost();
    }

    private void ShowGhost()
    {
        GhostSwitch.IsChecked = _ghost;
        GhostSwitch.IsEnabled = _ghostKey;
        GhostNote.Text = $"Ghost · {_ghostKeyName} to return";
        GhostNote.Visibility = _ghost ? Visibility.Visible : Visibility.Collapsed;
        GhostHint.Text = _ghostKey
            ? $"Clicks go through to the apps behind.\nShortcut: {_ghostKeyName}"
            : "Needs Ctrl+Alt+Z or Ctrl+Shift+Z, and another app is using both.";
    }

    private void Minimise_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Close_Click(object sender, RoutedEventArgs e)    => Close();

    private const uint SWP_NOSIZE = 0x0001, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X, Y; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);

    [DllImport("user32.dll")]
    private static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);


    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out NativePoint point);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
