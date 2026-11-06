using System.Runtime.InteropServices;
using SoundDesk.Net;
using Vortice.MediaFoundation;

namespace SoundDesk.Media;

/// <summary>H.264 (Constrained Baseline, Annex B) for the screen, through Windows Media Foundation:
/// the graphics card's encoder when Windows lists one and it works, else Microsoft's own
/// software encoder, which ships with Windows 10 and 11 (not the "N" editions without the
/// Media Feature Pack: then Create throws and the app says the screen cannot be shared).
/// Encoded frames come out through <see cref="Encoded"/>: on the caller's thread for the
/// software encoder, on the encoder's event thread for a hardware one.</summary>
public sealed class H264Encoder : IDisposable
{
    private static readonly Guid CodecApiRateControl = new(0x1c0608e9, 0x370c, 0x4710, 0x8a, 0x58, 0xcb, 0x61, 0x81, 0xc4, 0x24, 0x23);
    private static readonly Guid CodecApiMeanBitRate = new(0xf7222374, 0x2144, 0x4815, 0xb5, 0x50, 0xa3, 0x7f, 0x8e, 0x12, 0xee, 0x52);
    private static readonly Guid CodecApiLowLatency = new(0x9c27891a, 0xed7a, 0x40e1, 0x88, 0xe8, 0xb2, 0x27, 0x27, 0xa0, 0x24, 0xee);
    private static readonly Guid CodecApiGopSize = new(0x95f31b26, 0x95a4, 0x41aa, 0x93, 0x03, 0x24, 0x6a, 0x7f, 0xc6, 0xee, 0xf1);
    private static readonly Guid CodecApiForceKeyFrame = new(0x398c1b98, 0x8353, 0x475a, 0x9e, 0xf2, 0x8f, 0x26, 0x5d, 0x26, 0x03, 0x45);
    private static readonly Guid CodecApiBFrames = new(0x8d390aac, 0xdc5c, 0x4200, 0xb5, 0x7f, 0x81, 0x4d, 0x04, 0xba, 0xba, 0xb2);
    private static readonly Guid CodecApiBufferSize = new(0x0db96574, 0xb6a4, 0x4c8b, 0x81, 0x06, 0x37, 0x73, 0xde, 0x03, 0x10, 0xcd);

    /// <summary>The encoder's buffer: one frame's worth at the frame rate the line allows,
    /// so no single frame (a key frame especially) is far bigger than the line can carry at once.</summary>
    private static uint BufferFor(int bitrate) => (uint)Math.Max(24_000, bitrate / Media.RateControl.FpsFor(bitrate));
    private const int NeedMoreInput = unchecked((int)0xC00D6D72); // MF_E_TRANSFORM_NEED_MORE_INPUT
    private const int StreamChange = unchecked((int)0xC00D6D61);  // MF_E_TRANSFORM_STREAM_CHANGE
    private const int ProvidesSamples = 0x100;                     // MFT_OUTPUT_STREAM_PROVIDES_SAMPLES
    private const int ProfileBaseline = 66;

    private static int _started;

    private readonly IMFTransform _mft;
    private readonly ICodecApi? _codec;
    private readonly bool _async;
    private readonly IMFMediaEventGenerator? _events;
    private readonly SemaphoreSlim _needInput = new(0, 64);
    private readonly Thread? _pump;
    private readonly byte[]? _sequenceHeader;
    private readonly object _gate = new();
    private volatile bool _disposed;
    private bool _forceKey;

    public int Width { get; }
    public int Height { get; }
    public int Fps { get; private set; }
    public int Bitrate { get; private set; }
    public string Name { get; }
    public bool Hardware { get; }
    /// <summary>An access unit (Annex B), whether it is a key frame, and its time (100 ns units).</summary>
    public event Action<byte[], bool, long>? Encoded;
    /// <summary>The encoder failed while running (a hardware encoder lost, a driver reset).</summary>
    public event Action<string>? Failed;

