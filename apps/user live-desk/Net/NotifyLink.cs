using System.Text.Json;

namespace UserDesk.Net;

/// <summary>Subscribes to this user's notify channel and fires TextReceived when the admin types.</summary>
public sealed class NotifyLink : IDisposable
{
    private readonly RealtimeLink _link;
    private long _lastSeq = long.MinValue;

    /// <summary>text, selection start, selection length — mirrors the admin's box.</summary>
    public event Action<string, int, int>? TextReceived;
    public event Action? Connected;
    public event Action? Disconnected;

    public NotifyLink(Account account)
    {
        _link = new RealtimeLink(account, $"notify:{account.Id}",
            (name, payload) =>
            {
                if (name != "text" || !payload.TryGetProperty("text", out var t)) return;
                // Only while tracing: how long the admin's keystroke took to reach here (same PC, so the
                // clocks match). This is the admin-send → user-receive hop, before any drawing.
                if (Trace.On && payload.TryGetProperty("t", out var tp) && tp.TryGetInt64(out var sentMs))
                    Trace.Line($"text seq={(payload.TryGetProperty("seq", out var sq) ? sq.ToString() : "-")} delay={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - sentMs}ms len={t.GetString()?.Length ?? 0}");
                // Keep only the newest: a message that arrives out of order or late is dropped,
                // so a small edit is never hidden by an older, longer text landing after it.
                if (payload.TryGetProperty("seq", out var s) && s.TryGetInt64(out var seq))
                {
                    if (seq <= _lastSeq) return;
                    _lastSeq = seq;
                }
                var start = payload.TryGetProperty("start", out var st) && st.TryGetInt32(out var sv) ? sv : 0;
                var len = payload.TryGetProperty("len", out var ln) && ln.TryGetInt32(out var lv) ? lv : 0;
                TextReceived?.Invoke(t.GetString() ?? "", start, len);
            },
            () => Connected?.Invoke(),
            () => Disconnected?.Invoke());
    }

    public void Open()  => _link.Open();
    public void Close() => _link.Close();
    public void Dispose() => Close();
}
