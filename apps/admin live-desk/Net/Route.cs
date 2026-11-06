using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace LiveDesk.Net;

/// <summary>The way out to KIASA from this computer. Usually straight; but where the line is poor and
/// the browser goes through a proxy, the app can be given the same one. It is a setting of this
/// computer only: kept in the app's own folder (proxy.bin), sealed by Windows to this user like the
/// sign-in, and never part of the app's code.</summary>
internal static class Route
{
    private sealed class Kept
    {
        public string? Url { get; set; }
        public string? User { get; set; }
        public string? Password { get; set; }
    }

    /// <summary>The proxy to go through, or null to go straight.</summary>
    public static IWebProxy? Proxy { get; private set; }

    public static void Load(string folder)
    {
        Proxy = null;
        if (Environment.GetEnvironmentVariable("KIASA_DESK_DIRECT") == "1") return;   // To compare the two ways.
        try
        {
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(Path.Combine(folder, "proxy.bin")), null, DataProtectionScope.CurrentUser);
            var kept = JsonSerializer.Deserialize<Kept>(plain);
            if (kept?.Url is not { Length: > 0 } url || !Uri.TryCreate(url, UriKind.Absolute, out var address)) return;
            Proxy = new WebProxy(address)
            {
                BypassProxyOnLocal = true,
                Credentials = kept.User is { Length: > 0 } user ? new NetworkCredential(user, kept.Password ?? "") : null,
            };
        }
        catch (Exception)
        {
            Proxy = null;   // None set, or from another Windows user: straight.
        }
    }
}
