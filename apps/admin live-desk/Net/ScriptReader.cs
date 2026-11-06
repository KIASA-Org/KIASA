using System.Text.Json;

namespace LiveDesk.Net;

public enum ReadingState { Opening, Live, Waiting }

/// <summary>What the reader needs of a connection, so it can be tested without one.</summary>
public interface ILink
{
    bool Joined { get; }
    void Open();
    void Close();
    void Send(string name, object payload);
    void Refresh();
}

/// <summary>An admin's side of a member's live script: holds the script as far as it has arrived,
/// and keeps it right. The same behaviour as ScriptReader in the site's live-link.ts, which is
/// where the reasons are written down. Keep the two in step. A member's page from before that
/// code answers with `whole`, which is taken as well.</summary>
public sealed class ScriptReader
{
    private const int CorrectedBack = 2_400;
    private const int CheckLength = 2_048;
    private const long QuietMs = 7_000;
    // Here the app parts from the site on purpose. Measured on a poor line (Nov 2026: 40% of packets
    // lost, a new connection taking 5 to 30 seconds): replacing a quiet connection after 7 seconds,
    // counted from the last word heard, replaced each new one before it could hear anything, 17 times
    // in 5 minutes, and the script stood still in between. So a connection is given this long from
    // when it joined, and longer each time, until something is heard again. A connection that has
    // really gone is found by the link's own heartbeat anyway.
    private const long ReopenQuietMs = 20_000;
    private const long SeenEveryMs = 1_000;
    private const long RefreshEveryMs = 240_000;

    private readonly ILink _link;
    private readonly Action<string, int, string?> _onText;
    private readonly Action<ReadingState> _onState;
    private readonly Func<long> _clock;
    private readonly string _id = Guid.NewGuid().ToString("N")[..8];
    private bool _running;
    private string _text = "";
    private int _start;
    private string? _session;
    private long _n = -1;
    private long _heard;
    private long _asked;
    private long _askAfter = FirstAskAfterMs;
    private const long FirstAskAfterMs = 6_000;   // An answer can take 5 seconds on a poor line: asking again sooner only doubles it.
    private long _joinedAt;
    private int _quietTries;
    private int _behindTicks;
    private long _seenSent = -1;
    private long _lastSeen;
    private long _lastRefresh;
    private long _lostAt;
    private int _tries;
    private long _lastQuietOpen;
    private ReadingState _state = ReadingState.Opening;
    private volatile bool _spoken;

    public ScriptReader(ILink link, Action<string, int, string?> onText, Action<ReadingState> onState, Func<long>? clock = null)
    {
        _link = link;
        _onText = onText;
        _onState = onState;
        _clock = clock ?? (() => Environment.TickCount64);
    }

    /// <summary>A short fingerprint of a piece of text, the same as the site's.</summary>
    public static uint Fingerprint(ReadOnlySpan<char> text)
    {
        var hash = 0x811c9dc5u;
        foreach (var c in text)
        {
            hash ^= c;
            hash = unchecked(hash * 0x01000193u);
        }
        return hash;
    }

    private static long JoinPatience(int tries) => (long)Math.Min(45_000, 20_000 * Math.Pow(1.5, tries));

    private int Ended => _start + _text.Length;

    /// <summary>This member's page says regularly that it is there. A page from before does not, so
    /// silence from it means nothing, and only the list can say it has gone.</summary>
    public bool SaysItIsThere => _spoken;

    public void Begin()
    {
        _running = true;
        var now = _clock();
        _lostAt = now;
        _heard = now;
        _lastRefresh = now;
        _link.Open();
    }

    public void End()
    {
        _running = false;
        _link.Close();
    }

    public void Joined()
    {
        _tries = 0;
        _joinedAt = _clock();
        Ask();
    }

    public void Lost() => _lostAt = _clock();

    private void SetState(ReadingState state)
    {
        if (state == _state) return;
        _state = state;
        _onState(state);
    }

    private void Fresh()
    {
        _heard = _clock();
        _quietTries = 0;
        if (_state == ReadingState.Waiting) SetState(ReadingState.Live);
    }

    private void Show(string? older = null) => _onText(_text, _start, older);

    private void Ask()
    {
        if (!_link.Joined) return;
        _asked = _clock();
        var end = Ended;
        var at = Math.Max(_start, end - CorrectedBack);
        var slice = _text.AsSpan()[Math.Max(0, at - CheckLength - _start)..(at - _start)];
        _link.Send("want", new { id = _id, start = _start, end, h = Fingerprint(slice) });
    }

    private void Settled()
    {
        _asked = 0;
        _askAfter = FirstAskAfterMs;
        _behindTicks = 0;
        SetState(ReadingState.Live);
    }

