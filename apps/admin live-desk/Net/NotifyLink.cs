namespace LiveDesk.Net;

/// <summary>Sends the admin's typed text to a chosen user in real time on their notify channel.
/// One channel at a time; calling Open again switches to a different user.</summary>
public sealed class NotifyLink : IDisposable
{
    private readonly Account _account;
    private RealtimeLink? _link;

    public NotifyLink(Account account) => _account = account;

    /// <summary>Opens a channel to the given user. Calls onJoined when the connection is ready,
    /// so any text already in the box can be sent immediately.</summary>
    public void Open(string userId, Action? onJoined = null)
    {
        _link?.Close();
        _link = new RealtimeLink(_account, $"notify:{userId}",
            (_, _) => { },      // admin does not listen on this channel
            () => onJoined?.Invoke(),
            () => { });
        _link.Open();
    }

    /// <summary>Sends the full current text with the admin's selection (start, len) and a sequence
    /// number, so the user mirrors the same highlight and caret and ignores out-of-order messages.
    /// No-op if not connected yet.</summary>
    public void Send(string text, int start, int len, long seq) => _link?.Send("text", new { text, start, len, seq });

    /// <summary>Closes the current channel without clearing the user's screen.</summary>
    public void Close()
    {
        _link?.Close();
        _link = null;
    }

    public void Dispose() => Close();
}
