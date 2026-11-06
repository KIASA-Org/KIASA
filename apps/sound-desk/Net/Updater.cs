using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;

namespace SoundDesk.Net;

internal sealed class Updater : IDisposable
{
    private static readonly string DataFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KIASA", "SoundDesk");
    private static readonly string UpdateFolder = Path.Combine(DataFolder, "update");
    private static readonly string UpdateExe = Path.Combine(UpdateFolder, "KIASA Sound Desk.exe");
    private static readonly string SharingFlag = Path.Combine(DataFolder, "was-sharing");

    private readonly Account _account;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(10) };
    private System.Timers.Timer? _timer;
    private int _busy;   // one check at a time, so the 15 s heartbeat can poke it freely

    internal event Action? UpdateReady;

    internal static Version CurrentVersion =>
        Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0);

    /// <summary>A short line for the tray menu, so the member can see the update state at a glance.</summary>
    internal string Status { get; private set; } = "Up to date";

    internal Updater(Account account) => _account = account;

    internal void Start()
    {
        CheckNow();
        // A slow fallback; the app also calls CheckNow() from its 15 s heartbeat, so a published
        // update is normally seen within seconds, not hours.
        _timer = new System.Timers.Timer(TimeSpan.FromHours(4).TotalMilliseconds) { AutoReset = true };
        _timer.Elapsed += (_, _) => CheckNow();
        _timer.Start();
    }

    /// <summary>Run one check now, unless one is already running. Cheap to call often: a check is a
    /// tiny request that returns "up to date" until a newer build is published.</summary>
    internal void CheckNow()
    {
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;
        _ = Task.Run(async () => { try { await Check(); } finally { Interlocked.Exchange(ref _busy, 0); } });
    }

    private async Task Check()
    {
        try
        {
            // A verified build is already downloaded and waiting to be applied (on the next idle
            // moment): nothing more to fetch until the app restarts into it.
            if (HasPendingUpdate()) return;
            Log.Write($"Updater: checking (current={CurrentVersion})");
            var token = await _account.Token();
            if (token == null) return;

            using var request = new HttpRequestMessage(HttpMethod.Get, $"{_account.Site}/say/sound-desk/version");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await _http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                Log.Write($"Updater: check failed ({response.StatusCode})");
                return;
            }

            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            var versionStr = body.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
            var url = body.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
            var sha256 = body.TryGetProperty("sha256", out var s) ? s.GetString() ?? "" : "";

            if (!Version.TryParse(versionStr, out var remote) || remote <= CurrentVersion)
            {
                Status = "Up to date";
                Log.Write($"Updater: up to date (remote={versionStr})");
                return;
            }

            if (string.IsNullOrEmpty(url))
            {
                Log.Write("Updater: newer version available but no download URL");
                return;
            }

            // A build is applied only when the server names its SHA-256 and the download matches it.
            // Without that check the updater would run any program the URL served; with it, it runs
            // only the exact build the signed-in server vouches for (KIASA-010).
            if (string.IsNullOrWhiteSpace(sha256))
            {
                Log.Write("Updater: newer version offered without a checksum; refusing (KIASA-010)");
                return;
            }

            Status = $"Downloading update {versionStr}…";
            Log.Write($"Updater: downloading v{versionStr}");
            Directory.CreateDirectory(UpdateFolder);
            var tempPath = UpdateExe + ".tmp";

            using var dl = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            dl.EnsureSuccessStatusCode();
            await using var stream = await dl.Content.ReadAsStreamAsync();
            await using (var file = File.Create(tempPath))
                await stream.CopyToAsync(file);

            using (var check = File.OpenRead(tempPath))
            {
                var header = new byte[2];
                if (check.Read(header, 0, 2) < 2 || header[0] != 0x4D || header[1] != 0x5A)
                {
                    Log.Write("Updater: downloaded file is not a valid exe");
                    File.Delete(tempPath);
                    return;
                }
            }

            string actual;
            using (var hash = System.Security.Cryptography.SHA256.Create())
            await using (var fs = File.OpenRead(tempPath))
                actual = Convert.ToHexString(await hash.ComputeHashAsync(fs)).ToLowerInvariant();
            if (!string.Equals(actual, sha256.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                Log.Write($"Updater: checksum mismatch (expected {sha256}, got {actual}); discarding");
                File.Delete(tempPath);
                return;
            }

            File.Move(tempPath, UpdateExe, true);
            Status = $"Update {versionStr} ready — installs when you're not sharing";
            Log.Write($"Updater: v{versionStr} ready");
            UpdateReady?.Invoke();
        }
        catch (Exception ex)
        {
            Log.Write($"Updater: {ex.Message}");
        }
    }

    internal static bool HasPendingUpdate() => File.Exists(UpdateExe);

    internal static void ApplyAndRestart(bool wasSharing)
    {
        if (!File.Exists(UpdateExe)) return;
        var currentExe = Environment.ProcessPath;
        if (currentExe == null) return;

        Log.Write("Updater: applying");

        var pid = Environment.ProcessId;
        var cmd = Path.Combine(DataFolder, "update.cmd");
        File.WriteAllText(cmd,
            "@echo off\r\n" +
            ":wait\r\n" +
            $"tasklist /fi \"pid eq {pid}\" 2>nul | find \"{pid}\" >nul\r\n" +
            "if not errorlevel 1 (\r\n" +
            "    timeout /t 1 /nobreak >nul\r\n" +
            "    goto wait\r\n" +
            ")\r\n" +
            $"copy /y \"{UpdateExe}\" \"{currentExe}\"\r\n" +
            $"start \"\" \"{currentExe}\"\r\n" +
            $"rmdir /s /q \"{UpdateFolder}\"\r\n" +
            "del \"%~f0\"\r\n");

        Process.Start(new ProcessStartInfo("cmd.exe", $"/c \"{cmd}\"")
        {
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            UseShellExecute = false
        });
        Log.Write("Updater: script launched");
    }

    /// <summary>An old "was sharing" flag (from 1.0.0) is deleted and never honoured (KIASA-009).</summary>
    internal static void ForgetSharingFlag()
    {
        try { if (File.Exists(SharingFlag)) File.Delete(SharingFlag); } catch { }
    }

    internal static void Cleanup()
    {
        var exe = Environment.ProcessPath;
        if (exe != null)
            foreach (var old in Directory.GetFiles(Path.GetDirectoryName(exe)!, "KIASA Sound Desk.exe.old"))
                try { File.Delete(old); } catch { }
        try { if (Directory.Exists(UpdateFolder)) Directory.Delete(UpdateFolder, true); } catch { }
        try { var cmd = Path.Combine(DataFolder, "update.cmd"); if (File.Exists(cmd)) File.Delete(cmd); } catch { }
    }

    public void Dispose()
    {
        _timer?.Stop();
        _timer?.Dispose();
        _http.Dispose();
    }
}