    public void Heard(string name, JsonElement payload)
    {
        if (!_running) return;
        switch (name)
        {
            case "change": HeardChange(payload); break;
            case "whole": HeardWhole(payload); break;
            case "resync": HeardResync(payload); break;
            case "older": HeardOlder(payload); break;
            case "tick": HeardTick(payload); break;
        }
    }

    private static string? Str(JsonElement p, string name) => p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static long Num(JsonElement p, string name) => p.TryGetProperty(name, out var v) && v.TryGetInt64(out var n) ? n : 0;
    private static bool Yes(JsonElement p, string name) => p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private void HeardChange(JsonElement p)
    {
        Fresh();
        var n = Num(p, "n");
        var session = Str(p, "s");
        if (session != _session)
        {
            _session = session;
            _n = -1;
        }
        if (n <= _n) return;
        var at = (int)Num(p, "at");
        var tail = Str(p, "tail") ?? "";
        // Words from before what is here: this can only be what the script is now.
        if (at < _start) { _text = tail; _start = at; }
        // Words are missing between what is here and this: it cannot be put in place yet.
        else if (at > Ended) { if (_asked == 0) Ask(); return; }
        else _text = _text[..(at - _start)] + tail;
        _n = n;
        Show();
    }

    private void HeardWhole(JsonElement p)
    {
        Fresh();
        _text = Str(p, "text") ?? "";
        _start = 0;
        _n = Num(p, "n");
        _session = null;
        Settled();
        Show();
    }

    private void HeardResync(JsonElement p)
    {
        if (Str(p, "to") != _id) return;
        Fresh();
        _spoken = true;
        var at = (int)Num(p, "at");
        var tail = Str(p, "tail") ?? "";
        if (Yes(p, "reset") || at < _start)
        {
            _text = tail;
            _start = at;
        }
        else _text = _text[..Math.Min(_text.Length, at - _start)] + tail;
        _session = Str(p, "s");
        _n = Num(p, "n");
        Settled();
        Show();
    }

    private void HeardOlder(JsonElement p)
    {
        if (Str(p, "to") != _id) return;
        Fresh();
        var older = Str(p, "text") ?? "";
        var at = (int)Num(p, "at");
        if (at + older.Length != _start) return;
        _text = older + _text;
        _start = at;
        Show(older);
    }

    private void HeardTick(JsonElement p)
    {
        Fresh();
        _spoken = true;
        var session = Str(p, "s");
        if (session != _session)
        {
            // The member's page reloaded: if the words agree, nothing has been lost.
            _session = session;
            _n = Num(p, "n");
        }
        if (_asked != 0) return;
        var n = Num(p, "n");
        var length = Num(p, "l");
        if (n > _n)
        {
            // Changes can still be arriving; twice in a row, or much too far behind, means they are not.
            _behindTicks += 1;
            if (_behindTicks >= 2 || length - Ended > CheckLength) Ask();
            return;
        }
        _behindTicks = 0;
        if (n == _n && (length != Ended || Num(p, "h") != Fingerprint(_text.AsSpan()[Math.Max(0, _text.Length - CheckLength)..]))) Ask();
    }

    /// <summary>Called about four times a second.</summary>
    public void Tick()
    {
        if (!_running) return;
        var now = _clock();
        if (_link.Joined && _asked != 0 && now - _asked > _askAfter)
        {
            _askAfter = (long)Math.Min(15_000, _askAfter * 1.5);
            Ask();
        }
        if (_n != _seenSent && now - _lastSeen >= SeenEveryMs && _link.Joined && _spoken)
        {
            _seenSent = _n;
            _lastSeen = now;
            _link.Send("seen", new { s = _session, n = _n });
        }
        if (now - _lastRefresh >= RefreshEveryMs)
        {
            _lastRefresh = now;
            _link.Refresh();
        }
        var quiet = now - _heard;
        if (_spoken && quiet > QuietMs && _state != ReadingState.Opening) SetState(ReadingState.Waiting);
        if (!_link.Joined)
        {
            if (now - _lostAt > JoinPatience(_tries))
            {
                _tries += 1;
                _lostAt = now;
                _link.Open();
            }
        }
        else if (_spoken && quiet > ReopenQuietMs && now - Math.Max(_lastQuietOpen, _joinedAt) > Math.Min(60_000, ReopenQuietMs * (long)Math.Pow(2, _quietTries)))
        {
            // A joined connection saying nothing: it may be this side's that has gone. Try a new one,
            // but only after this one has had its time since joining, and longer each time in a row.
            _quietTries += 1;
            _tries += 1;
            _lastQuietOpen = now;
            _lostAt = now;
            _link.Open();
        }
    }
}
