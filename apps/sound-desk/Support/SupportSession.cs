using System.Diagnostics;
using System.Text.Json;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using SoundDesk.Audio;
using SoundDesk.Capture;
using SoundDesk.Media;
using SoundDesk.Net;

namespace SoundDesk.Support;

public enum SupportState { Waiting, Connecting, Live, Degraded, Reconnecting, Ended }

/// <summary>What the member agreed to share (and can change while sharing: pause, mute).</summary>
public sealed class Consent
{
    public required ScreenChoice Screen { get; init; }
    public bool SystemAudio { get; init; }
    public bool Mic { get; init; }
    public string? MicDevice { get; init; }
}

/// <summary>One live support session on the member's side: captures what the member agreed to and
/// sends it to the one manager the database names, over WebRTC (DTLS-SRTP), straight or through
/// the relay. Never starts by itself: it is made only after the member's own click in
/// ConsentWindow, and <see cref="Stop"/> releases every capture device at once, before any
/// network call, so it works with no network at all.</summary>
public sealed class SupportSession : IDisposable
{
    private const int BeatMs = 10_000;
    private const int StateEveryMs = 5_000;
    private const int GraceMs = 120_000;         // the manager's page gone or cut off: wait this long, then end
    private const int ReofferAfterMs = 10_000;   // not connected this long after an offer: offer again when asked
    private const int MaxWidth = 1920, MaxHeight = 1080;
    private const int H264Pt = 102, OpusPt = 111;

    private readonly Account _account;
    private readonly SupportApi _api;
    private readonly SessionRules _rules = new();
    private readonly Consent _consent;
    private readonly string _id = Guid.NewGuid().ToString();
    private readonly object _gate = new();
    private readonly RateControl _rate = new();
    private RealtimeLink? _link;
    private RTCPeerConnection? _pc;
    private bool _described;
    private DateTime _offeredAt;
    private Mixer? _mixer;
    private SystemSound? _system;
    private Microphone? _mic;
    private VoicePlayer? _voice;
    private Thread? _video;
    private volatile bool _running;
    private volatile bool _peerLive;
    private System.Threading.Timer? _beat, _stateTimer, _grace, _watch;
    private DateTime _lastRtcp = DateTime.UtcNow;
    private RTCIceServer[]? _ice;
    private DateTime _iceAt;
    private const int SilentPeerMs = 8_000;      // no report from the manager's browser this long: it is gone
    private DateTime _lastJoinCheck = DateTime.MinValue;
    private long _keyAsked;
    private long _framesSent, _bytesSent, _audioSent, _keyFrames, _feedbackSeen;
    private float _systemPeak;
    private string _screenDetail = "";
    private int _encW, _encH;
    private string _encoderName = "";
    private uint _lastLostTotal, _lastHighest;
    private DateTime _lastReport = DateTime.UtcNow;
    private DateTime _lastLossKey = DateTime.MinValue;

    public SessionView View { get; }
    public string Id => View.Id;
    public string ManagerName => View.ManagerName;
    public SupportState State { get; private set; } = SupportState.Waiting;
    public string StateText { get; private set; } = "";
    /// <summary>Screen: "live", "paused" (by the member), "lost" (display gone / window closed or minimised).</summary>
    public string ScreenState { get; private set; } = "live";
    public bool ScreenPaused { get; private set; }
    public bool SystemOn => _mixer?.SystemOn ?? false;
    public bool MicOn => _mixer?.MicOn ?? false;
    public bool HasSystem => _system != null;
    public bool HasMic => _mic != null;
    public string Problem { get; private set; } = "";
    public RatePlan Plan => _rate.Plan;
    public bool EchoGuarded => _mixer?.DuckSystemForVoice ?? false;

    /// <summary>Anything shown changed (state, sources, problem). Not on the UI thread.</summary>
    public event Action? Changed;
    /// <summary>The session is over, with the reason (once).</summary>
    public event Action<string>? Ended;

    public SupportSession(Account account, SupportApi api, SessionView view, Consent consent)
    {
        _account = account; _api = api; View = view; _consent = consent;
        _rules.SeatIs(view.Seat);
    }

