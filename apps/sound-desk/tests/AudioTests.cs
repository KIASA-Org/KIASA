using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using SoundDesk.Audio;

static class AudioTests
{
    /// Plays a quiet 997 Hz tone from this process, and measures it through both captures.
    public static void Run(Action<string, bool, string> check)
    {
        check("process loopback is available on this Windows", SystemSound.ProcessLoopbackSupported, $"build {Environment.OSVersion.Version.Build}");
        double Measure(bool plain)
        {
            Environment.SetEnvironmentVariable("KIASA_DESK_PLAIN_LOOPBACK", plain ? "1" : null);
            var energy = 0.0; long n = 0;
            using var source = new SystemSound();
            source.Samples += s => { lock (source) { foreach (var v in s) energy += v * v; n += s.Length; } };
            using var devices = new MMDeviceEnumerator();
            using var output = new WasapiOut(devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia), AudioClientShareMode.Shared, true, 50);
            var tone = new SignalGenerator(48000, 2) { Frequency = 997, Gain = 0.05, Type = SignalGeneratorType.Sin };
            output.Init(tone.Take(TimeSpan.FromMilliseconds(900)));
            source.Start();
            Thread.Sleep(150);
            lock (source) { energy = 0; n = 0; }
            output.Play();
            Thread.Sleep(800);
            output.Stop();
            lock (source) return n == 0 ? -1 : Math.Sqrt(energy / n);
        }
        var plain = Measure(true);
        var excluding = Measure(false);
        check("plain loopback hears this app's own tone", plain > 0.005, $"rms {plain:F4}");
        check("process loopback (excluding KIASA) does not hear it", excluding >= 0 && excluding < plain / 10, $"rms {excluding:F4} vs {plain:F4}");
        Environment.SetEnvironmentVariable("KIASA_DESK_PLAIN_LOOPBACK", null);

