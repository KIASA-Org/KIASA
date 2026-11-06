using System.Diagnostics;
using Concentus;
using Concentus.Enums;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using SoundDesk.Net;

namespace SoundDesk.Audio;

/// <summary>Mixes the computer sound and the microphone, each with its own on/off, into one Opus
/// stream (48 kHz mono, 20 ms frames). Each source keeps at most <see cref="MostMs"/> of sound
/// waiting; older sound is thrown away so the delay never grows. A frame goes out every 20 ms
/// whether or not a source gave sound (silence then), so the manager's player keeps time.
///
/// Echo, as routed here:
///  * The manager's voice is played by this app. With process loopback (Windows 11, Windows 10
///    20348+) the computer-sound source leaves this app out, so their voice is not in it.
///    On older Windows it would be: the computer sound is then lowered by 20 dB while the
///    manager is speaking, and the app recommends headphones.
///  * A virtual output device (NVIDIA Broadcast, Voicemeeter...) plays everything again from its
///    own process, which Windows cannot leave out. So the mixer also watches for the manager's
///    voice coming back in the computer sound (the two loudness curves moving together, at a
///    delay up to 400 ms): once seen, it lowers the computer sound while they speak, as above,
///    and says so (<see cref="EchoPathFound"/>).
///  * The microphone hears the speakers. This is an echo guard, not echo cancellation: while
///    the manager is speaking and the microphone is quieter than a clear reply would be, the
///    microphone is lowered by 15 dB. Headphones avoid echo entirely; the app says so.</summary>
public sealed class Mixer : IDisposable
{
    public const int Rate = 48000;
    public const int Frame = 960;
    private const int MostMs = 200;
    private const int MostSamples = Rate * MostMs / 1000;

    private readonly Queue<float> _system = new();
    private readonly Queue<float> _mic = new();
    private readonly object _gate = new();
    private readonly IOpusEncoder _encoder;
    private readonly byte[] _out = new byte[1500];
    private Thread? _thread;
    private volatile bool _running;
    private long _voiceUntil;          // Stopwatch ticks until which the manager counts as speaking
    private float _voiceLevel;

    public volatile bool SystemOn;
    public volatile bool MicOn;
    /// <summary>True when the computer-sound source cannot leave out this app's own playback.</summary>
    public volatile bool DuckSystemForVoice;
    public volatile bool EchoGuard = true;
    public long Dropped;
    public float SystemLevel { get; private set; }
    public float MicLevel { get; private set; }

    public event Action<byte[]>? Encoded;
    /// <summary>The manager's voice was found in the computer sound: it is lowered while they speak from now on.</summary>
    public event Action? EchoPathFound;
    public bool EchoPathSeen { get; private set; }

    private const int Window = 50, MostLag = 20;
    private readonly float[] _voiceEnv = new float[Window + MostLag];
    private readonly float[] _sysEnv = new float[Window + MostLag];
    private int _envAt;
    private float _voiceSince;
    private int _leakWindows;

    /// <summary>How much two loudness curves move together, at the best delay of the second (0..1).</summary>
    public static double BestCorrelation(float[] voice, float[] system, int window, int mostLag)
    {
        double best = 0;
        for (var lag = 0; lag <= mostLag; lag++)
        {
            double sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
            for (var i = 0; i < window; i++)
            {
                double x = voice[i], y = system[i + lag];
                sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
            }
            var cov = sxy - sx * sy / window;
            var vx = sxx - sx * sx / window;
            var vy = syy - sy * sy / window;
            if (vx <= 1e-9 || vy <= 1e-9) continue;
            best = Math.Max(best, cov / Math.Sqrt(vx * vy));
        }
        return best;
    }

