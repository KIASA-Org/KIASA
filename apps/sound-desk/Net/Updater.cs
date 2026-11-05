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

    internal event Action? UpdateReady;

    internal static Version CurrentVersion =>
        Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0);

    internal Updater(Account account) => _account = account;

    internal void Start()
    {
        _ = Task.Run(() => Check());
        _timer = new System.Timers.Timer(TimeSpan.FromHours(4).TotalMilliseconds) { AutoReset = true };
        _timer.Elapsed += async (_, _) => await Check();
        _timer.Start();
    }

    private async Task Check()
    {
        try
        {
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

            if (!Version.TryParse(versionStr, out var remote) || remote <= CurrentVersion)
            {
                Log.Write($"Updater: up to date (remote={versionStr})");
                return;
            }

            if (string.IsNullOrEmpty(url))
            {
                Log.Write("Updater: newer version available but no download URL");
                return;
            }

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

            File.Move(tempPath, UpdateExe, true);
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
        if (wasSharing) try { File.WriteAllText(SharingFlag, ""); } catch { }

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

    internal static bool WasSharing()
    {
        if (!File.Exists(SharingFlag)) return false;
        try { File.Delete(SharingFlag); } catch { }
        return true;
    }

    internal static void Cleanup()
    {
        var exe = Environment.ProcessPath;
        if (exe != null)
            foreach (var old in Directory.GetFiles(Path.GetDirectoryName(exe)!, "*.old"))
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
