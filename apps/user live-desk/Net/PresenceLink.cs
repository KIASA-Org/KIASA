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

    private void Beat() => _link.Send("here", new { id = _id, name = _name });

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
