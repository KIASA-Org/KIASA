using System.Text.Json;

namespace UserDesk.Net;

/// <summary>Subscribes to this user's notify channel and fires TextReceived when the admin types.
///
/// The admin sends only what changed (see the admin desk's NotifyLink): a full text, a change to one
/// version of it, or just a new selection. A change for a version this desk does not have cannot be
/// applied; the desk then asks for the full text (NeedsFull, sent with the presence beat).</summary>
public sealed class NotifyLink : IDisposable
{
    private readonly RealtimeLink _link;
    private readonly object _gate = new();
    private long _lastSeq = long.MinValue;
    private string _text = "";
    private long _ver = -1;
    private volatile bool _needsFull = true;

    /// <summary>text, selection start, selection length — mirrors the admin's box.</summary>
    public event Action<string, int, int>? TextReceived;
    public event Action? Connected;
    public event Action? Disconnected;
    /// <summary>Raised when this desk falls out of step and needs the whole text again.</summary>
    public event Action? FullWanted;
    /// <summary>Raised after a new text version is shown, so it can be reported.</summary>
    public event Action? Applied;

    /// <summary>The version of the text shown (-1 before any).</summary>
    public long Version { get { lock (_gate) return _ver; } }

    /// <summary>True until a full text arrives after joining or after falling out of step.</summary>
    public bool NeedsFull => _needsFull;

    public NotifyLink(Account account)
    {
        _link = new RealtimeLink(account, $"notify:{account.Id}",
            (name, payload) => { if (name == "text") Heard(payload); },
            () => { Want(); Connected?.Invoke(); },
            () => { _needsFull = true; Disconnected?.Invoke(); });
    }

    private void Heard(JsonElement payload)
    {
        // Only while tracing: how long the admin's keystroke took to reach here (same PC, so the
        // clocks match). This is the admin-send → user-receive hop, before any drawing.
        if (Trace.On && payload.TryGetProperty("t", out var tp) && tp.TryGetInt64(out var sentMs))
            Trace.Line($"text seq={(payload.TryGetProperty("seq", out var sq) ? sq.ToString() : "-")} delay={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - sentMs}ms kind={(payload.TryGetProperty("text", out _) ? "full" : payload.TryGetProperty("ins", out _) ? "change" : "select")} bytes={payload.GetRawText().Length}");
        string text;
        long before;
        lock (_gate)
        {
            before = _ver;
            // Keep only the newest: a message that arrives out of order or late is dropped.
            if (payload.TryGetProperty("seq", out var s) && s.TryGetInt64(out var seq))
            {
                if (seq <= _lastSeq) return;
                _lastSeq = seq;
            }
            var v = payload.TryGetProperty("v", out var vp) && vp.TryGetInt64(out var vv) ? vv : -1;
            if (payload.TryGetProperty("text", out var full))
            {
                _text = full.GetString() ?? "";
                _ver = v;
                _needsFull = false;
            }
            else if (payload.TryGetProperty("ins", out var ins))
            {
                var from = payload.TryGetProperty("from", out var fp) && fp.TryGetInt64(out var fv) ? fv : -2;
                var at = payload.TryGetProperty("at", out var ap) && ap.TryGetInt32(out var av) ? av : -1;
                var del = payload.TryGetProperty("del", out var dp) && dp.TryGetInt32(out var dv) ? dv : -1;
                if (from != _ver || at < 0 || del < 0 || at + del > _text.Length) { OutOfStep(); return; }
                _text = string.Concat(_text.AsSpan(0, at), ins.GetString() ?? "", _text.AsSpan(at + del));
                _ver = v;
            }
            else if (v != _ver) { OutOfStep(); return; }   // a selection for a text we do not have
            text = _text;
        }
        var start = payload.TryGetProperty("start", out var st) && st.TryGetInt32(out var sv) ? sv : 0;
        var len = payload.TryGetProperty("len", out var ln) && ln.TryGetInt32(out var lv) ? lv : 0;
        TextReceived?.Invoke(text, start, len);
        if (Version != before) Applied?.Invoke();
    }

    private void OutOfStep()
    {
        if (Trace.On) Trace.Line("out of step: asking for the full text");
        Want();
    }

    private void Want()
    {
        _needsFull = true;
        FullWanted?.Invoke();
    }

    public void Open()  => _link.Open();
    public void Close() => _link.Close();
    public void Dispose() => Close();
}
