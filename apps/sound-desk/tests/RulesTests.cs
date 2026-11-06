using SoundDesk.Media;
using SoundDesk.Support;

static partial class RulesTests
{
    static partial void RunCore(Action<string, bool, string> check)
    {
        var r = new SessionRules();
        r.SeatIs("seat-1");
        check("a join from the current seat is answered", r.JoinIsCurrent("seat-1"), "");
        check("a join from an old seat is ignored", !r.JoinIsCurrent("seat-0"), "");
        check("a join with no seat is ignored", !r.JoinIsCurrent(null), "");
        var e1 = r.NewOffer("page-a");
        var e2 = r.NewOffer("page-a");
        check("each offer has a higher epoch", e2 > e1, $"{e1} → {e2}");
        check("an answer to an older offer is ignored", !r.AnswerFits("seat-1", "page-a", e1), "");
        check("an answer from another page is ignored", !r.AnswerFits("seat-1", "page-b", e2), "");
        check("an answer from an old seat is ignored", !r.AnswerFits("seat-0", "page-a", e2), "");
        check("the current answer fits", r.AnswerFits("seat-1", "page-a", e2), "");
        r.SeatIs("seat-2");
        check("after the page reopens, the old seat's answer is ignored", !r.AnswerFits("seat-1", "page-a", e2), "");
        check("stop happens once", r.Stop() && !r.Stop(), "");
        check("after stop, a current join is ignored", !r.JoinIsCurrent("seat-2"), "");
        check("after stop, candidates are ignored", !r.CandidateFits("seat-2", e2), "");
        var s1 = r.NextSeq(); var s2 = r.NextSeq();
        check("state numbers rise", s2 > s1, "");

        var rate = new RateControl();
        var start = rate.Plan;
        check("starts at 15 fps, full size", start.Fps == 15 && start.Scale == 1.0, $"{start.VideoBps / 1000} kbit/s");
        RatePlan p = start;
        for (var i = 0; i < 20; i++) p = rate.Report(0.2, 150, 1);
        check("heavy loss lowers the rate and frame rate, keeps voice at 48k until the floor", p.VideoBps < 300_000 && p.Fps <= 5, $"{p.VideoBps / 1000} kbit/s, {p.Fps} fps, audio {p.AudioBps / 1000}k");
        check("heavy loss is called degraded", p.Degraded, p.Why);
        for (var i = 0; i < 20; i++) p = rate.Report(0.2, 150, 1);
        check("a long, very poor line makes the picture smaller, then the voice cheaper", p.Scale < 1.0 && p.AudioBps == 24_000, $"scale {p.Scale}, audio {p.AudioBps / 1000}k");
        var low = p.VideoBps;
        p = rate.Report(0.0, 80, 1);
        check("one good second does not raise it (hysteresis)", p.VideoBps == low, $"{p.VideoBps / 1000}");
        for (var i = 0; i < 60; i++) p = rate.Report(0.0, 80, 1);
        check("a steady good line brings it back slowly", p.VideoBps > low && p.VideoBps < RateControl.Most, $"{low / 1000} → {p.VideoBps / 1000} kbit/s after 60 s");
        var rate2 = new RateControl();
        rate2.Remb(200_000);
        p = rate2.Report(0.0, 50, 1);
        check("the browser's line estimate alone does not cut the rate (it is only recorded)", p.VideoBps >= RateControl.Start && rate2.LastRemb == 200_000, $"{p.VideoBps / 1000} kbit/s");
        var random = new RateControl();
        for (var i = 0; i < 30; i++) random.Report(0.03, 160, 1);
        check("3% random loss on a long, steady line does not take the picture down", random.Plan.VideoBps >= RateControl.Start, $"{random.Plan.VideoBps / 1000} kbit/s");
        var rate3 = new RateControl();
        var flips = 0; var was = false;
        for (var i = 0; i < 60; i++) { var q = rate3.Report(i % 2 == 0 ? 0.12 : 0.0, 100, 1); if (q.Degraded != was) { flips++; was = q.Degraded; } }
        check("alternating loss does not swing quality every second", rate3.Plan.VideoBps < RateControl.Start && flips <= 2, $"{flips} degraded flips, ends {rate3.Plan.VideoBps / 1000} kbit/s");
    }
}