    public void Start()
    {
        _running = true;
        Log.Write($"Support: session {Id[..8]} starting with {ManagerName}: screen={_consent.Screen.Label}, system={_consent.SystemAudio}, mic={_consent.Mic}");
        _mixer = new Mixer { SystemOn = _consent.SystemAudio, MicOn = _consent.Mic };
        _mixer.Encoded += SendAudio;
        _mixer.EchoPathFound += () =>
        {
            Problem = "Your speakers send the manager's voice back into the computer sound, so it is turned down while they speak. Headphones avoid this.";
            _ = _api.Note(Id, "diagnostics", new { echo_path = "found", action = "duck_system_audio" });
            Changed?.Invoke();
        };
        if (_consent.SystemAudio) StartSystem();
        if (_consent.Mic) StartMic();
        _mixer.Start();
        _voice = new VoicePlayer();
        _voice.Played += level => _mixer?.VoicePlayed(level);
        _voice.Start();

        _link = new RealtimeLink(_account, $"support:{Id}", (name, payload) => { if (name == "support") Heard(payload); },
            () => { Log.Write("Support: channel joined"); SendState(); },
            () => { Log.Write("Support: channel lost"); if (_running && !_peerLive) SetState(SupportState.Reconnecting, "Reconnecting to KIASA…"); });
        _link.Open();
        _beat = new System.Threading.Timer(_ => _ = Beat(), null, 0, BeatMs);
        _stateTimer = new System.Threading.Timer(_ => SendState(), null, StateEveryMs, StateEveryMs);
        // The browser reports on what it receives about once a second (RTCP). When those stop, the
        // manager's page is gone (closed, crashed, cut off), whatever the connection still says.
        _watch = new System.Threading.Timer(_ => Watchdog(), null, 2000, 2000);
        _video = new Thread(VideoLoop) { IsBackground = true, Name = "Screen" };
        _video.Start();
        SetState(SupportState.Waiting, $"Waiting for {ManagerName} to open the session…");
        StartGrace();
    }

    private void StartSystem()
    {
        _system = new SystemSound();
        _system.Samples += s => _mixer?.FeedSystem(s);
        _system.Lost += why => { Problem = why; _ = _api.Note(Id, "capture_failed", new { source = "system_audio" }); Changed?.Invoke(); };
        try
        {
            _system.Start();
            if (_mixer != null) _mixer.DuckSystemForVoice = !_system.ExcludesOwnPlayback;
        }
        catch (Exception ex) { Problem = "The computer sound could not be captured: " + ex.Message; _system.Dispose(); _system = null; if (_mixer != null) _mixer.SystemOn = false; }
    }

    private void StartMic()
    {
        _mic = new Microphone(_consent.MicDevice);
        _mic.Samples += s => _mixer?.FeedMic(s);
        _mic.Lost += why => { Problem = why; _ = _api.Note(Id, "capture_failed", new { source = "mic" }); Changed?.Invoke(); };
        try { _mic.Start(); }
        catch (Exception ex) { Problem = "The microphone could not be used: " + ex.Message; _mic.Dispose(); _mic = null; if (_mixer != null) _mixer.MicOn = false; }
    }

    // ── What the member controls ────────────────────────────────────────────

    /// <summary>Screen paused: no picture is taken or sent; sound stays as it is.</summary>
    public void SetScreenPaused(bool paused)
    {
        if (!_running || ScreenPaused == paused) return;
        ScreenPaused = paused;
        ScreenState = paused ? "paused" : "live";
        _ = _api.Note(Id, paused ? "paused" : "resumed", new { what = "screen" });
        SendState();
        Changed?.Invoke();
    }

    public void SetSystem(bool on)
    {
        if (!_running || _mixer == null) return;
        if (on && _system == null) StartSystem();
        if (on && _system == null) return;
        _mixer.SystemOn = on;
        _ = _api.Note(Id, on ? "system_audio_on" : "system_audio_off");
        SendState();
        Changed?.Invoke();
    }

    public void SetMic(bool on)
    {
        if (!_running || _mixer == null) return;
        if (on && _mic == null) StartMic();
        if (on && _mic == null) return;
        _mixer.MicOn = on;
        // Off means the device is let go (its light goes out), not only silenced.
        if (!on) { _mic?.Dispose(); _mic = null; }
        _ = _api.Note(Id, on ? "mic_on" : "mic_off");
        SendState();
        Changed?.Invoke();
    }

