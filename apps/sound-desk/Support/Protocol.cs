namespace SoundDesk.Support;

/// <summary>The rules that keep old or replayed messages from doing anything, apart from the
/// network, so they can be tested alone.
///  * The manager's page gets a new "seat" each time it opens the session (support_join); the
///    app only answers the seat the database names now. An older tab, or a replayed join, is ignored.
///  * Each offer the app makes has a higher epoch; an answer or candidate for another epoch is ignored.
///  * Once stopped, nothing restarts: every later message is ignored (stop is final and can be called again).</summary>
public sealed class SessionRules
{
    private readonly object _gate = new();
    public string? Seat { get; private set; }
    public int Epoch { get; private set; }
    public string? Peer { get; private set; }
    public bool Stopped { get; private set; }
    public int Seq { get; private set; }

    /// <summary>The database says this is the manager's current seat (from support_beat or support_join's row).</summary>
    public void SeatIs(string? seat) { lock (_gate) Seat = seat; }

    /// <summary>A join from the manager's page: worth an offer only for the current seat.</summary>
    public bool JoinIsCurrent(string? seat)
    {
        lock (_gate) return !Stopped && !string.IsNullOrEmpty(seat) && seat == Seat;
    }

    /// <summary>A new offer to this page instance; returns its epoch.</summary>
    public int NewOffer(string peer)
    {
        lock (_gate) { Epoch += 1; Peer = peer; return Epoch; }
    }

    public bool AnswerFits(string? seat, string? from, int epoch)
    {
        lock (_gate) return !Stopped && seat == Seat && from == Peer && epoch == Epoch;
    }

    public bool CandidateFits(string? seat, int epoch)
    {
        lock (_gate) return !Stopped && seat == Seat && epoch == Epoch;
    }

    /// <summary>The next number for a state message (the page ignores any not higher than the last).</summary>
    public int NextSeq() { lock (_gate) return ++Seq; }

    /// <summary>True only the first time: the caller then does the stopping.</summary>
    public bool Stop()
    {
        lock (_gate) { if (Stopped) return false; Stopped = true; return true; }
    }
}

/// <summary>How a session ends, as written in the database and shown to the manager.</summary>
public static class EndReason
{
    public const string MemberStopped = "member_stopped";
    public const string ManagerEnded = "manager_ended";
    public const string ManagerGone = "manager_gone";
    public const string SignedOut = "signed_out";
    public const string AppRestart = "app_restart";
    public const string AppExit = "app_exit";
    public const string Revoked = "revoked";
    public const string CaptureFailed = "capture_failed";
}
