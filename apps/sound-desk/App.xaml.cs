using System.Windows;
using Microsoft.Win32;
using SoundDesk.Audio;
using SoundDesk.Net;
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

    protected override void OnStartup(StartupEventArgs e)
    {
        _one = new Mutex(true, "KIASA.SoundDesk.One", out var first);
        if (!first) { Shutdown(); return; }
        base.OnStartup(e);
        Updater.Cleanup();
        var autoShare = Updater.WasSharing();
        _account.Ended += () => Dispatcher.BeginInvoke(() =>
        {
            StopSharing();
            ShowSignIn("Your sign-in has ended. Please sign in again.");
        });
        SetupTray();
        _ = TryAutoSignIn(autoShare);
    }

    private void SetupTray()
    {
        var stream = GetResourceStream(new Uri("pack://application:,,,/assets/kiasa.ico"))?.Stream;
        _tray = new System.Windows.Forms.NotifyIcon
        {
            Icon = stream != null ? new System.Drawing.Icon(stream) : System.Drawing.SystemIcons.Application,
            Text = "KIASA Sound Desk",
            Visible = true,
        };
        _tray.ContextMenuStrip = BuildMenu();
        _tray.MouseDoubleClick += (_, _) => ToggleSharing();
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
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        if (_account.MayBeSignedIn)
        {
            var who = menu.Items.Add(_account.Name);
            who!.Enabled = false;
            menu.Items.Add("Sign out", null, (_, _) => Dispatcher.BeginInvoke(async () =>
            {
                StopSharing();
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

    private async Task TryAutoSignIn(bool autoShare)
    {
        if (_account.MayBeSignedIn && await _account.Token() != null)
        {
            UpdateTray();
            StartUpdater();
            if (autoShare) StartSharing();
            return;
        }
        ShowSignIn(null);
    }

    private void StartUpdater()
    {
        _updater = new Updater(_account);
        _updater.UpdateReady += () => Dispatcher.BeginInvoke(() =>
        {
            Log.Write("App: update ready, restarting");
            var wasSharing = _sharing;
            StopSharing();
            if (_tray != null) { _tray.Visible = false; _tray.Dispose(); _tray = null; }
            Updater.ApplyAndRestart(wasSharing);
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
        }
    }

    private void UpdateTray()
    {
        if (_tray == null) return;
        _tray.Text = _sharing
            ? "KIASA Sound Desk — Sharing"
            : _account.MayBeSignedIn
                ? $"KIASA Sound Desk — {_account.Name}"
                : "KIASA Sound Desk";
    }

    private void ToggleSharing()
    {
        if (!_account.MayBeSignedIn) { ShowSignIn(null); return; }
        if (_sharing) StopSharing(); else StartSharing();
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
        if (_tray != null) { _tray.Visible = false; _tray.Dispose(); _tray = null; }
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _updater?.Dispose();
        StopSharing();
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