        // The mixer: frames every 20 ms, bounded backlog, each source on/off.
        using var mixer = new Mixer();
        var frames = 0;
        mixer.Encoded += _ => Interlocked.Increment(ref frames);
        mixer.SystemOn = true; mixer.MicOn = false;
        mixer.Start();
        mixer.FeedSystem(new float[48000 * 2]); // 2 s at once: most must be dropped
        Thread.Sleep(1000);
        check("mixer sends a frame every 20 ms", frames is >= 45 and <= 55, $"{frames} frames in 1 s");
        check("mixer drops backlog beyond 200 ms", mixer.Dropped >= 48000 * 2 - 9600 - 100, $"{mixer.Dropped} samples dropped");
    }
}
static class AudioProbe
{
    public static void Include(Action<string, bool, string> check)
    {
        Environment.SetEnvironmentVariable("KIASA_DESK_LOOPBACK_INCLUDE", "1");
        var energy = 0.0; long n = 0;
        using var source = new SystemSound();
        source.Samples += s => { lock (source) { foreach (var v in s) energy += v * v; n += s.Length; } };
        using var devices = new MMDeviceEnumerator();
        using var output = new WasapiOut(devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia), AudioClientShareMode.Shared, true, 50);
        output.Init(new SignalGenerator(48000, 2) { Frequency = 997, Gain = 0.05 }.Take(TimeSpan.FromMilliseconds(900)));
        source.Start(); Thread.Sleep(150); lock (source) { energy = 0; n = 0; }
        output.Play(); Thread.Sleep(800); output.Stop();
        Environment.SetEnvironmentVariable("KIASA_DESK_LOOPBACK_INCLUDE", null);
        check("process loopback INCLUDING this app hears the tone", Math.Sqrt(energy / Math.Max(1, n)) > 0.005, $"rms {Math.Sqrt(energy / Math.Max(1, n)):F4}");
    }
}
static class AudioProbe2
{
    public static void Other(Action<string, bool, string> check)
    {
        var other = System.Diagnostics.Process.GetProcessesByName("winlogon").First().Id;
        var capture = (NAudio.Wave.IWaveIn)typeof(SystemSound).Assembly.GetType("SoundDesk.Audio.ProcessLoopback")!
            .GetMethod("Create")!.Invoke(null, [other, false])!;
        var energy = 0.0; long n = 0;
        capture.DataAvailable += (_, e) => { lock (capture) for (var i = 0; i + 1 < e.BytesRecorded; i += 2) { var v = BitConverter.ToInt16(e.Buffer, i) / 32768.0; energy += v * v; n++; } };
        using var devices = new MMDeviceEnumerator();
        using var output = new WasapiOut(devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia), AudioClientShareMode.Shared, true, 50);
        output.Init(new SignalGenerator(48000, 2) { Frequency = 997, Gain = 0.05 }.Take(TimeSpan.FromMilliseconds(900)));
        capture.StartRecording(); Thread.Sleep(150); lock (capture) { energy = 0; n = 0; }
        output.Play(); Thread.Sleep(800); output.Stop();
        capture.Dispose();
        check("process loopback INCLUDING only explorer does not hear this app", Math.Sqrt(energy / Math.Max(1, n)) < 0.003, $"rms {Math.Sqrt(energy / Math.Max(1, n)):F4}, n={n}");
    }
}
static class AudioProbe3
{
    public static double Rms(int pid, bool exclude)
    {
        var capture = SoundDesk.Audio.ProcessLoopback.Create(pid, exclude);
        var energy = 0.0; long n = 0;
        capture.DataAvailable += (_, e) => { lock (capture) for (var i = 0; i + 1 < e.BytesRecorded; i += 2) { var v = BitConverter.ToInt16(e.Buffer, i) / 32768.0; energy += v * v; n++; } };
        using var devices = new MMDeviceEnumerator();
        using var output = new WasapiOut(devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia), AudioClientShareMode.Shared, true, 50);
        output.Init(new SignalGenerator(48000, 2) { Frequency = 997, Gain = 0.05 }.Take(TimeSpan.FromMilliseconds(900)));
        capture.StartRecording(); Thread.Sleep(150); lock (capture) { energy = 0; n = 0; }
        output.Play(); Thread.Sleep(800); output.Stop();
        capture.Dispose();
        return Math.Sqrt(energy / Math.Max(1, n));
    }
    public static void Run(Action<string, bool, string> check)
    {
        var self = Rms(Environment.ProcessId, true);
        var other = Rms(System.Diagnostics.Process.GetProcessesByName("winlogon").First().Id, true);
        check("exclude self", self < 0.003, $"rms {self:F4}");
        check("exclude winlogon hears us", other > 0.005, $"rms {other:F4}");
    }
}
static class AudioProbe4
{
    public static void Tone()
    {
        using var devices = new MMDeviceEnumerator();
        using var output = new WasapiOut(devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia), AudioClientShareMode.Shared, true, 50);
        // A short melody, not a steady tone: speaker noise removal (NVIDIA Broadcast) flattens a steady tone.
        var gen = new SignalGenerator(48000, 2) { Frequency = 440, Gain = 0.1 };
        output.Init(gen.Take(TimeSpan.FromMilliseconds(1500)));
        output.Play();
        for (var i = 0; i < 15; i++) { gen.Frequency = new[] { 440, 554, 659, 880, 330 }[i % 5]; Thread.Sleep(100); }
    }
    public static void Run(Action<string, bool, string> check)
    {
        var capture = SoundDesk.Audio.ProcessLoopback.Create(Environment.ProcessId, true);
        var energy = 0.0; long n = 0;
        capture.DataAvailable += (_, e) => { lock (capture) for (var i = 0; i + 1 < e.BytesRecorded; i += 2) { var v = BitConverter.ToInt16(e.Buffer, i) / 32768.0; energy += v * v; n++; } };
        capture.StartRecording();
        var child = System.Diagnostics.Process.Start(Environment.ProcessPath!, "tone");
        Thread.Sleep(700); lock (capture) { energy = 0; n = 0; }
        Thread.Sleep(600);
        var rms = Math.Sqrt(energy / Math.Max(1, n));
        child.WaitForExit();
        capture.Dispose();
        check("exclude self tree: a child's tone is not heard", rms < 0.003, $"rms {rms:F4}");
    }
}
static class AudioDevices
{
    public static void Print()
    {
        using var d = new MMDeviceEnumerator();
        foreach (var role in new[] { Role.Console, Role.Multimedia, Role.Communications })
            Console.WriteLine($"default render ({role}): {d.GetDefaultAudioEndpoint(DataFlow.Render, role).FriendlyName}");
        foreach (var dev in d.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)) Console.WriteLine("  render: " + dev.FriendlyName);
        Console.WriteLine("audio helper processes: " + string.Join(", ", System.Diagnostics.Process.GetProcesses().Select(p => p.ProcessName).Where(n => n.Contains("Broadcast", StringComparison.OrdinalIgnoreCase) || n.Contains("Nahimic", StringComparison.OrdinalIgnoreCase) || n.Contains("voicemeeter", StringComparison.OrdinalIgnoreCase)).Distinct()));
    }
}
static class EchoTests
{
    /// The echo-path detector, on this PC's real routing: "manager's voice" played by this app
    /// (a tone switched on and off), captured as computer sound, fed to the mixer.
    public static void Run(Action<string, bool, string> check)
    {
        var rnd = new Random(1);
        var v = new float[70]; var sAligned = new float[70]; var sNone = new float[70];
        for (var i = 0; i < 70; i++) { v[i] = rnd.Next(2) == 0 ? 0 : 0.3f; sNone[i] = (float)rnd.NextDouble() * 0.3f; }
        for (var i = 0; i < 70; i++) sAligned[i] = i >= 7 ? v[i - 7] * 0.8f + 0.01f : 0.01f;
        check("correlation finds a delayed copy", Mixer.BestCorrelation(v, sAligned, 50, 20) > 0.9, $"{Mixer.BestCorrelation(v, sAligned, 50, 20):F2}");
        check("correlation ignores unrelated sound", Mixer.BestCorrelation(v, sNone, 50, 20) < 0.5, $"{Mixer.BestCorrelation(v, sNone, 50, 20):F2}");

        using var mixer = new Mixer { SystemOn = true };
        using var system = new SystemSound();
        system.Samples += mixer.FeedSystem;
        var found = false;
        mixer.EchoPathFound += () => found = true;
        mixer.Start();
        system.Start();
        using var devices = new MMDeviceEnumerator();
        var device = devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Communications);
        using var output = new WasapiOut(device, AudioClientShareMode.Shared, true, 40);
        var tone = new SignalGenerator(48000, 1) { Frequency = 440, Gain = 0 };
        output.Init(tone);
        output.Play();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        while (clock.ElapsedMilliseconds < 6000 && !found)
        {
            var on = (clock.ElapsedMilliseconds / 300) % 2 == 0 && (clock.ElapsedMilliseconds / 900) % 3 != 2;
            tone.Gain = on ? 0.05 : 0;
            mixer.VoicePlayed(on ? 0.05f : 0f);
            Thread.Sleep(20);
        }
        output.Stop();
        check($"echo path on this PC ({device.FriendlyName}, {system.Name}) is detected or absent as measured",
            found || !SystemSound.ProcessLoopbackSupported, found ? $"found after {clock.ElapsedMilliseconds} ms; computer sound now lowered while the manager speaks" : "not found");
    }
}
static class AudioProbe5
{
    /// The app's own capture (excluding itself), while a tone plays in a process outside its tree.
    public static void Run(Action<string, bool, string> check)
    {
        foreach (var plain in new[] { false, true })
        {
            Environment.SetEnvironmentVariable("KIASA_DESK_PLAIN_LOOPBACK", plain ? "1" : null);
            var energy = 0.0; long n = 0; var chunks = 0;
            using var source = new SystemSound();
            source.Samples += s => { lock (source) { chunks++; foreach (var v in s) energy += v * v; n += s.Length; } };
            source.Start();
            Thread.Sleep(300);
            lock (source) { energy = 0; n = 0; chunks = 0; }
            var exe = Environment.ProcessPath!;
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("powershell", $"-NoProfile -Command \"Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{{CommandLine='\\\"{exe}\\\" tone'}} | Out-Null\"") { CreateNoWindow = true })!.WaitForExit();
            Thread.Sleep(2500);
            double rms; lock (source) rms = Math.Sqrt(energy / Math.Max(1, n));
            check($"{source.Name} hears a tone from an unrelated process", rms > 0.005, $"rms {rms:F4}, {chunks} chunks");
        }
        Environment.SetEnvironmentVariable("KIASA_DESK_PLAIN_LOOPBACK", null);
    }
}
