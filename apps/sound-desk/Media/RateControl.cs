namespace SoundDesk.Media;

/// <summary>What the screen sender should do now.</summary>
public readonly record struct RatePlan(int VideoBps, int Fps, double Scale, int AudioBps, bool Degraded, string Why);

/// <summary>Decides the screen's bit rate, frame rate and size from what the manager's browser
/// reports back (RTCP receiver reports: packets expected, packets lost, round trip). This is the
/// only congestion control on the path: SIPSorcery does not pace, retransmit or add error
/// correction, so one lost packet spoils the picture until the next key frame. The aim is therefore
/// to find a rate the line carries cleanly and hold it, not to chase every blip.
///
/// The counts matter, not just the fraction. At the floor the picture is a few packets a second
/// (3 fps of a mostly still screen), so a one-second report can cover only two or three packets;
/// one ordinary lost packet is then a third of them. Read as congestion, that pinned the picture at
/// its floor for good even on a clean line (seen in the field 2026-11-06: 0 % loss at the receiver,
/// RTT ~230 ms, yet the sender sat at 100 kbit/s while RustDesk was crisp on the same link). So the
/// controller is given the raw counts and:
///  * judges the line only on a sample big enough to mean something (~60 packets, or 4 s);
///  * treats a stray packet or two lost in a small sample as clean — a failing line loses them in
///    bunches, not in ones — so recovery is never blocked by low-packet-rate noise;
///  * requires real bulk loss (both a high rate AND several packets) before it calls congestion.
///
/// Voice first, then a picture that keeps arriving, then smoothness:
///  * the sound keeps 48 kbit/s, or 24 kbit/s only when the picture is already at its least;
///  * on sustained congestion (smoothed loss over 8 %, or over 4 % with the round trip over 300 ms,
///    or a round trip over 750 ms) the bit rate falls ×0.72, at most every 2 s; the frame rate
///    follows it down (15 → 10 → 5 → 3 → 2 fps);
///  * the picture's size follows the bit rate (100 % from 700 kbit/s, 75 % from 350, 50 % from
///    150, 37.5 % below), because a full-size key frame cannot get through a slow line at once
///    (measured in the 128–512 kbit/s tests: the picture froze until the size came down);
///  * recovery needs only a short, clean spell — 5 s since the last real drop — then rises, fast
///    while far below a healthy picture (×1.6 under 400 kbit/s) and gently near the top (×1.25), so
///    a line that has come good is climbed back within seconds, not pinned at the floor. A size
///    comes back after 8 s steady well above its threshold, so quality does not flap.
/// The browser's own estimate (REMB) is kept for the figures only: without send-time header
/// extensions it collapses and then holds the rate down (measured), so it is never acted on.
/// The numbers are design targets, measured in the test matrix, not promises.</summary>
public sealed class RateControl
{
    // Least is a floor that still shows something (0.375 size, 3 fps): low enough not to overshoot a
    // 128 kbit/s line, high enough that the picture is not the unreadable 70 kbit/s it used to pin at.
    public const int Start = 1_200_000, Most = 2_500_000, Least = 100_000;
    private int _bps = Start;
    private double _scale = 1.0;
    private int _audio = 48_000;
    private double _sinceDown = 99, _sinceUp = 99, _audioGoodFor, _clearFor, _bigFor;
    private double _lossAvg = -1;    // smoothed loss (EWMA across windows), -1 until the first window
    private int _badStreak;          // windows of congestion in a row (a lone one is not acted on)
    private long _winExp, _winLost;  // packets expected / lost gathered since the last decision
    private double _winSecs;         // seconds gathered since the last decision
    private int? _lastRtt;
    private string _why = "starting";

    public RatePlan Plan => new(_bps, FpsFor(_bps), _scale, _audio, Degraded, _why);
    public bool Degraded { get; private set; }
    public int? LastRemb { get; private set; }
    /// <summary>The smoothed loss the controller is acting on (0..1): for diagnostics.</summary>
    public double SmoothedLoss => _lossAvg < 0 ? 0 : _lossAvg;

    public static int FpsFor(int bps) => bps >= 600_000 ? 15 : bps >= 300_000 ? 10 : bps >= 150_000 ? 5 : bps >= 90_000 ? 3 : 2;
    public static double ScaleFor(int bps) => bps >= 700_000 ? 1.0 : bps >= 350_000 ? 0.75 : bps >= 150_000 ? 0.5 : 0.375;

    /// <summary>The receiver's own estimate of the line (REMB): recorded, not acted on.</summary>
    public void Remb(int bps) => LastRemb = bps;

