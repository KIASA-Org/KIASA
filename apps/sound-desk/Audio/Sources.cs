using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wasapi.CoreAudioApi.Interfaces;
using NAudio.Wave;
using SoundDesk.Net;

namespace SoundDesk.Audio;

/// <summary>A sound source giving 48 kHz mono float samples in small pieces.</summary>
public interface ISoundSource : IDisposable
{
    event Action<float[]>? Samples;
    /// <summary>Stopped by itself (device gone, failed). The text says why.</summary>
    event Action<string>? Lost;
    string Name { get; }
    void Start();
}

/// <summary>Turns whatever a device gives (any rate, channels, float or 16-bit) into 48 kHz mono.</summary>
internal sealed class ToMono48
{
    private readonly WaveFormat _format;
    private double _phase;
    private float _last;
    public ToMono48(WaveFormat format) => _format = format;

    public float[]? Convert(byte[] buffer, int bytes)
    {
        float[] raw;
        if (_format.Encoding == WaveFormatEncoding.IeeeFloat || (_format is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71")))
        {
            raw = new float[bytes / 4];
            Buffer.BlockCopy(buffer, 0, raw, 0, raw.Length * 4);
        }
        else if (_format.BitsPerSample == 16)
        {
            raw = new float[bytes / 2];
            for (var i = 0; i < raw.Length; i++) raw[i] = BitConverter.ToInt16(buffer, i * 2) / 32768f;
        }
        else if (_format.BitsPerSample == 32)
        {
            raw = new float[bytes / 4];
            for (var i = 0; i < raw.Length; i++) raw[i] = BitConverter.ToInt32(buffer, i * 4) / 2147483648f;
        }
        else return null;
        var channels = Math.Max(1, _format.Channels);
        var frames = raw.Length / channels;
        var mono = new float[frames];
        for (var i = 0; i < frames; i++)
        {
            float sum = 0;
            for (var c = 0; c < channels; c++) sum += raw[i * channels + c];
            mono[i] = sum / channels;
        }
        if (_format.SampleRate == 48000) return mono;
        // Linear interpolation, carrying the position across pieces so there are no clicks.
        var step = (double)_format.SampleRate / 48000;
        var output = new List<float>((int)(frames / step) + 2);
        while (_phase < frames)
        {
            var index = (int)_phase;
            var frac = (float)(_phase - index);
            var a = index == 0 ? _last : mono[index - 1];
            var b = mono[index];
            output.Add(a + (b - a) * frac);
            _phase += step;
        }
        _phase -= frames;
        _last = frames > 0 ? mono[^1] : _last;
        return output.ToArray();
    }
}

/// <summary>All sound the computer plays, except KIASA Sound Desk's own (so the manager's voice,
/// played by this app, is never sent back to them). Uses Windows' process loopback, which
/// Windows 10 build 20348 and later, and Windows 11, have. On older Windows it falls back to
/// ordinary loopback of the default output device, which does include the manager's voice:
/// the mixer then lowers the computer sound while the manager talks (see <see cref="ExcludesOwnPlayback"/>).</summary>
public sealed class SystemSound : ISoundSource
{
    private IWaveIn? _capture;
    private ToMono48? _convert;
    private DeviceWatcher? _watcher;
    private volatile bool _stopped;

    public event Action<float[]>? Samples;
    public event Action<string>? Lost;
    public string Name { get; private set; } = "computer sound";
    public bool ExcludesOwnPlayback { get; private set; }

    public static bool ProcessLoopbackSupported => Environment.OSVersion.Version.Build >= 20348;

    public void Start()
    {
        _stopped = false;
        if (ProcessLoopbackSupported && Environment.GetEnvironmentVariable("KIASA_DESK_PLAIN_LOOPBACK") != "1")
        {
            try
            {
                var capture = ProcessLoopback.Create(Environment.ProcessId, exclude: Environment.GetEnvironmentVariable("KIASA_DESK_LOOPBACK_INCLUDE") != "1");
                Hook(capture, capture.WaveFormat);
                ExcludesOwnPlayback = true;
                Name = "computer sound (all apps except KIASA)";
                capture.StartRecording();
                Log.Write("SystemSound: process loopback (excluding this app)");
                return;
            }
            catch (Exception ex) { Log.Write($"SystemSound: process loopback failed, plain loopback instead: {ex.Message}"); }
        }
        StartPlain();
        // The default output changed (headphones plugged in): follow it.
        _watcher = new DeviceWatcher(DataFlow.Render, () => { if (!_stopped) { StopCapture(); StartPlain(); } });
    }

    private void StartPlain()
    {
        var capture = new WasapiLoopbackCapture();
        Hook(capture, capture.WaveFormat);
        ExcludesOwnPlayback = false;
        Name = "computer sound (default output)";
        capture.StartRecording();
        Log.Write($"SystemSound: plain loopback of the default output, {capture.WaveFormat}");
    }

    private void Hook(IWaveIn capture, WaveFormat format)
    {
        _capture = capture;
        _convert = new ToMono48(format);
        capture.DataAvailable += (_, e) =>
        {
            if (_stopped || e.BytesRecorded == 0) return;
            var mono = _convert.Convert(e.Buffer, e.BytesRecorded);
            if (mono != null) Samples?.Invoke(mono);
        };
        capture.RecordingStopped += (_, e) =>
        {
            if (_stopped || e.Exception == null) return;
            Log.Write($"SystemSound: stopped: {e.Exception.Message}");
            Lost?.Invoke("The computer sound could not be captured (" + e.Exception.Message + ").");
        };
    }

    private void StopCapture()
    {
        var capture = _capture;
        _capture = null;
        if (capture == null) return;
        try { capture.StopRecording(); } catch { }
        capture.Dispose();
    }

    public void Dispose()
    {
        _stopped = true;
        _watcher?.Dispose();
        StopCapture();
    }
}

/// <summary>The member's microphone (the one Windows uses for calls, or one chosen by name).</summary>
public sealed class Microphone : ISoundSource
{
    private readonly string? _deviceId;
    private WasapiCapture? _capture;
    private DeviceWatcher? _watcher;
    private volatile bool _stopped;

    public event Action<float[]>? Samples;
    public event Action<string>? Lost;
    public string Name { get; private set; } = "microphone";

    public Microphone(string? deviceId) => _deviceId = deviceId;

    public static List<(string Id, string Name)> List()
    {
        using var devices = new MMDeviceEnumerator();
        return devices.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active).Select(d => (d.ID, d.FriendlyName)).ToList();
    }

    public void Start()
    {
        _stopped = false;
        Open();
        if (_deviceId == null) _watcher = new DeviceWatcher(DataFlow.Capture, () => { if (!_stopped) { Close(); try { Open(); } catch (Exception ex) { Lost?.Invoke("The microphone could not be reopened: " + ex.Message); } } });
    }

    private void Open()
    {
        using var devices = new MMDeviceEnumerator();
        var device = _deviceId != null ? devices.GetDevice(_deviceId) : devices.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
        Name = device.FriendlyName;
        var capture = new WasapiCapture(device, true, 20);
        var convert = new ToMono48(capture.WaveFormat);
        capture.DataAvailable += (_, e) =>
        {
            if (_stopped || e.BytesRecorded == 0) return;
            var mono = convert.Convert(e.Buffer, e.BytesRecorded);
            if (mono != null) Samples?.Invoke(mono);
        };
        capture.RecordingStopped += (_, e) =>
        {
            if (_stopped || e.Exception == null) return;
            Log.Write($"Microphone: stopped: {e.Exception.Message}");
            Lost?.Invoke("The microphone stopped (" + e.Exception.Message + ").");
        };
        capture.StartRecording();
        _capture = capture;
        Log.Write($"Microphone: {Name}, {capture.WaveFormat}");
    }

    private void Close()
    {
        var capture = _capture;
        _capture = null;
        if (capture == null) return;
        try { capture.StopRecording(); } catch { }
        capture.Dispose();
    }

    public void Dispose()
    {
        _stopped = true;
        _watcher?.Dispose();
        Close();
    }
}

/// <summary>Calls back when Windows' default device of one kind changes (or one is removed).</summary>
internal sealed class DeviceWatcher : IMMNotificationClient, IDisposable
{
    private readonly MMDeviceEnumerator _devices = new();
    private readonly DataFlow _flow;
    private readonly Action _changed;
    private System.Threading.Timer? _settle;

