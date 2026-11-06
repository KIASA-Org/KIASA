using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using SIPSorcery.Net;
using SoundDesk.Net;

namespace SoundDesk.Support;

public sealed record SessionView(string Id, string Status, string MemberId, string ManagerId, string ManagerName, string ManagerRole,
    string? Seat, string? EndReason, bool ManagerOk, DateTime? InviteExpires)
{
    public static SessionView From(JsonElement e) => new(
        e.GetProperty("id").GetString()!, e.GetProperty("status").GetString()!,
        e.GetProperty("member_id").GetString()!, e.GetProperty("manager_id").GetString()!,
        e.TryGetProperty("manager_name", out var n) ? n.GetString() ?? "" : "",
        e.TryGetProperty("manager_role", out var r) ? r.GetString() ?? "" : "",
        e.TryGetProperty("seat", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null,
        e.TryGetProperty("end_reason", out var x) && x.ValueKind == JsonValueKind.String ? x.GetString() : null,
        !e.TryGetProperty("manager_ok", out var ok) || ok.ValueKind != JsonValueKind.False,
        e.TryGetProperty("invite_expires_at", out var ex) && ex.ValueKind == JsonValueKind.String && DateTime.TryParse(ex.GetString(), out var at) ? at.ToUniversalTime() : null);
}

public sealed record ManagerChoice(string Id, string Name, string Role)
{
    public override string ToString() => $"{Name} ({Role})";
}

public sealed class SupportApiException(string message, int status) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>The database calls a support session needs, as the signed-in member (the database's
/// own rules decide what they may do), and the session's relay from the website.</summary>
public sealed class SupportApi(Account account)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(12) };
    private static readonly string PendingFile = Path.Combine(Environment.GetEnvironmentVariable("KIASA_SOUND_DESK_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KIASA", "SoundDesk"), "pending-end.txt");

    private async Task<JsonElement> Rpc(string name, object body, CancellationToken cancel = default)
    {
        var token = await account.Token() ?? throw new SupportApiException("Not signed in", 401);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{account.Url}/rest/v1/rpc/{name}") { Content = JsonContent.Create(body) };
        request.Headers.Add("apikey", account.Key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await Http.SendAsync(request, cancel);
        var text = await response.Content.ReadAsStringAsync(cancel);
        if (!response.IsSuccessStatusCode)
        {
            var message = text;
            try { message = JsonDocument.Parse(text).RootElement.GetProperty("message").GetString() ?? text; } catch { }
            throw new SupportApiException(message, (int)response.StatusCode);
        }
        return string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement.Clone();
    }

    public async Task<List<ManagerChoice>> Managers()
    {
        var list = await Rpc("support_managers", new { });
        return list.EnumerateArray().Select(e => new ManagerChoice(e.GetProperty("id").GetString()!, e.GetProperty("name").GetString() ?? "", e.GetProperty("role").GetString() ?? "")).ToList();
    }

    public async Task<List<SessionView>> Mine() => (await Rpc("support_mine", new { })).EnumerateArray().Select(SessionView.From).ToList();

    public static object Consent(string screen, bool system, bool mic) => new { screen, system_audio = system, mic };

    public async Task<SessionView> Request(string manager, object consent) => SessionView.From(await Rpc("support_request", new { manager, consent }));
    public async Task<SessionView> Accept(string session, object consent) => SessionView.From(await Rpc("support_accept", new { session, consent }));
    public Task Decline(string session) => Rpc("support_decline", new { session });
    public async Task<SessionView> Beat(string session, CancellationToken cancel = default) => SessionView.From(await Rpc("support_beat", new { session }, cancel));

    public async Task Note(string session, string what, object? detail = null)
    {
        try { await Rpc("support_note", new { session, what, detail = detail ?? new { } }); }
        catch (Exception ex) { Log.Write($"Support: note {what} not written: {ex.Message}"); }
    }

    /// <summary>Ends the session in the database. Tries three times; if it still cannot reach
    /// KIASA, the id is kept and ended at the app's next start. (Capture has already stopped.)</summary>
    public async Task End(string session, string reason)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try { await Rpc("support_end", new { session, reason }); ForgetPending(session); return; }
            catch (SupportApiException ex) when (ex.Status is 401 or 403) { ForgetPending(session); return; }
            catch (Exception ex) { Log.Write($"Support: end not yet written ({ex.Message})"); }
            await Task.Delay(2000 * (attempt + 1));
        }
        try { Directory.CreateDirectory(Path.GetDirectoryName(PendingFile)!); File.AppendAllText(PendingFile, $"{session} {reason}\n"); } catch { }
    }

    /// <summary>At start: ends anything left open by an earlier run. Sharing never resumes by itself.</summary>
    public async Task EndLeftovers()
    {
        try
        {
            if (File.Exists(PendingFile))
                foreach (var line in File.ReadAllLines(PendingFile).Where(l => l.Length > 36))
                    await End(line[..36], line[37..].Trim());
            foreach (var open in (await Mine()).Where(s => s.Status == "live"))
            {
                Log.Write($"Support: session {open.Id[..8]} was still open from before; ending it (app restart)");
                await End(open.Id, EndReason.AppRestart);
            }
        }
        catch (Exception ex) { Log.Write($"Support: leftovers not checked: {ex.Message}"); }
    }

    private static void ForgetPending(string session)
    {
        try
        {
            if (!File.Exists(PendingFile)) return;
            var rest = File.ReadAllLines(PendingFile).Where(l => !l.StartsWith(session)).ToArray();
            if (rest.Length == 0) File.Delete(PendingFile); else File.WriteAllLines(PendingFile, rest);
        }
        catch { }
    }

    /// <summary>The relay for this session (GET /say/support/ice), or the public STUN servers if refused.</summary>
    public async Task<RTCIceServer[]> Ice(string session)
    {
        try
        {
            var token = await account.Token();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{account.Site}/say/support/ice?session={Uri.EscapeDataString(session)}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await Http.SendAsync(request);
            if (!response.IsSuccessStatusCode) { Log.Write($"Support: relay refused ({(int)response.StatusCode})"); return Stun(); }
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            var list = new List<RTCIceServer>();
            foreach (var entry in body.GetProperty("ice").EnumerateArray())
            {
                var username = entry.TryGetProperty("username", out var u) ? u.GetString() : null;
                var credential = entry.TryGetProperty("credential", out var c) ? c.GetString() : null;
                if (!entry.TryGetProperty("urls", out var urls)) continue;
                var all = urls.ValueKind == JsonValueKind.Array ? urls.EnumerateArray().Select(x => x.GetString() ?? "") : [urls.GetString() ?? ""];
                foreach (var url in all.Where(x => x.Length > 0))
                    list.Add(new RTCIceServer { urls = url, username = username, credential = credential });
            }
            return list.Count > 0 ? list.ToArray() : Stun();
        }
        catch (Exception ex) { Log.Write($"Support: relay not reached: {ex.Message}"); return Stun(); }
    }

    private static RTCIceServer[] Stun() => [new RTCIceServer { urls = "stun:stun.l.google.com:19302" }];

    public static string Redact(string text) => text.Length > 200 ? text[..200] : text;
    public static string Utf8(byte[] bytes) => Encoding.UTF8.GetString(bytes);
}