    /// <summary>One receiver report: packets expected and lost since the last, round trip (ms, or
    /// null), seconds since the last. A decision is taken only once enough packets have been seen.</summary>
    public RatePlan Report(int expected, int lost, int? rttMs, double seconds)
    {
        _sinceDown += seconds; _sinceUp += seconds;
        if (rttMs is { } r) _lastRtt = r;
        _winExp += Math.Max(0, expected);
        _winLost += Math.Max(0, lost);
        _winSecs += seconds;
        // Gather a sample big enough to mean something before judging the line. ~60 packets fills in
        // well under a second at a healthy rate (so reaction stays quick when it matters), and the 4 s
        // cap keeps the floor — where packets trickle — deciding at a sensible pace.
        if (_winExp < 60 && _winSecs < 4) return Plan;

        var exp = _winExp; var lostAbs = _winLost; var secs = _winSecs;
        _winExp = 0; _winLost = 0; _winSecs = 0;
        var loss = exp > 0 ? Math.Clamp(lostAbs / (double)exp, 0, 1) : 0;
        var rtt = _lastRtt;

        // Smooth across windows so one bad batch does not overreact, but lightly, so a line that has
        // come good is not held down.
        _lossAvg = _lossAvg < 0 ? loss : _lossAvg + (loss - _lossAvg) * 0.5;
        var measured = _lossAvg;

        // Congestion is real bulk loss (a high rate AND several packets actually lost), or lighter loss
        // with a long/growing round trip, or a long round trip on its own. The absolute-count guard
        // stops a stray packet among a handful — the floor's low packet rate — reading as a failing line.
        var bad = (measured > 0.08 && lostAbs >= 4) || (measured > 0.04 && lostAbs >= 4 && rtt > 300) || rtt > 750;
        // Clean enough to climb: a low loss rate, or — when few packets were seen — only a stray one or
        // two lost (this lets the picture climb off the floor on a clean line whose few packets would
        // otherwise make every single loss look catastrophic). But never climb while the *smoothed* loss
        // is still high: on a genuinely lossy relay a small window can happen to show one or two losses,
        // and climbing back on that alone only drives the picture into the storm and freezes it again.
        var clean = (loss < 0.03 || lostAbs <= 2) && measured < 0.10 && (rtt ?? 0) < 450;
        _badStreak = bad ? _badStreak + 1 : 0;
        // Act on congestion confirmed over two windows (a lone bad one is a blip, not a failing line),
        // or on an outright severe burst (lost in real numbers); and at most once every 2 s.
        var drop = ((loss > 0.30 && lostAbs >= 8) || _badStreak >= 2) && bad;

        if (drop && _sinceDown >= 2)
        {
            _bps = Math.Max(Least, (int)(_bps * 0.72));
            _sinceDown = 0;
            _why = measured > 0.05 ? $"{measured:P0} lost" : $"round trip {rtt} ms";
        }
        // Climb as soon as the line is clean and a short cool-down since the last real drop has passed.
        // Faster while far below a healthy picture so a recovered line is not left at the floor for half
        // a minute; gently near the top so it does not overshoot.
        else if (clean && _sinceDown >= 5 && _sinceUp >= 2 && _bps < Most)
        {
            var step = _bps < 400_000 ? 1.6 : 1.25;
            _bps = Math.Min(Most, (int)(_bps * step));
            _sinceUp = 0;
            _why = "line is good";
        }

        // The size: down at once with the rate; up only after a steady 8 s well above the threshold.
        var fit = ScaleFor(_bps);
        if (fit < _scale) { _scale = fit; _bigFor = 0; _why += $", picture at {fit:P0}"; }
        else if (fit > _scale && ScaleFor((int)(_bps / 1.3)) > _scale) { if ((_bigFor += secs) >= 8) { _scale = ScaleFor((int)(_bps / 1.3)); _bigFor = 0; } }
        else _bigFor = 0;

        // The sound gives way only when the picture has nothing left to give.
        if (_bps <= Least && bad) { _audio = 24_000; _audioGoodFor = 0; }
        else if (clean) { _audioGoodFor += secs; if (_audioGoodFor >= 15) _audio = 48_000; }

        // Said at once, taken back only after 5 s without trouble, so the label does not flicker.
        var poorNow = measured > 0.05 || _bps <= 150_000 || rtt > 750;
        if (poorNow) { Degraded = true; _clearFor = 0; }
        else if (Degraded && (_clearFor += secs) >= 5) Degraded = false;
        return Plan;
    }
}
