using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LiveDesk.Net;

/// <summary>The admin's sign-in. The password goes to the site once and is never kept. What is kept
/// (this computer's device mark, and the sign-in that can be renewed) is sealed by Windows to this
/// user. The words of a script are never written anywhere.</summary>
public sealed class Account
{
    private const string DeviceCookie = "kiasa-device";
    private const string RealSite = "https://www.kiasa.tech";   // Exact: kiasa.tech redirects here, and redirects are not followed, as a password goes here.

    private readonly HttpClient _http;
    private readonly SemaphoreSlim _renewing = new(1, 1);
    private readonly string _file;
    private readonly string _site;
    private Kept _kept = new();
    private string? _token;
    private long _expiresAt;

    /// <summary>The sign-in has ended (removed from Your devices, or too old to renew).</summary>
    public event Action? Ended;

    public string Url => _kept.Url ?? "";
    public string Key => _kept.Key ?? "";
    public string Id => _kept.Id ?? "";
    public string Name => _kept.Name ?? "";

    private sealed class Kept
    {
        public string? Device { get; set; }
        public string? Url { get; set; }
        public string? Key { get; set; }
        public string? Id { get; set; }
        public string? Name { get; set; }
        public string? Refresh { get; set; }
    }

    public Account()
    {
        // Tests point this at a site on this computer; nothing else can be chosen, as a password goes there.
        var asked = Environment.GetEnvironmentVariable("KIASA_DESK_SITE");
        _site = asked != null && Uri.TryCreate(asked, UriKind.Absolute, out var uri) && uri.IsLoopback ? asked.TrimEnd('/') : RealSite;
        var folder = Environment.GetEnvironmentVariable("KIASA_DESK_DATA")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KIASA", "LiveDesk");
        Directory.CreateDirectory(folder);
        _file = Path.Combine(folder, _site == RealSite ? "account.bin" : "account-local.bin");
        Route.Load(folder);
        var handler = new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false };
        if (Route.Proxy != null) { handler.Proxy = Route.Proxy; handler.UseProxy = true; }
        if (LiveDesk.Core.Timing.On) LiveDesk.Core.Timing.Line($"route {(Route.Proxy != null ? "proxy" : "straight")}");
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("KIASA-Live-Desk/1.0 (Windows)");
        Load();
    }

    private void Load()
    {
        try
        {
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(_file), null, DataProtectionScope.CurrentUser);
            _kept = JsonSerializer.Deserialize<Kept>(plain) ?? new Kept();
        }
        catch (Exception)
        {
            _kept = new Kept();   // None yet, or from another Windows user.
        }
    }

    private void Save()
    {
        var sealedBytes = ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(_kept), null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_file, sealedBytes);
    }

    /// <summary>The app's own folder on this computer.</summary>
    public string Folder => Path.GetDirectoryName(_file)!;

    public bool MayBeSignedIn => _kept.Refresh != null;

    /// <summary>Signs in through the site. Gives back what to tell the person, or null if it worked.</summary>
    public async Task<string?> SignIn(string email, string password)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_site}/desk/sign-in") { Content = JsonContent.Create(new { email, password }) };
        if (_kept.Device != null) request.Headers.Add("Cookie", $"{DeviceCookie}={_kept.Device}");
        HttpResponseMessage response;
        try { response = await _http.SendAsync(request); }
        catch (Exception) { return "KIASA could not be reached. Check your connection and try again."; }
        using (response)
        {
            // Kept even when refused: asking to be approved is how this computer becomes known.
            if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            {
                foreach (var cookie in cookies)
                {
                    if (!cookie.StartsWith(DeviceCookie + "=", StringComparison.Ordinal)) continue;
                    _kept.Device = cookie[(DeviceCookie.Length + 1)..].Split(';')[0];
                    Save();
                }
            }
            JsonElement body;
            try { body = (await response.Content.ReadFromJsonAsync<JsonElement>()); }
            catch (Exception) { return response.StatusCode == HttpStatusCode.NotFound ? "This version of KIASA does not know the app yet." : "That did not work just now. Please try again in a minute."; }
            if (!response.IsSuccessStatusCode) return body.TryGetProperty("error", out var error) ? error.GetString() : "That did not work just now. Please try again in a minute.";
            _kept.Url = body.GetProperty("url").GetString();
            _kept.Key = body.GetProperty("key").GetString();
            _kept.Id = body.GetProperty("id").GetString();
            _kept.Name = body.GetProperty("name").GetString();
            Took(body);
            return null;
        }
    }

    private void Took(JsonElement body)
    {
        _token = body.GetProperty("access_token").GetString();
        _kept.Refresh = body.GetProperty("refresh_token").GetString();
        _expiresAt = body.TryGetProperty("expires_at", out var at) && at.TryGetInt64(out var seconds) ? seconds : 0;
        Save();
    }

    /// <summary>A token good for a while, renewing it if needed; null if it cannot be had just now.</summary>
    public async Task<string?> Token()
    {
        if (_token != null && _expiresAt - DateTimeOffset.UtcNow.ToUnixTimeSeconds() > 120) return _token;
        await _renewing.WaitAsync();
        try
        {
            if (_token != null && _expiresAt - DateTimeOffset.UtcNow.ToUnixTimeSeconds() > 120) return _token;
            if (_kept.Refresh == null) return null;
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{Url}/auth/v1/token?grant_type=refresh_token") { Content = JsonContent.Create(new { refresh_token = _kept.Refresh }) };
            request.Headers.Add("apikey", Key);
            HttpResponseMessage response;
            try { response = await _http.SendAsync(request); }
            catch (Exception) { return _token; }   // No connection: nothing is known about the sign-in.
            using (response)
            {
                if ((int)response.StatusCode is >= 400 and < 500)
                {
                    Forget();
                    Ended?.Invoke();
                    return null;
                }
                if (!response.IsSuccessStatusCode) return _token;
                Took(await response.Content.ReadFromJsonAsync<JsonElement>());
                return _token;
            }
        }
        finally
        {
            _renewing.Release();
        }
    }

    /// <summary>A read from the database, as this admin. Null if it did not work.</summary>
    public async Task<JsonElement?> Read(string pathAndQuery)
    {
        var token = await Token();
        if (token == null) return null;
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{Url}/rest/v1/{pathAndQuery}");
        request.Headers.Add("apikey", Key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        try
        {
            var began = Environment.TickCount64;
            using var response = await _http.SendAsync(request);
            if (LiveDesk.Core.Timing.On) LiveDesk.Core.Timing.Line($"web {pathAndQuery.Split('?')[0]} {(int)response.StatusCode} took={Environment.TickCount64 - began}ms");
            if (!response.IsSuccessStatusCode) return null;
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>The address of the live connection.</summary>
    public Uri RealtimeAddress()
    {
        var socket = Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? "wss://" + Url[8..] : "ws://" + Url[(Url.IndexOf("//", StringComparison.Ordinal) + 2)..];
        return new Uri($"{socket}/realtime/v1/websocket?apikey={Uri.EscapeDataString(Key)}&vsn=1.0.0");
    }

    /// <summary>Signs out here. This computer stays approved, so signing in again asks nothing.</summary>
    public async Task SignOut()
    {
        var token = _token;
        var url = Url;
        var key = Key;
        Forget();
        if (token == null) return;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{url}/auth/v1/logout?scope=local");
            request.Headers.Add("apikey", key);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var cts = new CancellationTokenSource(3_000);
            using var _ = await _http.SendAsync(request, cts.Token);
        }
        catch (Exception) { /* It ends by itself in time. */ }
    }

    private void Forget()
    {
        _token = null;
        _expiresAt = 0;
        _kept.Refresh = null;
        Save();
    }
}
