using System.Timers;

namespace UserDesk.Net;

/// <summary>Tells the admins this user has the desk open, with a small heartbeat on the shared
/// "desk" channel every few seconds (and once the moment it joins).</summary>
public sealed class PresenceLink : IDisposable
{
    private const double BeatMs = 7_000;

    private readonly RealtimeLink _link;
    private readonly string _id;
    private readonly string _name;
    private readonly System.Timers.Timer _beat;

    public PresenceLink(Account account)
    {
        _id = account.Id;
        _name = account.Name;
        _link = new RealtimeLink(account, "desk",
            (_, _) => { },      // the user desk does not listen here
            Beat,               // beat once as soon as the channel is joined
            () => { });
        _beat = new System.Timers.Timer(BeatMs) { AutoReset = true };
        _beat.Elapsed += (_, _) => Beat();
    }

    /// <summary>The notify state to report: the text version shown, and whether the full text is
    /// wanted. Reporting a version also tells the admin desk this desk understands changes.</summary>
    public Func<(long V, bool Want)>? State { get; set; }

    private long _lastBeat;

    private void Beat()
    {
        _lastBeat = Environment.TickCount64;
        if (State is { } state)
        {
            var (v, want) = state();
            _link.Send("here", new { id = _id, name = _name, v, want });
        }
        else _link.Send("here", new { id = _id, name = _name });
    }

    private int _reportWaiting;

    /// <summary>Reports the text version shown soon after it changes, so the admin desk can mark the
    /// member up to date: at most one beat a second, the last change always reported.</summary>
    public void Report()
    {
        var wait = 1_000 - (Environment.TickCount64 - _lastBeat);
        if (wait <= 0) { Beat(); return; }
        if (Interlocked.Exchange(ref _reportWaiting, 1) == 1) return;   // one is already on its way
        _ = Task.Delay((int)wait).ContinueWith(_ => { Interlocked.Exchange(ref _reportWaiting, 0); Beat(); });
    }

    /// <summary>Beats now, to ask for the full text without waiting for the next beat; at most once
    /// a second, as a desk out of step hears several changes it cannot use in a row.</summary>
    public void BeatSoon()
    {
        if (Environment.TickCount64 - _lastBeat >= 1_000) Beat();
    }

    public void Open()
    {
        _link.Open();
        _beat.Start();
    }

    public void Close()
    {
        _beat.Stop();
        _link.Close();
    }

    public void Dispose()
    {
        _beat.Dispose();
        _link.Close();
    }
}
