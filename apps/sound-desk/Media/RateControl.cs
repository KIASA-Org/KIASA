namespace SoundDesk.Media;

/// <summary>What the screen sender should do now.</summary>
public readonly record struct RatePlan(int VideoBps, int Fps, double Scale, int AudioBps, bool Degraded, string Why);

/// <summary>Decides the screen's bit rate, frame rate and size from what the manager's browser
/// reports back (RTCP receiver reports: loss and round trip). This is the only congestion control
/// on the path: SIPSorcery does not pace, retransmit or add error correction, so one lost packet
/// spoils the picture until the next key frame. The aim is therefore to find a rate the line
/// carries cleanly and hold it, not to chase every blip.
///
/// Voice first, then a picture that keeps arriving, then smoothness:
///  * the sound keeps 48 kbit/s, or 24 kbit/s only when the picture is already at its least;
///  * loss is smoothed over a few seconds (a single lost burst must not drop the rate, or the
///    recovery never starts — that was the fault that pinned the picture at its floor);
///  * on sustained congestion (smoothed loss over 8 %, or over 4 % with the round trip over 300 ms,
///    or a round trip over 750 ms) the bit rate falls ×0.72, at most every 2 s; the frame rate
///    follows it down (15 → 10 → 5 → 3 → 2 fps);
///  * the picture's size follows the bit rate (100 % from 700 kbit/s, 75 % from 350, 50 % from
///    150, 37.5 % below), because a full-size key frame cannot get through a slow line at once
///    (measured in the 128–512 kbit/s tests: the picture froze until the size came down);
///  * recovery needs only a short, clean spell — 5 s since the last real drop — then rises ×1.25
///    every 2 s. It is NOT blocked by an occasional lost packet, so a line that has come good is
///    climbed back within seconds, not pinned at the floor. A size comes back after 8 s steady
///    well above its threshold, so quality does not flap.
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
    private double _lossAvg = -1;    // smoothed loss (EWMA, ~6 s), -1 until the first report
    private int _badStreak;          // reports of congestion in a row (a lone one is not acted on)
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

    /// <summary>One report: loss since the last (0..1), round trip (ms, or null), seconds since the last.</summary>
    public RatePlan Report(double loss, int? rttMs, double seconds)
    {
        _sinceDown += seconds; _sinceUp += seconds;
        // Smooth the loss over about six seconds: a single lost burst stays below the congestion line,
        // so it neither drops the rate nor (the important part) blocks the climb back. Sustained loss
        // still builds up over a few reports.
        var alpha = _lossAvg < 0 ? 1.0 : 1.0 - Math.Exp(-Math.Max(0.001, seconds) / 6.0);
        _lossAvg = _lossAvg < 0 ? loss : _lossAvg + (loss - _lossAvg) * alpha;
        var measured = _lossAvg;

        // Congestion, not chance: sustained loss, or some loss with a long or growing round trip.
        var bad = measured > 0.08 || (measured > 0.04 && rttMs > 300) || rttMs > 750;
        var good = measured < 0.03 && (rttMs ?? 0) < 450;
        _badStreak = bad ? _badStreak + 1 : 0;
        // Act only on congestion confirmed over two reports (a lone bad report is a blip, not a failing
        // line), or on an outright severe loss report; and at most once every 2 s.
        var drop = (loss > 0.30 || _badStreak >= 2) && bad;

        if (drop && _sinceDown >= 2)
        {
            _bps = Math.Max(Least, (int)(_bps * 0.72));
            _sinceDown = 0;
            _why = measured > 0.05 ? $"{measured:P0} lost" : $"round trip {rttMs} ms";
        }
        // Climb back as soon as the line is clean and a short cool-down since the last real drop has
        // passed. Not gated on "no loss at all lately", so an occasional blip does not pin the floor.
        else if (good && _sinceDown >= 5 && _sinceUp >= 2 && _bps < Most)
        {
            _bps = Math.Min(Most, (int)(_bps * 1.25));
            _sinceUp = 0;
            _why = "line is good";
        }

        // The size: down at once with the rate; up only after a steady 8 s well above the threshold.
        var fit = ScaleFor(_bps);
        if (fit < _scale) { _scale = fit; _bigFor = 0; _why += $", picture at {fit:P0}"; }
        else if (fit > _scale && ScaleFor((int)(_bps / 1.3)) > _scale) { if ((_bigFor += seconds) >= 8) { _scale = ScaleFor((int)(_bps / 1.3)); _bigFor = 0; } }
        else _bigFor = 0;

        // The sound gives way only when the picture has nothing left to give.
        if (_bps <= Least && bad) { _audio = 24_000; _audioGoodFor = 0; }
        else if (good) { _audioGoodFor += seconds; if (_audioGoodFor >= 15) _audio = 48_000; }

        // Said at once, taken back only after 5 s without trouble, so the label does not flicker.
        var poorNow = measured > 0.05 || _bps <= 150_000 || rttMs > 750;
        if (poorNow) { Degraded = true; _clearFor = 0; }
        else if (Degraded && (_clearFor += seconds) >= 5) Degraded = false;
        return Plan;
    }
}