    public DeviceWatcher(DataFlow flow, Action changed)
    {
        _flow = flow;
        _changed = changed;
        _devices.RegisterEndpointNotificationCallback(this);
    }

    public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
    {
        if (flow != _flow) return;
        Log.Write($"DeviceWatcher: default {flow} device changed ({role})");
        // Windows sends several of these at once (one per role): act once, a moment later, off its thread.
        _settle?.Dispose();
        _settle = new System.Threading.Timer(_ => { try { _changed(); } catch (Exception ex) { Log.Write($"DeviceWatcher: {ex.Message}"); } }, null, 400, Timeout.Infinite);
    }
    public void OnDeviceStateChanged(string deviceId, DeviceState newState) { }
    public void OnDeviceAdded(string pwstrDeviceId) { }
    public void OnDeviceRemoved(string deviceId) { }
    public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key) { }

    public void Dispose()
    {
        try { _devices.UnregisterEndpointNotificationCallback(this); } catch { }
        _settle?.Dispose();
        _devices.Dispose();
    }
}

/// <summary>Windows' process loopback (ActivateAudioInterfaceAsync with VAD\Process_Loopback):
/// the sound of one process tree, or of everything except it.</summary>
public sealed class ProcessLoopback : IWaveIn
{
    private static readonly WaveFormat Format = new(48000, 16, 2);
    private readonly AudioClient _client;
    private readonly EventWaitHandle _ready = new(false, EventResetMode.AutoReset);
    private Thread? _thread;
    private volatile bool _running;

