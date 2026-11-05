using System.Text.Json;

namespace UserDesk.Net;

/// <summary>Subscribes to this user's notify channel and fires TextReceived when the admin types.</summary>
public sealed class NotifyLink : IDisposable
{
    private readonly RealtimeLink _link;

    public event Action<string>? TextReceived;
    public event Action? Connected;
    public event Action? Disconnected;

    public NotifyLink(Account account)
    {
        _link = new RealtimeLink(account, $"notify:{account.Id}",
            (name, payload) =>
            {
                if (name == "text" && payload.TryGetProperty("text", out var t))
                    TextReceived?.Invoke(t.GetString() ?? "");
            },
            () => Connected?.Invoke(),
            () => Disconnected?.Invoke());
    }

    public void Open()  => _link.Open();
    public void Close() => _link.Close();
    public void Dispose() => Close();
}
