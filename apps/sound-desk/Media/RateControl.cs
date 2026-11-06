namespace SoundDesk.Media;

/// <summary>What the screen sender should do now.</summary>
public readonly record struct RatePlan(int VideoBps, int Fps, double Scale, int AudioBps, bool Degraded, string Why);

/// <summary>Decides the screen's bit rate, frame rate and size from what the manager's browser
/// reports back (RTCP receiver reports: loss and round trip).
///
/// Voice first, then a picture that keeps arriving, then smoothness:
///  * the sound keeps 48 kbit/s, or 24 kbit/s only when the picture is already at its least;
///  * on congestion (over 8 % lost, or over 3 % with the round trip over 300 ms, or a round trip
///    over 700 ms) the bit rate falls fast (×0.7, at most
///    every 2 s); the frame rate follows it down (15 → 10 → 5 → 3 → 2 fps);
///  * the picture's size follows the bit rate too (100 % from 700 kbit/s, 75 % from 350,
///    50 % from 150, 37.5 % below), because nothing is resent: one lost packet spoils the
///    picture until the next key frame, and a full-size key frame cannot get through a slow
///    line (measured in the 128–512 kbit/s tests: the picture froze until the size came down);
///  * recovery waits until 8 s have passed without congestion, then rises ×1.15 every 3 s; a size
///    comes back only after 10 s well above its threshold. So quality does not swing.
/// The browser's own estimate (REMB) is kept for the figures only: without send-time header
/// extensions it collapses and then held the rate down (measured).
/// The numbers are design targets, measured in the test matrix, not promises.</summary>
public sealed class RateControl
{
    public const int Start = 1_200_000, Most = 2_500_000, Least = 70_000;
    private int _bps = Start;
    private double _scale = 1.0;
    private int _audio = 48_000;
    private double _sinceBad = 99, _sinceDown = 99, _sinceUp = 99, _audioGoodFor, _clearFor, _bigFor;
    private string _why = "starting";

    public RatePlan Plan => new(_bps, FpsFor(_bps), _scale, _audio, Degraded, _why);
    public bool Degraded { get; private set; }
    public int? LastRemb { get; private set; }

    public static int FpsFor(int bps) => bps >= 600_000 ? 15 : bps >= 300_000 ? 10 : bps >= 150_000 ? 5 : bps >= 90_000 ? 3 : 2;
    public static double ScaleFor(int bps) => bps >= 700_000 ? 1.0 : bps >= 350_000 ? 0.75 : bps >= 150_000 ? 0.5 : 0.375;

    /// <summary>The receiver's own estimate of the line (REMB): recorded, not acted on.</summary>
    public void Remb(int bps) => LastRemb = bps;

    /// <summary>One report: loss since the last (0..1), round trip (ms, or null), seconds since the last.</summary>
    public RatePlan Report(double loss, int? rttMs, double seconds)
    {
        _sinceBad += seconds; _sinceDown += seconds; _sinceUp += seconds;
        // Congestion, not chance: much loss, or some loss with the round trip growing (random loss on
        // a long line, 3% in the test, must not take the picture down to its least).
        var bad = loss > 0.08 || (loss > 0.03 && rttMs > 300) || rttMs > 700;
        var good = loss < 0.02 && (rttMs ?? 0) < 400;
        if (bad) _sinceBad = 0;

        if (bad && _sinceDown >= 2)
        {
            _bps = Math.Max(Least, (int)(_bps * 0.7));
            _sinceDown = 0;
            _why = loss > 0.05 ? $"{loss:P0} lost" : $"round trip {rttMs} ms";
        }
        else if (good && _sinceBad >= 8 && _sinceUp >= 3 && _bps < Most)
        {
            _bps = Math.Min(Most, (int)(_bps * 1.15));
            _sinceUp = 0;
            _why = "line is good";
        }

        // The size: down at once with the rate; up only after a steady 10 s well above the threshold.
        var fit = ScaleFor(_bps);
        if (fit < _scale) { _scale = fit; _bigFor = 0; _why += $", picture at {fit:P0}"; }
        else if (fit > _scale && ScaleFor((int)(_bps / 1.3)) > _scale) { if ((_bigFor += seconds) >= 10) { _scale = ScaleFor((int)(_bps / 1.3)); _bigFor = 0; } }
        else _bigFor = 0;

        // The sound gives way only when the picture has nothing left to give.
        if (_bps <= Least && bad) { _audio = 24_000; _audioGoodFor = 0; }
        else if (good) { _audioGoodFor += seconds; if (_audioGoodFor >= 15) _audio = 48_000; }

        // Said at once, taken back only after 5 s without trouble, so the label does not flicker.
        var poorNow = loss > 0.05 || _bps <= 150_000 || rttMs > 700;
        if (poorNow) { Degraded = true; _clearFor = 0; }
        else if (Degraded && (_clearFor += seconds) >= 5) Degraded = false;
        return Plan;
    }
}
