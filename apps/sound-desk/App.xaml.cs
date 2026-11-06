using System.Windows;
using Microsoft.Win32;
using SoundDesk.Audio;
using SoundDesk.Net;
using SoundDesk.Support;
using Application = System.Windows.Application;

namespace SoundDesk;

public partial class App : Application
{
    private static Mutex? _one;
    private System.Windows.Forms.NotifyIcon? _tray;
    private readonly Account _account = new();
    private SoundSender? _sender;
    private Loopback? _loopback;
    private Updater? _updater;
    private bool _sharing;
    private SupportApi? _support;
    private SupportSession? _session;
    private SharingBar? _bar;
    private ConsentWindow? _consent;
    private System.Windows.Threading.DispatcherTimer? _invites;
    private readonly HashSet<string> _invitesSeen = [];
    private System.Drawing.Icon? _idleIcon, _liveIcon;

    protected override void OnStartup(StartupEventArgs e)
    {
        // One copy per data folder: a test copy (KIASA_SOUND_DESK_DATA) can run beside the real one.
        var data = Environment.GetEnvironmentVariable("KIASA_SOUND_DESK_DATA");
        var lockName = data == null ? "KIASA.SoundDesk.One" : "KIASA.SoundDesk." + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(data.ToLowerInvariant())))[..16];
        _one = new Mutex(true, lockName, out var first);
        if (!first) { Shutdown(); return; }
        base.OnStartup(e);
        Updater.Cleanup();
        // Sharing never resumes by itself: not after an update, a restart or a Windows logon (KIASA-009).
        Updater.ForgetSharingFlag();
        _support = new SupportApi(_account);
        _account.Ended += () => Dispatcher.BeginInvoke(() =>
        {
            StopSharing();
            _session?.Stop(EndReason.SignedOut);
            ShowSignIn("Your sign-in has ended. Please sign in again.");
        });
        SetupTray();
        _ = TryAutoSignIn();
    }

    private void SetupTray()
    {
        var stream = GetResourceStream(new Uri("pack://application:,,,/assets/kiasa.ico"))?.Stream;
        _idleIcon = stream != null ? new System.Drawing.Icon(stream) : System.Drawing.SystemIcons.Application;
        _liveIcon = LiveIcon(_idleIcon);
        _tray = new System.Windows.Forms.NotifyIcon
        {
            Icon = _idleIcon,
            Text = "KIASA Sound Desk",
            Visible = true,
        };
        _tray.ContextMenuStrip = BuildMenu();
        _tray.MouseDoubleClick += (_, _) => Dispatcher.BeginInvoke(ToggleSharing);
    }

    private System.Windows.Forms.ContextMenuStrip BuildMenu()
    {
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Opening += (_, _) => RefreshMenu(menu);
        RefreshMenu(menu);
        return menu;
    }

    private void RefreshMenu(System.Windows.Forms.ContextMenuStrip menu)
    {
        menu.Items.Clear();
        if (!_account.MayBeSignedIn)
        {
            menu.Items.Add("Sign in…", null, (_, _) => Dispatcher.BeginInvoke(() => ShowSignIn(null)));
        }
        else if (_sharing)
        {
            var stop = menu.Items.Add("Stop sharing", null, (_, _) => Dispatcher.BeginInvoke(StopSharing));
            stop!.Font = new System.Drawing.Font(stop.Font!, System.Drawing.FontStyle.Bold);
        }
        else
        {
            var start = menu.Items.Add("Start sharing", null, (_, _) => Dispatcher.BeginInvoke(StartSharing));
            start!.Font = new System.Drawing.Font(start.Font!, System.Drawing.FontStyle.Bold);
        }
        if (_account.MayBeSignedIn)
        {
            if (_session != null)
            {
                var stopSupport = menu.Items.Add($"Stop sharing my screen with {_session.ManagerName}", null, (_, _) => Dispatcher.BeginInvoke(() => _session?.Stop(EndReason.MemberStopped)));
                stopSupport!.Font = new System.Drawing.Font(stopSupport.Font!, System.Drawing.FontStyle.Bold);
            }
            else menu.Items.Add("Support session: share my screen…", null, (_, _) => Dispatcher.BeginInvoke(() => OpenConsent(null)));
        }
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        if (_account.MayBeSignedIn)
        {
            var who = menu.Items.Add(_account.Name);
            who!.Enabled = false;
            menu.Items.Add("Sign out", null, (_, _) => Dispatcher.BeginInvoke(async () =>
            {
                StopSharing();
                _session?.Stop(EndReason.SignedOut);
                await _account.SignOut();
                UpdateTray();
                ShowSignIn(null);
            }));
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        }
        var auto = new System.Windows.Forms.ToolStripMenuItem("Start with Windows") { Checked = IsAutoStart() };
        auto.Click += (_, _) => { ToggleAutoStart(); auto.Checked = IsAutoStart(); };
        menu.Items.Add(auto);
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => Dispatcher.BeginInvoke(ExitApp));
    }

    private async Task TryAutoSignIn()
    {
        if (_account.MayBeSignedIn && await _account.Token() != null)
        {
            UpdateTray();
            StartUpdater();
            await SignedInNow();
            return;
        }
        ShowSignIn(null);
    }

    /// <summary>Signed in: anything left open by an earlier run is ended (never resumed), and
    /// invitations are looked for.</summary>
    private async Task SignedInNow()
    {
        if (_support != null) await _support.EndLeftovers();
        _invites ??= new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        _invites.Tick -= LookForInvites;
        _invites.Tick += LookForInvites;
        _invites.Start();
        LookForInvites(null, EventArgs.Empty);
    }

    private async void LookForInvites(object? sender, EventArgs e)
    {
        if (_support == null || _session != null || _consent != null || !_account.MayBeSignedIn) return;
        try
        {
            var invite = (await _support.Mine()).FirstOrDefault(s => s.Status == "invited" && !_invitesSeen.Contains(s.Id));
            if (invite == null) return;
            _invitesSeen.Add(invite.Id);
            _tray?.ShowBalloonTip(8000, "KIASA support", $"{invite.ManagerName} asks to see your screen. Nothing is shared unless you accept.", System.Windows.Forms.ToolTipIcon.Info);
            OpenConsent(invite);
        }
        catch (Exception ex) { Log.Write($"Support: invitations not checked: {ex.Message}"); }
    }

    /// <summary>The member's own choice, in the consent window; sharing starts only from its Start button.</summary>
    private void OpenConsent(SessionView? invite)
    {
        if (_support == null || _session != null) return;
        if (_consent != null) { _consent.Activate(); return; }
        _consent = new ConsentWindow(_support, invite);
        var accepted = _consent.ShowDialog() == true;
        var chosen = _consent.Chosen;
        var view = _consent.Session;
        _consent = null;
        if (!accepted || chosen == null || view == null) return;
        var session = new SupportSession(_account, _support, view, chosen);
        _session = session;
        session.Changed += () => Dispatcher.BeginInvoke(UpdateTray);
        session.Ended += reason => Dispatcher.BeginInvoke(() =>
        {
            if (_session != session) return;
            _session = null;
            _bar = null;
            UpdateTray();
            _tray?.ShowBalloonTip(5000, "KIASA support", reason switch
            {
                EndReason.MemberStopped => "You stopped sharing. Nothing is captured now.",
                EndReason.ManagerEnded => $"{session.ManagerName} ended the session. Nothing is captured now.",
                EndReason.ManagerGone => $"{session.ManagerName} did not come back, so sharing stopped.",
                EndReason.Revoked => "The session was ended by KIASA. Nothing is captured now.",
                _ => "Sharing stopped. Nothing is captured now.",
            }, System.Windows.Forms.ToolTipIcon.Info);
        });
        session.Start();
        _bar = new SharingBar(session);
        _bar.Show();
        _tray?.ShowBalloonTip(5000, "KIASA support", $"You are sharing with {session.ManagerName}. Use the bar at the top of the screen to pause, mute or stop.", System.Windows.Forms.ToolTipIcon.Warning);
        UpdateTray();
    }

    /// <summary>The tray icon while anything is shared: the leaf with a red dot.</summary>
    private static System.Drawing.Icon LiveIcon(System.Drawing.Icon idle)
    {
        try
        {
            using var bitmap = new System.Drawing.Bitmap(32, 32);
            using (var g = System.Drawing.Graphics.FromImage(bitmap))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.DrawIcon(new System.Drawing.Icon(idle, 32, 32), new System.Drawing.Rectangle(0, 0, 32, 32));
                g.FillEllipse(System.Drawing.Brushes.White, 15, 15, 17, 17);
                using var red = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(229, 72, 77));
                g.FillEllipse(red, 17, 17, 13, 13);
            }
            return System.Drawing.Icon.FromHandle(bitmap.GetHicon());
        }
        catch { return idle; }
    }

    private void StartUpdater()
    {
        // The updater stays off: it would run any downloaded program, unsigned (KIASA-010).
        // Updates are installed by hand until releases are signed and checked.
        if (Environment.GetEnvironmentVariable("KIASA_SOUND_DESK_UPDATER") != "unsafe-dev-only") return;
        _updater = new Updater(_account);
        _updater.UpdateReady += () => Dispatcher.BeginInvoke(() =>
        {
            Log.Write("App: update ready, restarting");
            var wasSharing = _sharing;
            StopSharing();
            if (_tray != null) { _tray.Visible = false; _tray.Dispose(); _tray = null; }
            Updater.ApplyAndRestart(false);
            Shutdown();
        });
        _updater.Start();
    }

    private void ShowSignIn(string? message)
    {
        var window = new SignInWindow(_account);
        if (message != null) window.ShowError(message);
        if (window.ShowDialog() == true)
        {
            UpdateTray();
            if (_updater == null) StartUpdater();
            _ = SignedInNow();
        }
    }

    private void UpdateTray()
    {
        if (_tray == null) return;
        var live = _sharing || _session != null;
        _tray.Icon = live ? _liveIcon : _idleIcon;
        var text = _session != null ? $"KIASA — sharing screen with {_session.ManagerName}"
            : _sharing ? "KIASA Sound Desk — sharing sound with admins"
            : _account.MayBeSignedIn ? $"KIASA Sound Desk — {_account.Name}" : "KIASA Sound Desk";
        _tray.Text = text.Length > 63 ? text[..63] : text;
    }

    private void ToggleSharing()
    {
        if (!_account.MayBeSignedIn) { ShowSignIn(null); return; }
        if (_sharing) { StopSharing(); return; }
        // Starting is asked, never done by an accidental double-click (KIASA-009).
        var ok = System.Windows.MessageBox.Show("Share all of your computer's sound with KIASA's admins now? You can stop at any time from the tray icon.",
            "KIASA Sound Desk", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No);
        if (ok == MessageBoxResult.Yes) StartSharing();
    }

    private void StartSharing()
    {
        if (_sharing || !_account.MayBeSignedIn) return;
        try
        {
            Log.Write("StartSharing: begin");
            _loopback = new Loopback();
            _sender = new SoundSender(_account);
            _loopback.OnFrame += _sender.FeedFrame;
            _sender.Refused += () => Dispatcher.BeginInvoke(StopSharing);
            _sender.Start();
            Log.Write("StartSharing: sender started, starting loopback");
            _loopback.Start();
            _sharing = true;
            Log.Write("StartSharing: sharing active");
            UpdateTray();
            _tray?.ShowBalloonTip(4000, "KIASA Sound Desk", "Your computer's sound is shared with KIASA's admins.", System.Windows.Forms.ToolTipIcon.Warning);
        }
        catch (Exception ex)
        {
            Log.Write($"StartSharing FAILED: {ex}");
            _loopback?.Dispose(); _loopback = null;
            _sender?.Dispose(); _sender = null;
        }
    }

    private void StopSharing()
    {
        if (!_sharing) return;
        _sharing = false;
        _loopback?.Dispose();
        _loopback = null;
        _sender?.Dispose();
        _sender = null;
        UpdateTray();
    }

    private void ExitApp()
    {
        _updater?.Dispose();
        StopSharing();
        _session?.Stop(EndReason.AppExit);
        if (_tray != null) { _tray.Visible = false; _tray.Dispose(); _tray = null; }
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _updater?.Dispose();
        StopSharing();
        _session?.Stop(EndReason.AppExit);
        if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
        base.OnExit(e);
    }

    // ── Auto-start ──────────────────────────────────────────────────────────

    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunName = "KIASA Sound Desk";

    private static bool IsAutoStart()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(RunName) != null;
    }

    private static void ToggleAutoStart()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, true);
        if (key == null) return;
        if (key.GetValue(RunName) != null) key.DeleteValue(RunName, false);
        else
        {
            var path = Environment.ProcessPath;
            if (path != null) key.SetValue(RunName, $"\"{path}\"");
        }
    }
}
