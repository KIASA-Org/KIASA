using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using LiveDesk.Core;
using LiveDesk.Net;
using LiveDesk.Win;

namespace LiveDesk;

public sealed class Bindable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    private string _text = "";
    private bool _live, _picked;
    public string Text { get => _text; set => Set(ref _text, value); }
    public bool Live { get => _live; set => Set(ref _live, value); }
    public bool Picked { get => _picked; set => Set(ref _picked, value); }
    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

public sealed class Person : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    private bool _current;
    public required string Id { get; init; }
    public required string Name { get; set; }
    public required string Since { get; init; }
    public bool Current
    {
        get => _current;
        set { if (_current != value) { _current = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Current))); } }
    }
}

/// <summary>The admin's Live scripts as a small Windows app: the same list and cards as the site,
/// and what is picked goes straight in where the cursor is, in whatever program that is.
///
/// This window never takes the keyboard (once signed in), so clicking a card leaves the cursor in
/// the document. The member's own page still tells them that an admin can read their script.</summary>
public partial class MainWindow : Window
{
    private const int HotkeyId = 1;
    private const long ListEveryMs = 3_000;
    private const long FlashMs = 1_800;

    private readonly Account _account = new();
    private readonly CaretTracker _caret = new();
    private readonly Typer _typer;
    private readonly CaretIcon _icon = new();
    private readonly Follower _follow = new();
    private readonly ObservableCollection<Bindable> _cards = [];
    private readonly ObservableCollection<Person> _people = [];
    private readonly Dictionary<string, string> _names = [];
    private readonly DispatcherTimer _beat = new(DispatcherPriority.Normal) { Interval = TimeSpan.FromMilliseconds(100) };
    private IntPtr _handle;
    private bool _signedIn;
    private bool _hasHotkey;
    private ScriptRun? _run;
    private int _runId;
    private string? _open;
    private bool _opening;
    private ReadingState _reading = ReadingState.Opening;
    private bool _listed;
    private long _nextList;
    private bool _listing;
    private string _text = "";
    private int _start;
    private List<Sentence> _sentences = [];
    private ScrollViewer? _scroll;
    private bool _atBottom = true;
    private HashSet<int> _picked = [];
    private int? _followFrom;     // where the followed cards start, in the whole script
    private Gesture? _drag;
    private int _wrote;
    private long _wroteAt;
    private bool _wasOn;
    private (int X, int Y, int WindowX, int WindowY)? _moving;

    private sealed record Gesture(int Start, bool Add, HashSet<int> Base) { public bool Moved { get; set; } }

    public MainWindow()
    {
        InitializeComponent();
        _typer = new Typer(_caret);
        Cards.ItemsSource = _cards;
        People.ItemsSource = _people;
        _caret.Changed += target =>
        {
            if (target.Writable) _icon.MoveTo(target);
        };
        _account.Ended += () => Dispatcher.BeginInvoke(() => ShowSignIn("Your sign-in has ended. Please sign in again."));
        _beat.Tick += (_, _) => Beat();
        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        _handle = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(_handle).AddHook(WindowMessage);
        var dark = 1;
        Native.DwmSetWindowAttribute(_handle, 20, ref dark, sizeof(int));
        // A window that never activates would otherwise lose its place in the taskbar.
        Native.SetWindowLong(_handle, Native.GWL_EXSTYLE, Native.GetWindowLong(_handle, Native.GWL_EXSTYLE) | Native.WS_EX_APPWINDOW);
        _hasHotkey = Native.RegisterHotKey(_handle, HotkeyId, Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT, Native.VK_SPACE);
        if (!_hasHotkey) Hint.Text = Hint.Text.Replace(" Ctrl+Alt+Space writes the bubble's words now.", "");
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _icon.Show();
        _icon.Hide();
        Cards.ApplyTemplate();
        _scroll = Cards.Template.FindName("Scroll", Cards) as ScrollViewer;
        if (_scroll != null) _scroll.ScrollChanged += (_, args) =>
        {
            // Following the newest words, unless the admin scrolled up to read back. A change in the
            // length of the list is not the admin scrolling.
            if (args.VerticalChange != 0 && args.ExtentHeightChange == 0) _atBottom = _scroll.VerticalOffset + _scroll.ViewportHeight >= _scroll.ExtentHeight - 48;
        };
        _beat.Start();
#if DESK_TEST
        TestPipe.Start(this);
#endif
        if (_account.MayBeSignedIn && await _account.Token() != null) EnterDesk();
        else ShowSignIn(null);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        if (_hasHotkey) Native.UnregisterHotKey(_handle, HotkeyId);
        _run?.Dispose();
        _typer.Dispose();
        _caret.Dispose();
        _icon.Close();
        Application.Current.Shutdown();
    }