    // ── Signalling ──────────────────────────────────────────────────────────

    private void Heard(JsonElement m)
    {
        if (!_running) return;
        string? Str(string k) => m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        var kind = Str("kind");
        var from = Str("from");
        var seat = Str("seat");
        var to = Str("to");
        var epoch = m.TryGetProperty("epoch", out var e) && e.TryGetInt32(out var ep) ? ep : -1;
        if (to != null && to != _id) return;
        switch (kind)
        {
            case "join" when from != null:
                _ = Joined(from, seat);
                break;
            case "answer" when _rules.AnswerFits(seat, from, epoch):
                var sdp = Str("sdp");
                if (sdp == null) return;
                lock (_gate)
                {
                    var result = _pc?.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = sdp });
                    // The browser's addresses ride inside its answer; SIPSorcery does not take them from
                    // there, so each is added by hand (without them a relay-only call never starts checking).
                    var added = 0;
                    string? lineMid = null;
                    ushort index = 0, line = 0;
                    foreach (var raw in sdp.Split((char)10))
                    {
                        var text = raw.Trim();
                        if (text.StartsWith("m=")) { index = line++; lineMid = null; }
                        else if (text.StartsWith("a=mid:")) lineMid = text[6..];
                        else if (text.StartsWith("a=candidate:"))
                        {
                            try { _pc?.addIceCandidate(new RTCIceCandidateInit { candidate = text[2..], sdpMid = lineMid ?? index.ToString(), sdpMLineIndex = index }); added++; }
                            catch (Exception ex) { Log.Write($"Support: candidate not taken: {ex.Message}"); }
                        }
                    }
                    Log.Write($"Support: answer for epoch {epoch}: {result}, {added} candidates from it");
                }
                break;
            case "candidate" when _rules.CandidateFits(seat, epoch) && m.TryGetProperty("candidate", out var c):
                var init = new RTCIceCandidateInit
                {
                    candidate = c.TryGetProperty("candidate", out var cc) ? cc.GetString() ?? "" : "",
                    sdpMid = c.TryGetProperty("sdpMid", out var mid) ? mid.GetString() : null,
                    sdpMLineIndex = c.TryGetProperty("sdpMLineIndex", out var idx) && idx.TryGetUInt16(out var i) ? i : (ushort)0,
                };
                lock (_gate) try { _pc?.addIceCandidate(init); } catch { }
                break;
            case "leave" when seat == _rules.Seat:
                Log.Write("Support: the manager's page closed");
                DropPeer();
                SetState(SupportState.Waiting, $"{ManagerName} left. Waiting up to 2 minutes for them to come back…");
                StartGrace();
                break;
            case "ended":
                _ = Beat(); // believed only when the database says so
                break;
        }
    }

    /// <summary>The manager's page asks for the picture. Offered only to the seat the database
    /// names now, and not again while a recent offer to the same page is still connecting.</summary>
    private async Task Joined(string from, string? seat)
    {
        if (!_rules.JoinIsCurrent(seat))
        {
            // Maybe the page was opened again since the last look: ask the database (at most every 2 s).
            if ((DateTime.UtcNow - _lastJoinCheck).TotalSeconds < 2) return;
            _lastJoinCheck = DateTime.UtcNow;
            await Beat();
            if (!_rules.JoinIsCurrent(seat)) { Log.Write("Support: join from an old or unknown seat ignored"); return; }
        }
        lock (_gate)
        {
            if (_rules.Peer == from && _pc != null && (_peerLive || (DateTime.UtcNow - _offeredAt).TotalMilliseconds < ReofferAfterMs)) return;
        }
        await Offer(from);
    }

    private async Task Offer(string to)
    {
        // The session's relay passwords last two hours; asked again after one (KIASA-012 limits asking).
        if (_ice == null || (DateTime.UtcNow - _iceAt).TotalMinutes > 60) { var got = await _api.Ice(Id); _ice = got; _iceAt = got.Any(x => (x.urls ?? "").StartsWith("turn")) ? DateTime.UtcNow : DateTime.MinValue; }
        var ice = _ice;
        if (!_running) return;
        var relayOnly = Environment.GetEnvironmentVariable("KIASA_DESK_RELAY_ONLY") == "1";
        var pc = new RTCPeerConnection(new RTCConfiguration { iceServers = ice.ToList(), iceTransportPolicy = relayOnly ? RTCIceTransportPolicy.relay : RTCIceTransportPolicy.all });
        pc.addTrack(new MediaStreamTrack(SDPMediaTypesEnum.audio, false,
            [new SDPAudioVideoMediaFormat(SDPMediaTypesEnum.audio, OpusPt, "opus", 48000, 2, "minptime=10;useinbandfec=1")], MediaStreamStatusEnum.SendRecv));
        pc.addTrack(new MediaStreamTrack(new VideoFormat(VideoCodecsEnum.H264, H264Pt, 90000, "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"), MediaStreamStatusEnum.SendOnly));
        int epoch;
        lock (_gate)
        {
            DropPeerLocked();
            epoch = _rules.NewOffer(to);
            _pc = pc;
            _described = false;
            _offeredAt = DateTime.UtcNow;
        }
        var seat = _rules.Seat;
        // Candidates found before the offer is out are kept and sent right after it: SIPSorcery's
        // offer carries only host addresses, so a relay found early would otherwise be lost (KIASA-017).
        var early = new List<RTCIceCandidate>();
        void SendCandidate(RTCIceCandidate c) =>
            _link?.Send("support", new { kind = "candidate", from = _id, to, seat, epoch, candidate = new { candidate = Line(c), c.sdpMid, c.sdpMLineIndex } });
        static string Line(RTCIceCandidate c) { var text = c.ToString(); return text.StartsWith("candidate:") ? text : "candidate:" + text; }
        pc.onicecandidate += candidate =>
        {
            if (candidate == null) return;
            lock (_gate)
            {
                if (_pc != pc) return;
                if (!_described) { early.Add(candidate); return; }
            }
            SendCandidate(candidate);
        };
        pc.onconnectionstatechange += state =>
        {
            if (_pc != pc || !_running) return;
            Log.Write($"Support: connection {state} (epoch {epoch})");
            if (state == RTCPeerConnectionState.connected)
            {
                _lastRtcp = DateTime.UtcNow;
                _peerLive = true;
                _grace?.Dispose(); _grace = null;
                _keyAsked = 1;
                SetState(SupportState.Live, $"Sharing with {ManagerName}");
                _ = _api.Note(Id, "connected", new { epoch, route = RouteOf(pc) });
                SendState();
            }
            else if (state is RTCPeerConnectionState.disconnected or RTCPeerConnectionState.failed)
            {
                _peerLive = false;
                SetState(SupportState.Reconnecting, "Connection lost. Reconnecting…");
                _ = _api.Note(Id, "reconnecting", new { epoch, state = state.ToString() });
                StartGrace();
            }
        };
        pc.OnRtpPacketReceived += (_, media, packet) =>
        {
            if (media == SDPMediaTypesEnum.audio && packet.Header.PayloadType == OpusPt) _voice?.Packet(packet.Header.SequenceNumber, packet.Payload);
        };
        pc.OnReceiveReport += (_, media, report) => Reported(media, report);

        var offer = pc.createOffer(null);
        await pc.setLocalDescription(offer);
        await Gathered(pc, ice.Any(s => (s.urls ?? "").StartsWith("turn", StringComparison.OrdinalIgnoreCase)));
        lock (_gate) if (_pc != pc || !_running) return;
        var sdp = Munge(pc.localDescription?.sdp?.ToString() ?? offer.sdp);
        if (Environment.GetEnvironmentVariable("KIASA_DESK_LOG_SDP") == "1") Log.Write("Support: offer SDP: " + sdp.Replace("\r\n", " | "));
        _link?.Send("support", new { kind = "offer", from = _id, to, seat, epoch, sdp });
        RTCIceCandidate[] held;
        lock (_gate) { _described = true; held = early.ToArray(); early.Clear(); }
        foreach (var c in held) SendCandidate(c);
        if (held.Length > 0) Log.Write($"Support: {held.Length} candidates found before the offer sent after it ({string.Join(", ", held.Select(c => c.type))})");
        SetState(_peerLive ? State : SupportState.Connecting, $"Connecting to {ManagerName}…");
        Log.Write($"Support: offer {epoch} sent ({sdp.Length} chars, {ice.Length} ICE servers{(relayOnly ? ", relay only" : "")})");
    }

    /// <summary>Asks the browser for key-frame requests only (SIPSorcery offers transport-cc, which
    /// it does not use). Not REMB: SIPSorcery keeps one feedback item per RTCP packet and the
    /// browser puts REMB in every one, which hid every key-frame request (measured). Not plain
    /// NACK: nothing is resent.</summary>
    internal static string Munge(string sdp) =>
        sdp.Replace($"a=rtcp-fb:{H264Pt} transport-cc\r\n", $"a=rtcp-fb:{H264Pt} nack pli\r\na=rtcp-fb:{H264Pt} ccm fir\r\n");

    private static async Task Gathered(RTCPeerConnection pc, bool relay)
    {
        var done = new TaskCompletionSource();
        var target = relay ? RTCIceCandidateType.relay : RTCIceCandidateType.srflx;
        void Found(RTCIceCandidate c) { if (c?.type == target) _ = Task.Delay(150).ContinueWith(_ => done.TrySetResult()); }
        void State(RTCIceGatheringState s) { if (s == RTCIceGatheringState.complete) done.TrySetResult(); }
        pc.onicecandidate += Found;
        pc.onicegatheringstatechange += State;
        if (pc.iceGatheringState == RTCIceGatheringState.complete) done.TrySetResult();
        await Task.WhenAny(done.Task, Task.Delay(2500));
        pc.onicecandidate -= Found;
        pc.onicegatheringstatechange -= State;
    }

    private static string RouteOf(RTCPeerConnection pc)
    {
        try
        {
            var sdp = pc.remoteDescription?.sdp?.ToString() ?? "";
            return sdp.Contains("typ relay") ? "relay offered" : "direct";
        }
        catch { return "unknown"; }
    }

    // ── What the browser says about the line ────────────────────────────────

    private void Watchdog()
    {
        if (!_running || !_peerLive) return;
        if ((DateTime.UtcNow - _lastRtcp).TotalMilliseconds < SilentPeerMs) return;
        Log.Write("Support: no reports from the manager's browser for 8 s: treating it as gone");
        DropPeer();
        SetState(SupportState.Reconnecting, $"{ManagerName}'s connection was lost. Waiting up to 2 minutes…");
        _ = _api.Note(Id, "reconnecting", new { reason = "no_reports" });
        SendState();
        StartGrace();
    }

    private void Reported(SDPMediaTypesEnum media, RTCPCompoundPacket report)
    {
        _lastRtcp = DateTime.UtcNow;
        // With BUNDLE everything arrives on one transport and SIPSorcery may label it audio:
        // the picture's reports and requests are found by its own SSRC instead (measured: going
        // by the label, no report was ever used and no key frame ever sent again).
        var videoSsrc = _pc?.VideoLocalTrack?.Ssrc ?? 0;
        var fb = report.Feedback;
        if (fb != null && Interlocked.Increment(ref _feedbackSeen) <= 40)
            Log.Write($"Support: feedback {fb.Header.PacketType} psfb={fb.Header.PayloadFeedbackMessageType} rtpfb={fb.Header.FeedbackMessageType} media={fb.MediaSSRC} video={videoSsrc} label={media}");
        if (fb != null && fb.Header.PacketType == RTCPReportTypesEnum.PSFB)
        {
            var forVideo = fb.MediaSSRC == videoSsrc || fb.MediaSSRC == 0;
            if (forVideo && fb.Header.PayloadFeedbackMessageType is PSFBFeedbackTypesEnum.PLI or PSFBFeedbackTypesEnum.FIR)
                Interlocked.Exchange(ref _keyAsked, 1);
            else if (fb.Header.PayloadFeedbackMessageType == PSFBFeedbackTypesEnum.AFB && fb.BitrateMantissa > 0)
                _rate.Remb((int)Math.Min(int.MaxValue, fb.BitrateMantissa * Math.Pow(2, fb.BitrateExp)));
        }
        var blocks = (report.ReceiverReport?.ReceptionReports ?? []).Concat(report.SenderReport?.ReceptionReports ?? []);
        var rr = blocks.FirstOrDefault(b => b.SSRC == videoSsrc);
        if (rr == null) return;
        var now = DateTime.UtcNow;
        var seconds = (now - _lastReport).TotalSeconds;
        if (seconds < 0.8) return;
        _lastReport = now;
        // Loss from the cumulative counts (fraction-lost is per report and noisy).
        var lost = (uint)Math.Max(0, rr.PacketsLost);
        var expected = rr.ExtendedHighestSequenceNumber - _lastHighest;
        var lostNow = lost - _lastLostTotal;
        var loss = _lastHighest == 0 || expected == 0 ? rr.FractionLost / 256.0 : Math.Clamp(lostNow / (double)expected, 0, 1);
        _lastLostTotal = lost; _lastHighest = rr.ExtendedHighestSequenceNumber;
        // Nothing is resent, so a lost packet spoils the picture until a key frame. The browser's own
        // requests for one cannot be read (SIPSorcery keeps only its REMB). But a full key frame is a
        // burst that can itself cause loss, so asking on every single dropped packet feeds a storm
        // (measured). Ask only on a real loss burst (more than two packets) and at most every 2 s; the
        // buffer cap keeps such key frames small, and the 10 s GOP refreshes the picture anyway.
        if (lostNow > 2 && (now - _lastLossKey).TotalMilliseconds >= 2000) { _lastLossKey = now; Interlocked.Exchange(ref _keyAsked, 1); }
        int? rtt = null;
        if (rr.LastSenderReportTimestamp != 0)
        {
            var ntp = NtpMiddle(now);
            var r = (int)((ntp - rr.LastSenderReportTimestamp - rr.DelaySinceLastSenderReport) * 1000.0 / 65536.0);
            if (r is >= 0 and < 10_000) rtt = r;
        }
        var before = _rate.Plan;
        var plan = _rate.Report(loss, rtt, seconds);
        _mixer!.Bitrate = plan.AudioBps;
        if (plan.Degraded != before.Degraded || plan.VideoBps != before.VideoBps)
        {
            Log.Write($"Support: adapt {before.VideoBps / 1000}→{plan.VideoBps / 1000} kbit/s, {plan.Fps} fps, scale {plan.Scale:F2}, audio {plan.AudioBps / 1000}k (loss {loss:P0}, rtt {rtt?.ToString() ?? "?"} ms, {plan.Why})");
            if (plan.Degraded != before.Degraded) _ = _api.Note(Id, plan.Degraded ? "degraded" : "recovered", new { kbps = plan.VideoBps / 1000, fps = plan.Fps, loss = Math.Round(loss, 3), rtt });
            if (_peerLive) SetState(plan.Degraded ? SupportState.Degraded : SupportState.Live, plan.Degraded ? $"Poor connection ({plan.Why}): picture slowed, voice kept" : $"Sharing with {ManagerName}");
            SendState();
        }
    }

    private static uint NtpMiddle(DateTime utc)
    {
        var seconds = (utc - new DateTime(1900, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
        var whole = (ulong)seconds;
        var frac = (ulong)((seconds - whole) * 4294967296.0);
        return (uint)(((whole & 0xFFFF) << 16) | (frac >> 16));
    }

    // ── Media out ───────────────────────────────────────────────────────────

    private void SendAudio(byte[] opus)
    {
        if (!_peerLive) return;
        try { _pc?.SendAudio(960, opus); Interlocked.Increment(ref _audioSent); _systemPeak = Math.Max(_systemPeak, _mixer?.SystemLevel ?? 0); } catch { }
    }

    private void VideoLoop()
    {
        Grabber? grabber = null;
        H264Encoder? encoder = null;
        var softwareOnly = false;
        byte[] nv12 = [];
        var clock = Stopwatch.StartNew();
        var lastFrame = -1000L;
        var lostSaid = false;
        double scale = -1;
        try
        {
            grabber = new Grabber(_consent.Screen);
            while (_running)
            {
                if (!_peerLive || ScreenPaused) { Thread.Sleep(100); continue; }
                var plan = _rate.Plan;
                var interval = 1000 / Math.Max(1, plan.Fps);
                var wait = lastFrame + interval - clock.ElapsedMilliseconds;
                if (wait > 0) { Thread.Sleep((int)Math.Min(wait, 50)); continue; }
                lastFrame = clock.ElapsedMilliseconds;

                var got = grabber.Grab();
                if (got != GrabResult.Ok)
                {
                    if (!lostSaid)
                    {
                        lostSaid = true;
                        ScreenState = "lost";
                        _screenDetail = grabber.Detail;
                        Problem = got == GrabResult.Gone ? $"The shared {(_consent.Screen.IsDisplay ? "display" : "window")} is gone ({grabber.Detail}). Sound continues if it is on. Stop and share again to choose another."
                            : got == GrabResult.Hidden ? "The shared window is minimised. Restore it to show it again." : "The screen could not be captured just now.";
                        _ = _api.Note(Id, "display_lost", new { detail = grabber.Detail });
                        SendState(); Changed?.Invoke();
                    }
                    Thread.Sleep(500);
                    continue;
                }
                if (lostSaid)
                {
                    lostSaid = false; ScreenState = "live"; Problem = "";
                    _ = _api.Note(Id, "screen_changed", new { detail = "back" });
                    SendState(); Changed?.Invoke();
                }
                // Size: the screen's own, made to fit 1920×1080, times the plan's scale; even numbers.
                var fit = Math.Min(1.0, Math.Min((double)MaxWidth / grabber.Width, (double)MaxHeight / grabber.Height)) * plan.Scale;
                var w = Math.Max(16, (int)(grabber.Width * fit) & ~1);
                var h = Math.Max(16, (int)(grabber.Height * fit) & ~1);
                if (encoder == null || encoder.Width != w || encoder.Height != h || scale != plan.Scale)
                {
                    encoder?.Dispose();
                    try { encoder = H264Encoder.Create(w, h, 15, plan.VideoBps, softwareOnly); }
                    catch (Exception ex)
                    {
                        Problem = "The screen cannot be encoded on this computer: " + ex.Message.Split('\n')[0];
                        _ = _api.Note(Id, "capture_failed", new { source = "encoder" });
                        ScreenState = "lost"; SendState(); Changed?.Invoke();
                        encoder = null;
                        Thread.Sleep(5000);
                        continue;
                    }
                    var made = encoder;
                    made.Encoded += (au, key, _) => SendFrame(au);
                    made.Failed += _ => { softwareOnly = true; Interlocked.Exchange(ref _keyAsked, 1); };
                    _encoderName = $"{made.Name} ({(made.Hardware ? "hardware" : "software")})";
                    scale = plan.Scale;
                    nv12 = new byte[w * h * 3 / 2];
                    _screenDetail = $"{w}×{h}";
                    _encW = w; _encH = h;
                    _ = _api.Note(Id, "diagnostics", new { encoder = _encoderName, width = w, height = h });
                    Interlocked.Exchange(ref _keyAsked, 1);
                }
                encoder.SetBitrate(plan.VideoBps);
                if (Interlocked.Exchange(ref _keyAsked, 0) == 1) { encoder.RequestKeyFrame(); Interlocked.Increment(ref _keyFrames); }
                Nv12.Convert(grabber.Bits, grabber.Width, grabber.Height, nv12, w, h);
                encoder.Encode(nv12, clock.ElapsedMilliseconds * 10_000, interval * 10_000L);
                if (encoder.Hardware && softwareOnly) { encoder.Dispose(); encoder = null; }
            }
        }
        catch (Exception ex)
        {
            Log.Write($"Support: screen loop failed: {ex}");
            Problem = "Screen sharing stopped because of an error. Sound continues if it is on.";
            ScreenState = "lost"; SendState(); Changed?.Invoke();
        }
        finally
        {
            encoder?.Dispose();
            grabber?.Dispose();
        }
    }

    private void SendFrame(byte[] au)
    {
        if (!_peerLive || ScreenPaused || !_running) return;
        try
        {
            _pc?.SendVideo((uint)(90000 / Math.Max(1, _rate.Plan.Fps)), au);
            Interlocked.Increment(ref _framesSent);
            Interlocked.Add(ref _bytesSent, au.Length);
        }
        catch { }
    }

    // ── State to the manager, and from the database ─────────────────────────

    private void SendState()
    {
        if (!_running) return;
        var plan = _rate.Plan;
        var mode = EchoGuarded ? "computer sound lowered while you speak (echo guard)" : null;
        _link?.Send("support", new
        {
            kind = "state", from = _id, seat = _rules.Seat, seq = _rules.NextSeq(),
            says = new { screen = ScreenPaused ? "paused" : ScreenState, system = SystemOn, mic = MicOn, mode, detail = _screenDetail, fps = plan.Fps, kbps = plan.VideoBps / 1000, width = _encW, height = _encH },
        });
    }

    private async Task Beat()
    {
        if (!_running) return;
        try
        {
            if (_peerLive) Log.Write("Support: diagnostics: " + Diagnostics());
            var view = await _api.Beat(Id);
            _rules.SeatIs(view.Seat);
            if (view.Status == "ended") Stop(view.EndReason ?? EndReason.ManagerEnded, local: false);
        }
        catch (SupportApiException ex) when (ex.Status is 401 or 403) { Stop(EndReason.Revoked, local: false); }
        catch (Exception ex) { Log.Write($"Support: beat missed ({ex.Message})"); }
    }

    private void StartGrace()
    {
        _grace?.Dispose();
        _grace = new System.Threading.Timer(_ =>
        {
            if (_running && !_peerLive) { Log.Write("Support: manager away too long, ending"); Stop(EndReason.ManagerGone); }
        }, null, GraceMs, Timeout.Infinite);
    }

    private void SetState(SupportState state, string text)
    {
        if (State == SupportState.Ended) return;
        State = state; StateText = text;
        Changed?.Invoke();
    }

    private void DropPeer() { lock (_gate) DropPeerLocked(); }

    private void DropPeerLocked()
    {
        _peerLive = false;
        var pc = _pc;
        _pc = null;
        try { pc?.close(); } catch { }
    }

    /// <summary>Ends sharing now. Every capture device and connection is released first, here and
    /// at once, whatever the network does; then the database is told (retried in the background).
    /// Safe to call any number of times: only the first does anything.</summary>
    public void Stop(string reason = EndReason.MemberStopped, bool local = true)
    {
        if (!_rules.Stop()) return;
        _running = false;
        _peerLive = false;
        Log.Write($"Support: stopping ({reason})");
        var took = Stopwatch.StartNew();
        _beat?.Dispose(); _stateTimer?.Dispose(); _grace?.Dispose(); _watch?.Dispose();
        _system?.Dispose(); _system = null;
        _mic?.Dispose(); _mic = null;
        _mixer?.Dispose();
        _voice?.Dispose(); _voice = null;
        if (local) _link?.Send("support", new { kind = "ended", from = _id, reason });
        DropPeer();
        _video?.Join(1500);
        _link?.Close();
        Log.Write($"Support: capture and connection released in {took.ElapsedMilliseconds} ms (before any network call)");
        State = SupportState.Ended;
        StateText = "Sharing stopped";
        if (local) _ = _api.End(Id, reason);
        Changed?.Invoke();
        Ended?.Invoke(reason);
    }

    public string Diagnostics() => DiagnosticsText() + Reset();
    private string Reset() { _systemPeak = 0; return ""; }
    private string DiagnosticsText() =>
        $"encoder {_encoderName}, {_screenDetail}, plan {_rate.Plan.VideoBps / 1000} kbit/s {_rate.Plan.Fps} fps scale {_rate.Plan.Scale:F2}, smoothed loss {_rate.SmoothedLoss:P0}, sent {_framesSent} frames {_bytesSent / 1024} KB, key frames {_keyFrames}, remb {(_rate.LastRemb is { } r ? r / 1000 + " kbit/s" : "none")}, voice packets {_voice?.Packets ?? 0}, audio frames sent {_audioSent}, computer sound peak {_systemPeak:F3}, echo guard {EchoGuarded}, dropped audio {_mixer?.Dropped ?? 0}";

    public void Dispose() => Stop(EndReason.AppExit);
}