    /// <summary>One 20 ms step of both loudness curves; every second, a look for the echo path.</summary>
    private void Watch(float voice, float system)
    {
        if (EchoPathSeen) return;
        Array.Copy(_voiceEnv, 1, _voiceEnv, 0, _voiceEnv.Length - 1);
        Array.Copy(_sysEnv, 1, _sysEnv, 0, _sysEnv.Length - 1);
        _voiceEnv[^1] = voice;
        _sysEnv[^1] = system;
        if (++_envAt % Window != 0) return;
        // The voice, from the oldest part of the history, against the computer sound after it.
        var voiced = 0;
        for (var i = 0; i < Window; i++) if (_voiceEnv[i] > 0.02f) voiced++;
        if (voiced < Window / 12) return;
        var r = BestCorrelation(_voiceEnv, _sysEnv, Window, MostLag);
        _leakWindows = r > 0.7 ? _leakWindows + 1 : 0;
        if (_leakWindows >= 2)
        {
            EchoPathSeen = true;
            DuckSystemForVoice = true;
            Log.Write($"Mixer: the manager's voice is coming back in the computer sound (r={r:F2}): lowering it while they speak");
            EchoPathFound?.Invoke();
        }
    }

    public Mixer(int bitrate = 48_000)
    {
        _encoder = OpusCodecFactory.CreateEncoder(Rate, 1, OpusApplication.OPUS_APPLICATION_AUDIO);
        _encoder.Bitrate = bitrate;
        _encoder.UseInbandFEC = true;
        _encoder.PacketLossPercent = 10;
    }

    public int Bitrate { get => _encoder.Bitrate; set { lock (_gate) _encoder.Bitrate = value; } }

    public void FeedSystem(float[] samples) => Feed(_system, samples);
    public void FeedMic(float[] samples) => Feed(_mic, samples);

    private void Feed(Queue<float> queue, float[] samples)
    {
        lock (_gate)
        {
            foreach (var s in samples) queue.Enqueue(s);
            while (queue.Count > MostSamples) { queue.Dequeue(); Dropped++; }
        }
    }

    /// <summary>The manager's voice, as it is played here (for the echo guard).</summary>
    public void VoicePlayed(float level)
    {
        _voiceLevel = level;
        _voiceSince = Math.Max(_voiceSince, level);
        if (level > 0.02f) _voiceUntil = Stopwatch.GetTimestamp() + Stopwatch.Frequency * 3 / 10;
    }

    public void Start()
    {
        _running = true;
        _thread = new Thread(Loop) { IsBackground = true, Name = "Mixer", Priority = ThreadPriority.AboveNormal };
        _thread.Start();
    }

    private void Loop()
    {
        var clock = Stopwatch.StartNew();
        long sent = 0;
        var pcm = new short[Frame];
        while (_running)
        {
            var due = sent * 20;
            var wait = due - clock.ElapsedMilliseconds;
            if (wait > 1) { Thread.Sleep((int)Math.Min(wait, 20)); continue; }
            // Far behind (the computer was asleep or busy): skip ahead rather than catch up.
            if (wait < -200) sent = clock.ElapsedMilliseconds / 20;
            sent++;
            var speaking = Stopwatch.GetTimestamp() < _voiceUntil;
            float sysPeak = 0, micPeak = 0;
            lock (_gate)
            {
                var systemGain = SystemOn ? (speaking && DuckSystemForVoice ? 0.1f : 1f) : 0f;
                var micRaw = new float[Frame];
                for (var i = 0; i < Frame; i++)
                {
                    var m = _mic.Count > 0 ? _mic.Dequeue() : 0f;
                    micRaw[i] = m;
                    micPeak = Math.Max(micPeak, Math.Abs(m));
                }
                // Echo guard: the manager is speaking and the microphone is not clearly louder than
                // their voice coming back through the speakers would be.
                var micGain = MicOn ? (EchoGuard && speaking && micPeak < Math.Max(0.05f, _voiceLevel * 1.5f) ? 0.18f : 1f) : 0f;
                for (var i = 0; i < Frame; i++)
                {
                    var s = _system.Count > 0 ? _system.Dequeue() : 0f;
                    sysPeak = Math.Max(sysPeak, Math.Abs(s));
                    var mixed = s * systemGain + micRaw[i] * micGain;
                    mixed = mixed > 1 ? 1 : mixed < -1 ? -1 : mixed;
                    pcm[i] = (short)(mixed * 32767);
                }
                SystemLevel = SystemOn ? sysPeak : 0;
                if (SystemOn) Watch(_voiceSince, sysPeak);
                _voiceSince = 0;
                MicLevel = MicOn ? micPeak : 0;
                int length;
                try { length = _encoder.Encode(pcm, Frame, _out, _out.Length); }
                catch (Exception ex) { Log.Write($"Mixer: encode failed: {ex.Message}"); continue; }
                if (length <= 0) continue;
                var frame = new byte[length];
                Array.Copy(_out, frame, length);
                Encoded?.Invoke(frame);
            }
        }
    }

