using Concentus.Enums;
using Concentus.Structs;
using NAudio.Wave;
using SoundDesk.Net;

namespace SoundDesk.Audio;

/// <summary>Captures all sound that the computer is playing (WASAPI loopback), encodes it as Opus
/// and fires OnFrame every 20 ms with the encoded bytes, ready for WebRTC.</summary>
public sealed class Loopback : IDisposable
{
    private const int Rate = 48000;
    private const int FrameMs = 20;
    private const int FrameSamples = Rate * FrameMs / 1000;

    private WasapiLoopbackCapture? _capture;
    private OpusEncoder? _encoder;
    private float[] _ring = new float[FrameSamples * 4];
    private int _ringUsed;
    private readonly byte[] _out = new byte[4000];
    private readonly object _gate = new();

    public event Action<byte[]>? OnFrame;
    public bool Active => _capture != null;

    public void Start()
    {
        Stop();
        Log.Write("Loopback: creating encoder");
        _encoder = new OpusEncoder(Rate, 1, OpusApplication.OPUS_APPLICATION_AUDIO);
        _encoder.Bitrate = 64000;
        _encoder.UseInbandFEC = true;

        Log.Write("Loopback: creating WasapiLoopbackCapture");
        _capture = new WasapiLoopbackCapture();
        var fmt = _capture.WaveFormat;
        Log.Write($"Loopback: device format = {fmt.Encoding}, {fmt.SampleRate} Hz, {fmt.Channels} ch, {fmt.BitsPerSample} bit");
        _capture.DataAvailable += OnData;
        _capture.RecordingStopped += (_, args) => Log.Write($"Loopback: recording stopped, error={args.Exception?.Message ?? "none"}");
        Log.Write("Loopback: calling StartRecording");
        _capture.StartRecording();
        Log.Write("Loopback: recording started OK");
    }

    private int _dataCount;

    private void OnData(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded == 0 || _capture == null) return;
        _dataCount++;
        if (_dataCount <= 3 || _dataCount % 500 == 0)
            Log.Write($"Loopback: OnData #{_dataCount}, bytes={e.BytesRecorded}");
        var fmt = _capture.WaveFormat;
        var channels = fmt.Channels;

        // Decode to float samples.
        float[] raw;
        if (fmt.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            var count = e.BytesRecorded / 4;
            raw = new float[count];
            Buffer.BlockCopy(e.Buffer, 0, raw, 0, e.BytesRecorded);
        }
        else if (fmt.Encoding == WaveFormatEncoding.Pcm && fmt.BitsPerSample == 16)
        {
            var count = e.BytesRecorded / 2;
            raw = new float[count];
            for (var i = 0; i < count; i++) raw[i] = BitConverter.ToInt16(e.Buffer, i * 2) / 32768f;
        }
        else return;

        // Downmix to mono.
        float[] mono;
        if (channels > 1)
        {
            var n = raw.Length / channels;
            mono = new float[n];
            for (var i = 0; i < n; i++)
            {
                float sum = 0;
                for (var ch = 0; ch < channels; ch++) sum += raw[i * channels + ch];
                mono[i] = sum / channels;
            }
        }
        else mono = raw;

        // Resample to 48 kHz if the device is at a different rate.
        float[] ready;
        if (fmt.SampleRate != Rate)
        {
            var ratio = (double)Rate / fmt.SampleRate;
            var outCount = (int)(mono.Length * ratio);
            ready = new float[outCount];
            for (var i = 0; i < outCount; i++)
            {
                var src = i / ratio;
                var idx = (int)src;
                var frac = (float)(src - idx);
                ready[i] = idx + 1 < mono.Length ? mono[idx] * (1 - frac) + mono[idx + 1] * frac : idx < mono.Length ? mono[idx] : 0;
            }
        }
        else ready = mono;

        // Buffer into 20 ms frames, encode, and fire.
        lock (_gate)
        {
            var need = _ringUsed + ready.Length;
            if (_ring.Length < need) Array.Resize(ref _ring, need + FrameSamples);
            Array.Copy(ready, 0, _ring, _ringUsed, ready.Length);
            _ringUsed += ready.Length;

            while (_ringUsed >= FrameSamples)
            {
                var pcm = new short[FrameSamples];
                for (var i = 0; i < FrameSamples; i++)
                    pcm[i] = (short)Math.Clamp(_ring[i] * 32767f, -32768, 32767);
                Array.Copy(_ring, FrameSamples, _ring, 0, _ringUsed - FrameSamples);
                _ringUsed -= FrameSamples;

                if (_encoder == null) break;
                var len = _encoder.Encode(pcm, 0, FrameSamples, _out, 0, _out.Length);
                if (len > 0)
                {
                    var frame = new byte[len];
                    Array.Copy(_out, frame, len);
                    OnFrame?.Invoke(frame);
                }
            }
        }
    }

    public void Stop()
    {
        var capture = _capture;
        _capture = null;
        if (capture != null) { try { capture.StopRecording(); } catch { } capture.Dispose(); }
        lock (_gate) _ringUsed = 0;
    }

    public void Dispose()
    {
        Stop();
        _encoder = null;
    }
}