    private IntPtr WindowMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message == Native.WM_MOUSEACTIVATE && _signedIn)
        {
            handled = true;
            return Native.MA_NOACTIVATE;
        }
        if (message == Native.WM_HOTKEY && wParam == HotkeyId)
        {
            handled = true;
            WriteBubbleNow();
        }
        return IntPtr.Zero;
    }

    // ── Signing in ──────────────────────────────────────────────────────────────────────────────

    private void ShowSignIn(string? said)
    {
        _signedIn = false;
        Close_Reading();
        Native.SetWindowLong(_handle, Native.GWL_EXSTYLE, Native.GetWindowLong(_handle, Native.GWL_EXSTYLE) & ~Native.WS_EX_NOACTIVATE);
        DeskView.Visibility = Visibility.Collapsed;
        SignInView.Visibility = Visibility.Visible;
        SignInSaid.Text = said ?? "";
        SignInSaid.Visibility = said == null ? Visibility.Collapsed : Visibility.Visible;
        _caret.Watching = false;
        _icon.Hide();
        Activate();
        EmailBox.Focus();
    }

    private void EnterDesk()
    {
        _signedIn = true;
        // From here on, clicking this window leaves the keyboard where it is.
        Native.SetWindowLong(_handle, Native.GWL_EXSTYLE, Native.GetWindowLong(_handle, Native.GWL_EXSTYLE) | Native.WS_EX_NOACTIVATE);
        Keyboard.ClearFocus();
        PasswordInput.Clear();
        SignInView.Visibility = Visibility.Collapsed;
        DeskView.Visibility = Visibility.Visible;
        WhoAmI.Text = _account.Name;
        _nextList = 0;
    }

    private void Field_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) SignIn_Click(sender, e);
    }

    private async void SignIn_Click(object sender, RoutedEventArgs e)
    {
        if (!SignInButton.IsEnabled) return;
        SignInButton.IsEnabled = false;
        SignInSaid.Visibility = Visibility.Collapsed;
        var said = await _account.SignIn(EmailBox.Text, PasswordInput.Password);
        SignInButton.IsEnabled = true;
        if (said == null)
        {
            EnterDesk();
            return;
        }
        SignInSaid.Text = said;
        SignInSaid.Visibility = Visibility.Visible;
    }

    private async void SignOut_Click(object sender, RoutedEventArgs e)
    {
        await _account.SignOut();
        ShowSignIn(null);
    }

    // ── Who is live ─────────────────────────────────────────────────────────────────────────────

    private async Task LoadList()
    {
        if (_listing) return;
        _listing = true;
        try
        {
            var rows = await _account.Read("live_sessions?select=user_id,started_at&order=started_at");
            if (rows is not { ValueKind: JsonValueKind.Array } list || !_signedIn) return;   // A look that failed says nothing about who is on.
            var seen = list.EnumerateArray().Select(row => (Id: row.GetProperty("user_id").GetString()!, Started: row.GetProperty("started_at").GetDateTimeOffset())).ToList();
            var missing = seen.Select(row => row.Id).Where(id => !_names.ContainsKey(id) && id != _account.Id).ToList();
            if (missing.Count > 0)
            {
                var names = await _account.Read($"profiles?select=id,name&id=in.({string.Join(",", missing)})");
                if (names is { ValueKind: JsonValueKind.Array } found)
                    foreach (var row in found.EnumerateArray()) _names[row.GetProperty("id").GetString()!] = row.GetProperty("name").GetString() ?? "";
            }
            _listed = true;
            for (var i = _people.Count - 1; i >= 0; i--)
                if (seen.All(row => row.Id != _people[i].Id)) _people.RemoveAt(i);
            foreach (var row in seen)
            {
                if (_people.Any(person => person.Id == row.Id)) continue;
                _people.Add(new Person { Id = row.Id, Name = NameOf(row.Id), Since = "since " + row.Started.ToLocalTime().ToString("h:mm tt"), Current = row.Id == _open });
            }
            LiveCount.Text = $"Live now ({_people.Count})";
            NoOne.Visibility = _people.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        finally
        {
            _listing = false;
        }
    }

    private string NameOf(string id) =>
        id == _account.Id ? _account.Name : _names.TryGetValue(id, out var name) && name.Length > 0 ? name : "A KIASA member";

    private void Person_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is Person person) OpenScript(person.Id);
    }

    private void OpenScript(string id)
    {
        if (id == _open) return;
        Close_Reading();
        _open = id;
        _opening = true;
        _reading = ReadingState.Opening;
        foreach (var person in _people) person.Current = person.Id == id;
        var run = ++_runId;
        _run = new ScriptRun(_account, id,
            (text, start, older) => Dispatcher.BeginInvoke(() => { if (run == _runId) GotText(text, start, older); }),
            state => Dispatcher.BeginInvoke(() => { if (run == _runId) _reading = state; }));
        Refresh();
    }

    private void Close_Reading()
    {
        _runId++;
        _run?.Dispose();
        _run = null;
        _open = null;
        _opening = false;
        _text = "";
        _start = 0;
        _sentences = [];
        _picked = [];
        _followFrom = null;
        _follow.Stop();
        _follow.Update("", 0, 0);
        _typer.Clear();
        _cards.Clear();
        _atBottom = true;
        _wasOn = false;
        foreach (var person in _people) person.Current = false;
    }

    /// <summary>Words still coming say it is on, even if the member could not tell the list. Only from
    /// a page that says regularly that it is there: from an older one, quiet could mean anything.</summary>
    private bool StillOn => _open != null && (_people.Any(person => person.Id == _open) || !_listed || (_run is { SaysItIsThere: true } && _reading == ReadingState.Live && !_opening));

    // ── The script ──────────────────────────────────────────────────────────────────────────────

    private void GotText(string text, int start, string? older)
    {
        // Older sentences arriving above: the cards picked are still the same ones.
        if (older != null)
        {
            var added = Sentences.Split(older).Count;
            if (added > 0) _picked = _picked.Select(index => index + added).ToHashSet();
        }
        _text = text;
        _start = start;
        _opening = false;
        _sentences = Sentences.Split(text);
        _follow.Update(text, start, Environment.TickCount64);
        Pump();
        Refresh();
        if (_atBottom) _scroll?.ScrollToEnd();
    }

    private void DrawCards()
    {
        // Only what changed is drawn again: a long script has thousands of sentences.
        var on = StillOn;
        for (var i = 0; i < _sentences.Count; i++)
        {
            Bindable card;
            if (i < _cards.Count) card = _cards[i];
            else
            {
                card = new Bindable();
                _cards.Add(card);
            }
            var sentence = _sentences[i];
            card.Text = sentence.Text;
            card.Live = i == _sentences.Count - 1 && on;
            card.Picked = _picked.Contains(i) || (_followFrom is { } from && _start + sentence.End > from);
        }
        while (_cards.Count > _sentences.Count) _cards.RemoveAt(_cards.Count - 1);
        CardsEmpty.Visibility = _cards.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        CardsEmpty.Text = _open != null && on ? "Waiting for the first words…" : "Their words appear here, a card at a time, as they are spoken.";
    }

    // ── Picking cards: the same gestures as the site ────────────────────────────────────────────

    private static bool CtrlHeld => Native.IsDown(Native.VK_CONTROL);   // This window is not told of keys.

    private int IndexAt(DependencyObject? element)
    {
        while (element != null && element is not ContentPresenter { Content: Bindable })
            element = element is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(element) : LogicalTreeHelper.GetParent(element);
        return element is ContentPresenter { Content: Bindable card } ? _cards.IndexOf(card) : -1;
    }

    private void Cards_Down(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is DependencyObject source && FindParent<System.Windows.Controls.Primitives.ScrollBar>(source) != null) return;
        var index = IndexAt(e.OriginalSource as DependencyObject);
        if (index < 0) return;
        GestureDown(index, CtrlHeld);
        Cards.CaptureMouse();
        e.Handled = true;
    }

    private static T? FindParent<T>(DependencyObject? element) where T : class
    {
        while (element != null && element is not T)
            element = element is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(element) : LogicalTreeHelper.GetParent(element);
        return element as T;
    }

    private void Cards_Move(object sender, MouseEventArgs e)
    {
        if (_drag == null) return;
        var at = e.GetPosition(Cards);
        // Carried past either edge: the list scrolls.
        if (_scroll != null)
        {
            if (at.Y < 0) _scroll.ScrollToVerticalOffset(_scroll.VerticalOffset - 14);
            else if (at.Y > Cards.ActualHeight) _scroll.ScrollToVerticalOffset(_scroll.VerticalOffset + 14);
        }
        var hit = VisualTreeHelper.HitTest(Cards, new Point(Math.Clamp(at.X, 1, Cards.ActualWidth - 12), Math.Clamp(at.Y, 1, Cards.ActualHeight - 1)));
        var index = IndexAt(hit?.VisualHit);
        if (index >= 0) GestureEnter(index);
    }

    private void Cards_Up(object sender, MouseButtonEventArgs e)
    {
        if (_drag == null) return;
        Cards.ReleaseMouseCapture();
        GestureUp();
        e.Handled = true;
    }

    private HashSet<int> Chosen()
    {
        var set = new HashSet<int>(_picked);
        if (_followFrom is { } from)
            for (var i = 0; i < _sentences.Count; i++)
                if (_start + _sentences[i].End > from) set.Add(i);
        return set;
    }

    private void GestureDown(int index, bool add)
    {
        var start = add ? Chosen() : [];
        _drag = new Gesture(index, add, start);
        _picked = [.. start, index];
        Refresh();
    }

    private void GestureEnter(int index)
    {
        if (_drag == null) return;
        if (index != _drag.Start) _drag.Moved = true;
        var next = new HashSet<int>(_drag.Base);
        for (var i = Math.Min(_drag.Start, index); i <= Math.Max(_drag.Start, index); i++) next.Add(i);
        _picked = next;
        Refresh();
    }

    /// <summary>Finishing a pick writes the cards just chosen, in order. Only those: holding Ctrl to
    /// add one more must not write again what is there already. If the pick reaches the sentence
    /// being written, it goes on from there, each sentence as it finishes.</summary>
    private void GestureUp()
    {
        var drag = _drag;
        if (drag == null) return;
        _drag = null;
        var set = _picked;
        if (drag.Add && !drag.Moved && drag.Base.Contains(drag.Start))
        {
            set = new HashSet<int>(drag.Base);
            set.Remove(drag.Start);
        }
        var last = _sentences.Count - 1;
        int? anchor = null;
        if (StillOn && last >= 0 && set.Contains(last))
        {
            var a = last;
            while (a > 0 && set.Contains(a - 1)) a--;
            anchor = a;
        }

        var written = 0;
        foreach (var index in set.Except(drag.Base).Where(i => i <= last && !(anchor != null && i == last)).OrderBy(i => i))
        {
            _typer.Write(_sentences[index].Text);
            written++;
        }
        if (anchor is { } tail)
        {
            // Already following, it simply goes on: what it has written stays written.
            if (!_follow.On)
            {
                _follow.Update(_text, _start, Environment.TickCount64);
                _follow.Begin(_start + _sentences[last].Start);
            }
            _followFrom = _start + _sentences[tail].Start;
            _picked = set.Where(index => index < tail).ToHashSet();
        }
        else
        {
            _follow.Stop();
            _followFrom = null;
            _picked = set;
        }
        _wrote = written;
        _wroteAt = Environment.TickCount64;
        Pump();
        Refresh();
    }

    private void WriteBubbleNow()
    {
        if (!_follow.On) return;
        _typer.Write(_follow.TakeAll());
        Refresh();
    }

    private void Stop_Click(object sender, RoutedEventArgs e) => StopWriting();

    private void StopWriting()
    {
        _follow.Stop();
        _followFrom = null;
        _typer.Clear();
        _picked = [];
        Refresh();
    }

    // ── What goes on all the time ───────────────────────────────────────────────────────────────

    /// <summary>Sentences that have settled go in.</summary>
    private void Pump()
    {
        foreach (var sentence in _follow.TakeSettled(Environment.TickCount64)) _typer.Write(sentence);
    }

    private void Beat()
    {
        if (!_signedIn) return;
        var now = Environment.TickCount64;
        if (now >= _nextList)
        {
            _nextList = now + ListEveryMs;
            _ = LoadList();
        }
        var on = StillOn;
        // Turned off while following: what was still being said goes in, and it ends there.
        if (_wasOn && !on && _follow.On)
        {
            _typer.Write(_follow.TakeAll());
            _follow.Stop();
            _followFrom = null;
        }
        _wasOn = on;
        Pump();
        Refresh();
    }

    private void Refresh()
    {
        DrawCards();
        var target = _caret.Latest;
        var waiting = _typer.Waiting;
        var hold = _typer.Holding;
        var needed = _open != null || waiting > 0;
        if (_caret.Watching != needed) _caret.Watching = needed;
        DrawStatus(target, waiting, hold);
        DrawIcon(target, waiting, hold, needed);
    }

    private void DrawStatus(Target target, int waiting, Hold hold)
    {
        var on = StillOn;
        var state = "off";
        string said;
        var sentences = waiting == 1 ? "1 sentence" : $"{waiting} sentences";
        var name = _open == null ? "" : NameOf(_open);
        if (waiting > 0 && hold == Hold.NoBox)
        {
            state = "warn";
            said = (target.Why.Length > 0 ? target.Why + ". " : "") + $"Click in a box to write: {sentences} waiting.";
        }
        else if (waiting > 0 && hold == Hold.Selected)
        {
            state = "warn";
            said = $"Text is selected there, and writing would replace it. {sentences} waiting.";
        }
        else if (_follow.On)
        {
            state = "ok";
            said = target.Writable ? $"Writing live into {Short(target.Title)}" : "Writing live: click in a box.";
        }
        else if (_wrote > 0 && Environment.TickCount64 - _wroteAt < FlashMs)
        {
            state = "ok";
            said = $"Wrote {_wrote} {(_wrote == 1 ? "card" : "cards")} into {Short(target.Title)}";
        }
        else if (_open == null) said = "Choose someone to read their script.";
        else if (!on) said = $"{name} has turned their live script off.";
        else if (_opening) said = $"{name}: Opening…";
        else if (_reading == ReadingState.Waiting)
        {
            state = "warn";
            said = "Waiting for the connection. The words will catch up by themselves.";
        }
        else
        {
            state = "ok";
            said = $"{name}: Live";
        }
        Status.Text = said;
        StatusDot.Fill = (Brush)FindResource(state == "ok" ? "Leaf" : state == "warn" ? "Warn" : "Off");
        StopButton.Visibility = _follow.On || waiting > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private static string Short(string title) => title.Length <= 44 ? title : title[..43] + "…";

    private void DrawIcon(Target target, int waiting, Hold hold, bool needed)
    {
        if (!needed || !_signedIn) { if (_icon.IsVisible) _icon.Hide(); return; }
        string words;
        var warn = false;
        if (waiting > 0 && hold == Hold.NoBox) { words = $"Click in a box: {waiting} waiting"; warn = true; }
        else if (waiting > 0 && hold == Hold.Selected) { words = "Text is selected: waiting"; warn = true; }
        else words = _follow.Pending();
        _icon.ShowWords(words, warn);

        var show = target.Writable || warn;
        if (show && !_icon.IsVisible) { _icon.Show(); if (target.HasPlace) _icon.MoveTo(target); }
        else if (!show && _icon.IsVisible) _icon.Hide();
    }

    // ── The window's own buttons ────────────────────────────────────────────────────────────────

    private void TopBar_Down(object sender, MouseButtonEventArgs e)
    {
        // Where the press was, not where the mouse is by now: it may have moved on already.
        var pressed = TopBar.PointToScreen(e.GetPosition(TopBar));
        if (!Native.GetWindowRect(_handle, out var frame)) return;
        _moving = ((int)pressed.X, (int)pressed.Y, frame.Left, frame.Top);
        TopBar.CaptureMouse();
    }

    private void TopBar_Move(object sender, MouseEventArgs e)
    {
        if (_moving is not { } start || !Native.GetCursorPos(out var point)) return;
        Native.SetWindowPos(_handle, IntPtr.Zero, start.WindowX + point.X - start.X, start.WindowY + point.Y - start.Y, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
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

    private void Minimise_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Close_Click(object sender, RoutedEventArgs e) => Close();

#if DESK_TEST
    // What the tests do with the mouse and see on the screen, without moving the real mouse.
    internal void TestSignIn(string email, string password)
    {
        EmailBox.Text = email;
        PasswordInput.Password = password;
        SignIn_Click(this, new RoutedEventArgs());
    }
    internal Point? TestCardCentre(int index)
    {
        if (Cards.ItemContainerGenerator.ContainerFromIndex(index) is not FrameworkElement card) return null;
        return card.PointToScreen(new Point(card.ActualWidth / 2, card.ActualHeight / 2));
    }
    internal Point TestBarPoint() => TopBar.PointToScreen(new Point(300, 20));
    internal IntPtr TestHandle => _handle;
    internal void TestOpen(string id) => OpenScript(id);
    internal void TestDown(int index, bool add) => GestureDown(index, add);
    internal void TestEnter(int index) => GestureEnter(index);
    internal void TestUp() => GestureUp();
    internal void TestStop() => StopWriting();
    internal void TestHotkey() => WriteBubbleNow();
    internal object TestState() => new
    {
        signedIn = _signedIn,
        hasHotkey = _hasHotkey,
        said = SignInSaid.Text,
        people = _people.Select(person => new { person.Id, person.Name }).ToArray(),
        open = _open,
        cards = _cards.Select(card => new { card.Text, card.Live, card.Picked }).ToArray(),
        status = Status.Text,
        following = _follow.On,
        waiting = _typer.Waiting,
        hold = _typer.Holding.ToString(),
        bubble = _icon.Showing,
        iconVisible = _icon.IsVisible,
        iconLeft = _icon.IsVisible ? _icon.Left : 0,
        iconTop = _icon.IsVisible ? _icon.Top : 0,
        target = new { _caret.Latest.Title, _caret.Latest.Writable, _caret.Latest.NewLines, _caret.Latest.X, _caret.Latest.Y, _caret.Latest.Why },
    };
#endif
}