    public void Dispose()
    {
        _running = false;
        _thread?.Join(500);
        lock (_gate) { _system.Clear(); _mic.Clear(); }
    }
}

/// <summary>Plays the manager's voice (Opus over RTP) on the computer's default output for calls.
/// At most ~250 ms waits to be played; anything more is dropped, so the delay cannot grow.</summary>
public sealed class VoicePlayer : IDisposable
{
    private readonly IOpusDecoder _decoder = OpusCodecFactory.CreateDecoder(Mixer.Rate, 1);
    private readonly short[] _pcm = new short[Mixer.Rate / 10];
    private readonly object _gate = new();
    private BufferedWaveProvider? _buffer;
    private WasapiOut? _output;
    private DeviceWatcher? _watcher;
    private int _lastSeq = -1;
    private volatile bool _disposed;

    /// <summary>The loudness just played (0..1), for the echo guard.</summary>
    public event Action<float>? Played;
    public long Packets;

    public void Start()
    {
        Open();
        _watcher = new DeviceWatcher(DataFlow.Render, () => { if (!_disposed) lock (_gate) { Close(); Open(); } });
    }

    private void Open()
    {
        try
        {
            using var devices = new MMDeviceEnumerator();
            var device = devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Communications);
            _buffer = new BufferedWaveProvider(new WaveFormat(Mixer.Rate, 16, 1)) { BufferDuration = TimeSpan.FromMilliseconds(250), DiscardOnBufferOverflow = true, ReadFully = true };
            _output = new WasapiOut(device, AudioClientShareMode.Shared, true, 60);
            _output.Init(_buffer);
            _output.Play();
            Log.Write($"VoicePlayer: playing on {device.FriendlyName}");
        }
        catch (Exception ex) { Log.Write($"VoicePlayer: could not open the output: {ex.Message}"); }
    }

    private void Close()
    {
        try { _output?.Stop(); } catch { }
        _output?.Dispose();
        _output = null;
        _buffer = null;
    }

    public void Packet(ushort seq, byte[] payload)
    {
        if (_disposed || payload.Length == 0) return;
        lock (_gate)
        {
            if (_buffer == null) return;
            Packets++;
            try
            {
                // A gap of a few packets: let the decoder fill it in rather than leave a hole.
                if (_lastSeq >= 0)
                {
                    var gap = (ushort)(seq - _lastSeq) - 1;
                    if (gap is > 0 and <= 3) for (var i = 0; i < gap; i++) Write(_decoder.Decode(ReadOnlySpan<byte>.Empty, _pcm, Mixer.Frame, false));
                    else if (gap < 0 || gap > 1000) { /* late or reordered: play it anyway */ }
                }
                _lastSeq = seq;
                Write(_decoder.Decode(payload, _pcm, _pcm.Length, false));
            }
            catch (Exception ex) { Log.Write($"VoicePlayer: decode failed: {ex.Message}"); }
        }
    }

    private void Write(int samples)
    {
        if (samples <= 0 || _buffer == null) return;
        var bytes = new byte[samples * 2];
        Buffer.BlockCopy(_pcm, 0, bytes, 0, bytes.Length);
        _buffer.AddSamples(bytes, 0, bytes.Length);
        short peak = 0;
        for (var i = 0; i < samples; i++) peak = Math.Max(peak, Math.Abs(_pcm[i] == short.MinValue ? short.MaxValue : _pcm[i]));
        Played?.Invoke(peak / 32768f);
    }

    public void Dispose()
    {
        _disposed = true;
        _watcher?.Dispose();
        lock (_gate) Close();
    }
}