    private H264Encoder(IMFTransform mft, string name, bool hardware, int width, int height, int fps, int bitrate)
    {
        _mft = mft; Name = name; Hardware = hardware; Width = width; Height = height; Fps = fps; Bitrate = bitrate;
        var attributes = mft.Attributes;
        _async = hardware && TryGetUInt(attributes, TransformAttributeKeys.TransformAsync) == 1;
        if (_async) attributes.Set(TransformAttributeKeys.TransformAsyncUnlock, 1u);
        try { attributes.Set(CodecApiLowLatency, 1u); } catch { }

        _codec = Marshal.GetObjectForIUnknown(mft.NativePointer) as ICodecApi;
        Set(CodecApiRateControl, 0u);            // constant bit rate: the network decides it
        Set(CodecApiMeanBitRate, (uint)bitrate);
        Set(CodecApiBufferSize, BufferFor(bitrate));
        Set(CodecApiLowLatency, 1u);
        Set(CodecApiBFrames, 0u);
        Set(CodecApiGopSize, (uint)(fps * 10));  // a key frame at least every 10 s, and on request after loss

        using (var output = MediaFactory.MFCreateMediaType())
        {
            output.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video);
            output.Set(MediaTypeAttributeKeys.Subtype, VideoFormatGuids.H264);
            output.Set(MediaTypeAttributeKeys.AvgBitrate, (uint)bitrate);
            output.Set(MediaTypeAttributeKeys.FrameSize, Pack(width, height));
            output.Set(MediaTypeAttributeKeys.FrameRate, Pack(fps, 1));
            output.Set(MediaTypeAttributeKeys.PixelAspectRatio, Pack(1, 1));
            output.Set(MediaTypeAttributeKeys.InterlaceMode, 2u); // progressive
            output.Set(MediaTypeAttributeKeys.Mpeg2Profile, (uint)ProfileBaseline);
            Step("output type", () => mft.SetOutputType(0, output, 0));
        }
        using (var input = MediaFactory.MFCreateMediaType())
        {
            input.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video);
            input.Set(MediaTypeAttributeKeys.Subtype, VideoFormatGuids.NV12);
            input.Set(MediaTypeAttributeKeys.FrameSize, Pack(width, height));
            input.Set(MediaTypeAttributeKeys.FrameRate, Pack(fps, 1));
            input.Set(MediaTypeAttributeKeys.PixelAspectRatio, Pack(1, 1));
            input.Set(MediaTypeAttributeKeys.InterlaceMode, 2u);
            Step("input type", () => mft.SetInputType(0, input, 0));
        }
        try { using var current = mft.GetOutputCurrentType(0); _sequenceHeader = current.GetBlob(MediaTypeAttributeKeys.MpegSequenceHeader); } catch { }

        // Not every encoder answers these (Microsoft's software one refuses some): optional.
        foreach (var message in new[] { TMessageType.MessageNotifyBeginStreaming, TMessageType.MessageNotifyStartOfStream })
            try { mft.ProcessMessage(message, UIntPtr.Zero); } catch (Exception ex) { Log.Write($"H264: {name} {message}: {ex.Message.Split((char)10)[0]}"); }
        if (_async)
        {
            _events = mft.QueryInterface<IMFMediaEventGenerator>();
            _pump = new Thread(Pump) { IsBackground = true, Name = "H264 events" };
            _pump.Start();
        }
    }

    /// <summary>The best encoder that will take this size: hardware first (unless
    /// KIASA_DESK_SOFTWARE_VIDEO=1), then software. Throws if none works.</summary>
    public static H264Encoder Create(int width, int height, int fps, int bitrate, bool softwareOnly = false)
    {
        if (Interlocked.Exchange(ref _started, 1) == 0) MediaFactory.MFStartup(true).CheckError();
        var errors = new List<string>();
        var allowHardware = !softwareOnly && Environment.GetEnvironmentVariable("KIASA_DESK_SOFTWARE_VIDEO") != "1";
        foreach (var hardware in allowHardware ? new[] { true, false } : new[] { false })
        {
            var flags = (uint)((hardware ? EnumFlag.EnumFlagHardware : EnumFlag.EnumFlagSyncmft) | EnumFlag.EnumFlagSortandfilter);
            var output = new RegisterTypeInfo { GuidMajorType = MediaTypeGuids.Video, GuidSubtype = VideoFormatGuids.H264 };
            IMFActivate[] found;
            try { found = MediaFactory.MFTEnumEx(TransformCategoryGuids.VideoEncoder, flags, null, output).ToArray(); }
            catch (Exception ex) { errors.Add($"{(hardware ? "hardware" : "software")} list: {ex.Message}"); continue; }
            foreach (var activate in found)
            {
                var name = TryGetString(activate, TransformAttributeKeys.MftFriendlyNameAttribute) ?? (hardware ? "Hardware H.264 encoder" : "Windows H.264 encoder");
                try
                {
                    var mft = activate.ActivateObject<IMFTransform>();
                    var encoder = new H264Encoder(mft, name, hardware, width, height, fps, bitrate);
                    Log.Write($"H264: using {name} ({(hardware ? "hardware" : "software")}) {width}x{height}@{fps} {bitrate / 1000} kbit/s");
                    return encoder;
                }
                catch (Exception ex) { errors.Add($"{name}: {ex.Message}"); Log.Write($"H264: {name} refused: {ex}"); }
            }
        }
        throw new InvalidOperationException("No H.264 encoder works on this computer: " + string.Join("; ", errors));
    }

    public void SetBitrate(int bitrate)
    {
        if (bitrate == Bitrate) return;
        Bitrate = bitrate;
        Set(CodecApiMeanBitRate, (uint)bitrate);
        Set(CodecApiBufferSize, BufferFor(bitrate));
    }

    /// <summary>Only the timing changes: frames simply come less often (the size needs a new encoder).</summary>
    public void SetFps(int fps) => Fps = fps;

    public void RequestKeyFrame() { _forceKey = true; }

    /// <summary>Encodes one NV12 picture. Returns false if the encoder could not take it now
    /// (a hardware encoder still busy): the picture is dropped, never queued.</summary>
    public bool Encode(byte[] nv12, long time100ns, long duration100ns)
    {
        if (_disposed) return false;
        if (_async && !_needInput.Wait(150)) return false;
        lock (_gate)
        {
            if (_disposed) return false;
            if (_forceKey) { _forceKey = false; Set(CodecApiForceKeyFrame, 1u); }
            using var buffer = MediaFactory.MFCreateMemoryBuffer(nv12.Length);
            buffer.Lock(out var pointer, out _, out _);
            try { Marshal.Copy(nv12, 0, pointer, nv12.Length); }
            finally { buffer.Unlock(); }
            buffer.CurrentLength = nv12.Length;
            using var sample = MediaFactory.MFCreateSample();
            sample.AddBuffer(buffer);
            sample.SampleTime = time100ns;
            sample.SampleDuration = duration100ns;
            try { _mft.ProcessInput(0, sample, 0); }
            catch (SharpGen.Runtime.SharpGenException ex) when (!_async && ex.ResultCode.Code == unchecked((int)0xC00D36B5)) // MF_E_NOTACCEPTING
            {
                Drain();
                _mft.ProcessInput(0, sample, 0);
            }
            if (!_async) Drain();
        }
        return true;
    }

    /// <summary>Takes every finished picture out of a software encoder.</summary>
    private void Drain()
    {
        while (!_disposed)
        {
            var result = TakeOutput(out var bytes, out var key, out var time);
            if (result == NeedMoreInput) return;
            if (result == StreamChange) { RenegotiateOutput(); continue; }
            if (result < 0) throw new COMException("ProcessOutput", result);
            if (bytes != null) Encoded?.Invoke(bytes, key, time);
        }
    }

    private int TakeOutput(out byte[]? bytes, out bool key, out long time)
    {
        bytes = null; key = false; time = 0;
        var info = _mft.GetOutputStreamInfo(0);
        IMFSample? given = null;
        if ((info.Flags & ProvidesSamples) == 0)
        {
            given = MediaFactory.MFCreateSample();
            using var space = MediaFactory.MFCreateMemoryBuffer(Math.Max(info.Size, Width * Height * 2));
            given.AddBuffer(space);
        }
        var data = new OutputDataBuffer { StreamID = 0, Sample = given! };
        var result = _mft.ProcessOutput(0, 1, ref data, out _);
        var sample = data.Sample;
        try
        {
            if (result.Failure) return result.Code;
            if (sample == null) return 0;
            time = sample.SampleTime;
            key = TryGetUInt(sample, SampleAttributeKeys.CleanPoint) == 1;
            using var whole = sample.ConvertToContiguousBuffer();
            whole.Lock(out var pointer, out _, out var length);
            try { bytes = new byte[length]; Marshal.Copy(pointer, bytes, 0, length); }
            finally { whole.Unlock(); }
            if (key && _sequenceHeader is { Length: > 0 } && !HasSps(bytes)) bytes = [.. _sequenceHeader, .. bytes];
            return 0;
        }
        finally
        {
            try { data.Events?.Dispose(); } catch { }
            if (sample != null && !ReferenceEquals(sample, given)) sample.Dispose();
            given?.Dispose();
        }
    }

    private void RenegotiateOutput()
    {
        using var type = _mft.GetOutputAvailableType(0, 0);
        _mft.SetOutputType(0, type, 0);
    }

    /// <summary>A hardware encoder's own thread: it says when it wants a picture and when one is ready.</summary>
    private void Pump()
    {
        try
        {
            while (!_disposed)
            {
                using var evt = _events!.GetEvent(0);
                switch (evt.EventType)
                {
                    case MediaEventTypes.TransformNeedInput:
                        try { _needInput.Release(); } catch (SemaphoreFullException) { }
                        break;
                    case MediaEventTypes.TransformHaveOutput:
                        byte[]? bytes; bool key; long time; int result;
                        lock (_gate) result = TakeOutput(out bytes, out key, out time);
                        if (result == StreamChange) { lock (_gate) RenegotiateOutput(); }
                        else if (result < 0 && result != NeedMoreInput) throw new COMException("ProcessOutput", result);
                        else if (bytes != null) Encoded?.Invoke(bytes, key, time);
                        break;
                }
            }
        }
        catch (Exception ex) when (!_disposed)
        {
            Log.Write($"H264: {Name} failed: {ex.Message}");
            Failed?.Invoke(ex.Message);
        }
        catch { }
    }

    private static bool HasSps(byte[] au)
    {
        for (var i = 0; i + 4 < au.Length && i < 64; i++)
            if (au[i] == 0 && au[i + 1] == 0 && au[i + 2] == 1 && (au[i + 3] & 0x1f) == 7) return true;
        return false;
    }

    private void Set(Guid api, uint value)
    {
        if (_codec == null) return;
        try { object v = value; var g = api; var hr = _codec.SetValue(ref g, ref v); if (hr < 0) Log.Write($"H264: {Name} setting {api} = {value} refused 0x{hr:X8}"); }
        catch (Exception ex) { Log.Write($"H264: setting {api}: {ex.Message}"); }
    }

    private static void Step(string what, Action act) { try { act(); } catch (Exception ex) { throw new InvalidOperationException($"{what}: {ex.Message.Split((char)10)[0]}", ex); } }

    private static ulong Pack(int high, int low) => ((ulong)(uint)high << 32) | (uint)low;

    private static uint TryGetUInt(IMFAttributes attributes, Guid key)
    {
        try { return attributes.GetUInt32(key); } catch { return 0; }
    }

    private static string? TryGetString(IMFAttributes attributes, Guid key)
    {
        try { return attributes.GetString(key); } catch { return null; }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        lock (_gate)
        {
            try { _mft.ProcessMessage(TMessageType.MessageNotifyEndOfStream, UIntPtr.Zero); } catch { }
            try { _mft.ProcessMessage(TMessageType.MessageNotifyEndStreaming, UIntPtr.Zero); } catch { }
            try { if (_async) MediaFactory.MFShutdownObject(_mft); } catch { }
        }
        _pump?.Join(500);
        if (_codec != null) try { Marshal.ReleaseComObject(_codec); } catch { }
        _events?.Dispose();
        _mft.Dispose();
        _needInput.Dispose();
    }
}

[ComImport, Guid("901db4c7-31ce-41a2-85dc-8fa0bf41b8da"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ICodecApi
{
    [PreserveSig] int IsSupported(ref Guid api);
    [PreserveSig] int IsModifiable(ref Guid api);
    [PreserveSig] int GetParameterRange(ref Guid api, IntPtr min, IntPtr max, IntPtr step);
    [PreserveSig] int GetParameterValues(ref Guid api, IntPtr values, IntPtr count);
    [PreserveSig] int GetDefaultValue(ref Guid api, IntPtr value);
    [PreserveSig] int GetValue(ref Guid api, IntPtr value);
    [PreserveSig] int SetValue(ref Guid api, [In] ref object value);
}
