namespace LiveDesk.Net;

/// <summary>Sends the admin's typed text to a chosen user in real time on their notify channel.
/// One channel at a time; calling Open again switches to a different user.
///
/// Only what changed goes over the line (measured 2026-11-08: sending the whole text on every change
/// made Ctrl+A, delete-all and pastes reach the user 1.5–7 s late on this PC's lossy line). Each text
/// carries a version `v`:
///   full text      { text, v, start, len, seq, t }
///   a change       { from, v, at, del, ins, start, len, seq, t }  — replace `del` chars at `at` with `ins`
///   selection only { v, start, len, seq, t }
/// The user desk applies a change only to version `from`; when it is out of step it says so in its
/// presence beat, and the admin answers with the full text (Resync).</summary>
public sealed class NotifyLink : IDisposable
{
    private readonly Account _account;
    private readonly object _gate = new();
    private RealtimeLink? _link;
    private string? _sent;   // the text the user has, as far as we know; null = send it in full next
    private long _ver;

    public NotifyLink(Account account) => _account = account;

    /// <summary>The version of the text last sent; a user desk reporting another one is out of step.</summary>
    public long Version { get { lock (_gate) return _ver; } }

    /// <summary>When the current version went out (Environment.TickCount64), to say how long the user
    /// desk has been without it.</summary>
    public long SentAt { get { lock (_gate) return _sentAt; } }
    private long _sentAt;

    /// <summary>Whether the user's desk understands changes; an older one only reads full texts.</summary>
    public bool Changes { get; set; }

    /// <summary>Opens a channel to the given user. Calls onJoined when the connection is ready,
    /// so any text already in the box can be sent immediately.</summary>
    public void Open(string userId, Action? onJoined = null)
    {
        _link?.Close();
        lock (_gate) _sent = null;
        Changes = false;
        _link = new RealtimeLink(_account, $"notify:{userId}",
            (_, _) => { },      // admin does not listen on this channel
            () => { Resync(); onJoined?.Invoke(); },
            () => Resync());
        _link.Open();
    }

    /// <summary>The next send carries the whole text.</summary>
    public void Resync() { lock (_gate) _sent = null; }

    /// <summary>Sends the current text and the admin's selection (start, len) with a rising sequence
    /// number. No-op if not connected yet (and the next send is then a full one).</summary>
    public void Send(string text, int start, int len, long seq)
    {
        var link = _link;
        if (link == null) return;
        object payload;
        lock (_gate)
        {
            var t = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_sent == text && Changes)
            {
                payload = new { v = _ver, start, len, seq, t };
            }
            else
            {
                var from = _ver;
                _ver = Math.Max(_ver + 1, t);
                _sentAt = Environment.TickCount64;
                var (at, del, ins) = _sent == null ? (0, 0, text) : Diff(_sent, text);
                if (!Changes || _sent == null || ins.Length + 40 >= text.Length)
                    payload = new { text, v = _ver, start, len, seq, t };
                else
                    payload = new { from, v = _ver, at, del, ins, start, len, seq, t };
            }
            if (!link.SendInOrder("text", payload)) { _sent = null; return; }
            _sent = text;
        }
    }

    /// <summary>The one span that differs: what is the same at the start and the end is kept.</summary>
    private static (int At, int Del, string Ins) Diff(string old, string now)
    {
        var max = Math.Min(old.Length, now.Length);
        var head = 0;
        while (head < max && old[head] == now[head]) head++;
        var tail = 0;
        while (tail < max - head && old[old.Length - 1 - tail] == now[now.Length - 1 - tail]) tail++;
        // Never split a surrogate pair (an emoji) between the kept and the changed part.
        if (head > 0 && char.IsHighSurrogate(now[head - 1])) head--;
        if (tail > 0 && char.IsLowSurrogate(now[now.Length - tail])) tail--;
        return (head, old.Length - head - tail, now.Substring(head, now.Length - head - tail));
    }

    /// <summary>Closes the current channel without clearing the user's screen.</summary>
    public void Close()
    {
        _link?.Close();
        _link = null;
    }

    public void Dispose() => Close();
}