    public WaveFormat WaveFormat { get => Format; set { } }
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    private ProcessLoopback(AudioClient client) => _client = client;

    /// <summary>Made on a multi-threaded apartment thread: the audio client Windows gives back
    /// cannot be used from WPF's single-threaded one.</summary>
    public static ProcessLoopback Create(int processId, bool exclude) =>
        Thread.CurrentThread.GetApartmentState() == ApartmentState.MTA ? CreateHere(processId, exclude) : Task.Run(() => CreateHere(processId, exclude)).GetAwaiter().GetResult();

    private static ProcessLoopback CreateHere(int processId, bool exclude)
    {
        var activation = new ActivationParams { ActivationType = 1, TargetProcessId = (uint)processId, ProcessLoopbackMode = exclude ? 1u : 0u };
        var size = Marshal.SizeOf<ActivationParams>();
        var blob = Marshal.AllocHGlobal(size);
        var variant = Marshal.AllocHGlobal(Marshal.SizeOf<PropVariantBlob>());
        try
        {
            Marshal.StructureToPtr(activation, blob, false);
            Marshal.StructureToPtr(new PropVariantBlob { Vt = 65 /* VT_BLOB */, Size = (uint)size, Data = blob }, variant, false);
            var handler = new Completion();
            var iid = typeof(IAudioClient).GUID;
            ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, variant, handler, out _);
            if (!handler.Done.Wait(5000)) throw new TimeoutException("Windows did not open process loopback");
            var client = new AudioClient(handler.Client ?? throw new InvalidOperationException("No audio client: 0x" + handler.Result.ToString("X8")));
            // Loopback, woken by Windows each time sound is ready, 20 ms buffer.
            client.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.Loopback | AudioClientStreamFlags.EventCallback | (Environment.GetEnvironmentVariable("KIASA_PL_NOCONVERT") == "1" ? 0 : AudioClientStreamFlags.AutoConvertPcm),
                200_000, 0, Format, Guid.Empty);
            return new ProcessLoopback(client);
        }
        finally
        {
            Marshal.FreeHGlobal(variant);
            Marshal.FreeHGlobal(blob);
        }
    }

    public void StartRecording()
    {
        _running = true;
        var started = new TaskCompletionSource();
        _thread = new Thread(() =>
        {
            try { _client.SetEventHandle(_ready.SafeWaitHandle.DangerousGetHandle()); _client.Start(); started.SetResult(); }
            catch (Exception ex) { started.SetException(ex); return; }
            Loop();
        }) { IsBackground = true, Name = "Process loopback", Priority = ThreadPriority.AboveNormal };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
        started.Task.GetAwaiter().GetResult();
    }

    private void Loop()
    {
        Exception? failure = null;
        try
        {
            var capture = _client.AudioCaptureClient;
            var block = Format.BlockAlign;
            var buffer = new byte[Format.AverageBytesPerSecond];
            while (_running)
            {
                // Process loopback wakes only when there is sound; silence is made up below.
                var woke = _ready.WaitOne(100);
                if (!_running) break;
                if (!woke) { var silence = new byte[Format.AverageBytesPerSecond / 10]; DataAvailable?.Invoke(this, new WaveInEventArgs(silence, silence.Length)); continue; }
                int packet;
                while ((packet = capture.GetNextPacketSize()) > 0)
                {
                    var data = capture.GetBuffer(out var frames, out var flags);
                    var bytes = frames * block;
                    if (bytes > buffer.Length) buffer = new byte[bytes];
                    if ((flags & AudioClientBufferFlags.Silent) != 0) Array.Clear(buffer, 0, bytes);
                    else Marshal.Copy(data, buffer, 0, bytes);
                    capture.ReleaseBuffer(frames);
                    DataAvailable?.Invoke(this, new WaveInEventArgs(buffer, bytes));
                }
            }
        }
        catch (Exception ex) { failure = ex; }
        try { _client.Stop(); } catch { }
        RecordingStopped?.Invoke(this, new StoppedEventArgs(_running ? failure : null));
    }

    public void StopRecording()
    {
        _running = false;
        _ready.Set();
        _thread?.Join(1000);
    }

    public void Dispose()
    {
        StopRecording();
        // Released on an MTA thread too, where it was made.
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.MTA) _client.Dispose();
        else Task.Run(_client.Dispose).Wait(1000);
        _ready.Dispose();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ActivationParams { public uint ActivationType; public uint TargetProcessId; public uint ProcessLoopbackMode; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariantBlob { public ushort Vt; public ushort R1, R2, R3; public uint Size; public IntPtr Data; }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid iid, IntPtr parameters,
        IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation operation);

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAgileObject { }

    private sealed class Completion : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEventSlim Done = new();
        public IAudioClient? Client;
        public int Result;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            try
            {
                operation.GetActivateResult(out var result, out var unknown);
                Result = result;
                if (result >= 0) Client = unknown as IAudioClient;
            }
            catch (Exception ex) { Result = ex.HResult; }
            Done.Set();
        }
    }
}
