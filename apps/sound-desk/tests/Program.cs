using System.Diagnostics;
using SoundDesk.Capture;
using SoundDesk.Media;

// Desk tests: real capture and encoding on this PC, plus the pure session rules.
// Usage: dotnet run --project tests -- [encode|rules|all]
var what = args.FirstOrDefault() ?? "all";
var failed = 0;
void Check(string name, bool ok, string note = "") { Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name}{(note != "" ? $" ({note})" : "")}"); if (!ok) failed++; }
if (what == "tone") { AudioProbe4.Tone(); return 0; }
if (what == "devices") { AudioDevices.Print(); return 0; }
if (what == "other") { AudioProbe5.Run(Check); return failed; }
if (what is "echo" or "all") EchoTests.Run(Check);

if (what is "encode" or "all")
{
    var displays = Screens.Displays();
    Check("displays are listed", displays.Count > 0, string.Join(", ", displays.Select(d => d.Label)));
    var windows = Screens.Windows();
    Check("windows are listed", windows.Count > 0, $"{windows.Count} windows");
    using var grab = new Grabber(displays[0]);
    var sw = Stopwatch.StartNew();
    var r = grab.Grab();
    Check("a display is captured", r == GrabResult.Ok, $"{grab.Width}x{grab.Height} in {sw.ElapsedMilliseconds} ms");
    var times = new List<double>();
    for (var i = 0; i < 10; i++) { sw.Restart(); grab.Grab(); times.Add(sw.Elapsed.TotalMilliseconds); }
    Console.WriteLine($"      capture: median {times.Order().ElementAt(5):F1} ms per frame");
    foreach (var (label, w, h) in new[] { ("full size", grab.Width, grab.Height), ("half size", grab.Width / 2 & ~1, grab.Height / 2 & ~1) })
    {
        var nv12 = new byte[w * h * 3 / 2];
        sw.Restart();
        Nv12.Convert(grab.Bits, grab.Width, grab.Height, nv12, w, h);
        Console.WriteLine($"      convert {label} {w}x{h}: {sw.Elapsed.TotalMilliseconds:F1} ms");
        foreach (var software in new[] { false, true })
        {
            Environment.SetEnvironmentVariable("KIASA_DESK_SOFTWARE_VIDEO", software ? "1" : null);
            H264Encoder enc;
            try { enc = H264Encoder.Create(w, h, 15, 1_200_000); }
            catch (Exception ex) { Check($"{(software ? "software" : "hardware-first")} encoder starts at {label}", false, ex.Message); continue; }
            var outs = new List<(byte[] au, bool key)>();
            enc.Encoded += (au, key, _) => { lock (outs) outs.Add((au, key)); };
            var encTimes = new List<double>();
            for (var i = 0; i < 30; i++)
            {
                if (i == 20) enc.RequestKeyFrame();
                if (i == 10) enc.SetBitrate(300_000);
                grab.Grab();
                Nv12.Convert(grab.Bits, grab.Width, grab.Height, nv12, w, h);
                sw.Restart();
                enc.Encode(nv12, i * 666_666L, 666_666L);
                encTimes.Add(sw.Elapsed.TotalMilliseconds);
                Thread.Sleep(20);
            }
            Thread.Sleep(300);
            int count, keys; bool sps, pps, idr;
            lock (outs)
            {
                count = outs.Count; keys = outs.Count(o => o.key);
                var nals = outs.Count > 0 ? NalTypes(outs[0].au) : [];
                sps = nals.Contains(7); pps = nals.Contains(8); idr = nals.Contains(5);
            }
            Check($"{enc.Name} ({(enc.Hardware ? "hardware" : "software")}) encodes {label}", count >= 25,
                $"{count}/30 frames, {keys} key frames, first has SPS={sps} PPS={pps} IDR={idr}, median {encTimes.Order().ElementAt(15):F1} ms");
            Check($"{enc.Name}: first frame is decodable on its own", sps && pps && idr);
            Check($"{enc.Name}: a key frame comes on request", keys >= 2, $"{keys} key frames");
            enc.Dispose();
        }
    }
}

if (what is "audio" or "all") AudioTests.Run(Check);
if (what is "probe") { AudioProbe.Include(Check); AudioProbe2.Other(Check); AudioProbe3.Run(Check); AudioProbe4.Run(Check); }
if (what is "rules" or "all") RulesTests.Run(Check);

Console.WriteLine(failed == 0 ? "ALL PASSED" : $"{failed} FAILED");
return failed == 0 ? 0 : 1;

static List<int> NalTypes(byte[] au)
{
    var list = new List<int>();
    for (var i = 0; i + 3 < au.Length; i++)
        if (au[i] == 0 && au[i + 1] == 0 && au[i + 2] == 1) { list.Add(au[i + 3] & 0x1f); i += 3; }
    return list;
}

static partial class RulesTests { static partial void RunCore(Action<string, bool, string> check); public static void Run(Action<string, bool, string> check) => RunCore(check); }
