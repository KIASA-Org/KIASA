using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using SIPSorcery.Net;

namespace SoundDesk.Net;

/// <summary>Joins the sound channel for this member and offers WebRTC audio to every admin who
/// asks to listen. Each admin gets its own peer connection; the member always offers, the admin
/// always answers, so glare cannot happen. A heartbeat upsert keeps the sound_shares row fresh.</summary>
public sealed class SoundSender : IDisposable
{
    private const int HeartbeatMs = 15_000;
    private const int OfferPatienceMs = 15_000;
    private const int GatherMostMs = 2500;
    private const int GatherSettleMs = 150;
    private static readonly string[] Stun = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

    private readonly Account _account;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private readonly string _id = Guid.NewGuid().ToString();
    private readonly Dictionary<string, PeerState> _peers = new();
    private readonly object _gate = new();
    private RealtimeLink? _link;
    private System.Timers.Timer? _heartbeat;
    private RTCIceServer[]? _cachedIce;
    private DateTime _iceAt;
    private bool _disposed;

    public event Action? Refused;
    public event Action? Connected;
    public event Action? Disconnected;

    private sealed class PeerState
    {
        public RTCPeerConnection? Pc;
        public DateTime At;
        public bool Described;
    }

    public SoundSender(Account account) => _account = account;

    public void Start()
    {
        Log.Write($"SoundSender: starting, channel=sound:{_account.Id}");
        _link = new RealtimeLink(_account, $"sound:{_account.Id}",
            (name, payload) => { Log.Write($"SoundSender: signal '{name}'"); if (name == "sound") Heard(payload); },
            () =>
            {
                Log.Write("SoundSender: channel joined");
                Connected?.Invoke();
                _link?.Send("sound", new { from = _id, ask = true });
            },
            () => { Log.Write("SoundSender: channel lost"); Disconnected?.Invoke(); });
        _link.Open();
        _heartbeat = new System.Timers.Timer(HeartbeatMs) { AutoReset = true };
        _heartbeat.Elapsed += async (_, _) => await Upsert();
        _heartbeat.Start();
        _ = Upsert();
    }

    private int _feedCount;

    public void FeedFrame(byte[] opus)
    {
        PeerState[] active;
        lock (_gate) active = _peers.Values.Where(p => p.Pc?.connectionState == RTCPeerConnectionState.connected).ToArray();
        _feedCount++;
        if (_feedCount <= 3 || _feedCount % 500 == 0)
            Log.Write($"FeedFrame #{_feedCount}, opus={opus.Length}B, active peers={active.Length}");
        foreach (var peer in active)
            try { peer.Pc!.SendAudio(960, opus); } catch { }
    }

    private void Heard(JsonElement signal)
    {
        var from = signal.TryGetProperty("from", out var f) ? f.GetString() ?? "" : "";
        var to = signal.TryGetProperty("to", out var t) ? t.GetString() : null;
        Log.Write($"SoundSender.Heard: from={from[..Math.Min(8, from.Length)]}, to={to?[..Math.Min(8, to.Length)] ?? "all"}, keys=[{string.Join(",", signal.EnumerateObject().Select(p => p.Name))}]");
        if (!string.IsNullOrEmpty(to) && to != _id) return;

        if (signal.TryGetProperty("listen", out _))
        {
            RTCIceServer[]? signalIce = null;
            if (signal.TryGetProperty("ice", out var iceArr) && iceArr.ValueKind == JsonValueKind.Array)
                signalIce = ParseIce(iceArr);
            Log.Write($"SoundSender: listen from {from[..Math.Min(8, from.Length)]}, ice={signalIce?.Length ?? 0} from signal, offering");
            _ = Task.Run(() => OfferTo(from, signalIce));
        }
        else if (signal.TryGetProperty("bye", out _))
            Drop(from);
        else if (signal.TryGetProperty("description", out var desc))
        {
            var type = desc.TryGetProperty("type", out var dt) ? dt.GetString() : null;
            if (type == "answer")
            {
                var sdp = desc.TryGetProperty("sdp", out var s) ? s.GetString() ?? "" : "";
                lock (_gate)
                {
                    if (_peers.TryGetValue(from, out var peer) && peer.Pc != null)
                        peer.Pc.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = sdp });
                }
            }
        }
        else if (signal.TryGetProperty("candidate", out var cand))
        {
            lock (_gate)
            {
                if (_peers.TryGetValue(from, out var peer) && peer.Pc != null)
                {
                    var init = new RTCIceCandidateInit();
                    if (cand.TryGetProperty("candidate", out var c)) init.candidate = c.GetString() ?? "";
                    if (cand.TryGetProperty("sdpMid", out var mid)) init.sdpMid = mid.GetString();
                    if (cand.TryGetProperty("sdpMLineIndex", out var idx) && idx.TryGetUInt16(out var v)) init.sdpMLineIndex = v;
                    peer.Pc.addIceCandidate(init);
                }
            }
        }
    }

    private async Task OfferTo(string listener, RTCIceServer[]? signalIce = null)
    {
        try
        {
            Log.Write($"OfferTo: start for {listener[..Math.Min(8, listener.Length)]}");
            PeerState? known;
            lock (_gate) _peers.TryGetValue(listener, out known);
            if (known != null && (known.Pc?.connectionState == RTCPeerConnectionState.connected ||
                (DateTime.UtcNow - known.At).TotalMilliseconds < OfferPatienceMs))
            {
                Log.Write("OfferTo: skipped (existing peer still valid)");
                return;
            }

            Drop(listener);
            RTCIceServer[] ice;
            if (signalIce != null && signalIce.Length > 0)
            {
                ice = signalIce;
                Log.Write($"OfferTo: using {ice.Length} ICE servers from admin signal");
            }
            else
            {
                Log.Write("OfferTo: fetching ICE from endpoint");
                ice = await FreshIce();
                Log.Write($"OfferTo: got {ice.Length} ICE servers from endpoint");
            }
            foreach (var s in ice)
                Log.Write($"  ICE: urls={s.urls} user={s.username?[..Math.Min(8, s.username.Length)]}");
            var config = new RTCConfiguration { iceServers = ice.ToList() };
            var pc = new RTCPeerConnection(config);
            var format = new SDPAudioVideoMediaFormat(SDPMediaTypesEnum.audio, 111, "opus", 48000, 2,
                "minptime=10;useinbandfec=1;maxaveragebitrate=64000");
            pc.addTrack(new MediaStreamTrack(SDPMediaTypesEnum.audio, false, new List<SDPAudioVideoMediaFormat> { format }, MediaStreamStatusEnum.SendOnly));

            var peer = new PeerState { Pc = pc, At = DateTime.UtcNow };
            lock (_gate) _peers[listener] = peer;

            pc.onicecandidate += candidate =>
            {
                if (peer.Described && candidate != null)
                    _link?.Send("sound", new
                    {
                        from = _id,
                        to = listener,
                        candidate = new { candidate = candidate.ToString(), sdpMid = candidate.sdpMid, sdpMLineIndex = candidate.sdpMLineIndex }
                    });
            };
            pc.onconnectionstatechange += state =>
            {
                Log.Write($"Peer {listener[..Math.Min(8, listener.Length)]}: connectionState={state}");
                if (state == RTCPeerConnectionState.failed) Drop(listener);
            };

            var offer = pc.createOffer();
            if (offer == null) return;
            pc.setLocalDescription(offer);

            var hasRelay = ice.Any(s => (s.urls ?? "").StartsWith("turn", StringComparison.OrdinalIgnoreCase));
            await Gathered(pc, hasRelay);

            lock (_gate) { if (!_peers.TryGetValue(listener, out var p) || p != peer) return; }

            var sdp = pc.localDescription?.sdp?.ToString() ?? offer.sdp;
            Log.Write($"OfferTo: sending offer ({sdp.Length} chars)");
            _link?.Send("sound", new { from = _id, to = listener, description = new { type = "offer", sdp } });
            peer.Described = true;
            Log.Write("OfferTo: offer sent");
        }
        catch (Exception ex)
        {
            Log.Write($"OfferTo FAILED: {ex}");
        }
    }

    private static async Task Gathered(RTCPeerConnection pc, bool relay)
    {
        Log.Write($"Gathered: waiting for {(relay ? "relay" : "srflx")} candidates (max {GatherMostMs}ms)");
        var done = new TaskCompletionSource();
        System.Timers.Timer? settle = null;
        var target = relay ? RTCIceCandidateType.relay : RTCIceCandidateType.srflx;
        int total = 0;

        void OnCandidate(RTCIceCandidate candidate)
        {
            Interlocked.Increment(ref total);
            Log.Write($"Gathered: candidate type={candidate.type} proto={candidate.protocol} {candidate.ToString()?[..Math.Min(80, candidate.ToString()?.Length ?? 0)]}");
            if (candidate.type == target && settle == null)
            {
                settle = new System.Timers.Timer(GatherSettleMs) { AutoReset = false };
                settle.Elapsed += (_, _) => { settle.Dispose(); done.TrySetResult(); };
                settle.Start();
            }
        }
        void OnState(RTCIceGatheringState state)
        {
            Log.Write($"Gathered: state={state}");
            if (state == RTCIceGatheringState.complete) done.TrySetResult();
        }

        pc.onicecandidate += OnCandidate;
        pc.onicegatheringstatechange += OnState;
        if (pc.iceGatheringState == RTCIceGatheringState.complete) done.TrySetResult();

        var finished = await Task.WhenAny(done.Task, Task.Delay(GatherMostMs));
        var timedOut = finished != done.Task;
        Log.Write($"Gathered: done, {total} candidates, timedOut={timedOut}");
        pc.onicecandidate -= OnCandidate;
        pc.onicegatheringstatechange -= OnState;
        settle?.Dispose();
    }

    private void Drop(string listener)
    {
        PeerState? peer;
        lock (_gate) { _peers.Remove(listener, out peer); }
        try { peer?.Pc?.close(); } catch { }
    }

    private async Task Upsert()
    {
        var token = await _account.Token();
        if (token == null) return;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_account.Url}/rest/v1/sound_shares")
            {
                Content = new StringContent($"{{\"user_id\":\"{_account.Id}\"}}", System.Text.Encoding.UTF8, "application/json")
            };
            request.Headers.Add("apikey", _account.Key);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Prefer", "resolution=merge-duplicates");
            using var response = await _http.SendAsync(request);
            if ((int)response.StatusCode is 401 or 403) Refused?.Invoke();
        }
        catch { }
    }

    private async Task DeleteShare()
    {
        var token = await _account.Token();
        if (token == null) return;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Delete, $"{_account.Url}/rest/v1/sound_shares?user_id=eq.{_account.Id}");
            request.Headers.Add("apikey", _account.Key);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await _http.SendAsync(request);
        }
        catch { }
    }

    private async Task<RTCIceServer[]> FreshIce()
    {
        if (_cachedIce != null && (DateTime.UtcNow - _iceAt).TotalHours < 1) return _cachedIce;
        try
        {
            var token = await _account.Token();
            if (token == null) return DefaultIce();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{_account.Site}/say/ice");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await _http.SendAsync(request);
            if (!response.IsSuccessStatusCode) return DefaultIce();
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (!body.TryGetProperty("ice", out var arr) || arr.ValueKind != JsonValueKind.Array) return DefaultIce();
            var list = new List<RTCIceServer>();
            foreach (var entry in arr.EnumerateArray())
            {
                var username = entry.TryGetProperty("username", out var u) ? u.GetString() : null;
                var credential = entry.TryGetProperty("credential", out var cr) ? cr.GetString() : null;
                if (!entry.TryGetProperty("urls", out var urls)) continue;
                if (urls.ValueKind == JsonValueKind.Array)
                    foreach (var url in urls.EnumerateArray())
                        list.Add(new RTCIceServer { urls = url.GetString() ?? "", username = username, credential = credential });
                else if (urls.ValueKind == JsonValueKind.String)
                    list.Add(new RTCIceServer { urls = urls.GetString() ?? "", username = username, credential = credential });
            }
            if (list.Count > 0) { _cachedIce = list.ToArray(); _iceAt = DateTime.UtcNow; return _cachedIce; }
        }
        catch { }
        return DefaultIce();
    }

    private static RTCIceServer[] DefaultIce() => Stun.Select(u => new RTCIceServer { urls = u }).ToArray();

    private static RTCIceServer[] ParseIce(JsonElement arr)
    {
        var list = new List<RTCIceServer>();
        foreach (var entry in arr.EnumerateArray())
        {
            var username = entry.TryGetProperty("username", out var u) ? u.GetString() : null;
            var credential = entry.TryGetProperty("credential", out var cr) ? cr.GetString() : null;
            if (!entry.TryGetProperty("urls", out var urls)) continue;
            if (urls.ValueKind == JsonValueKind.Array)
                foreach (var url in urls.EnumerateArray())
                    list.Add(new RTCIceServer { urls = url.GetString() ?? "", username = username, credential = credential });
            else if (urls.ValueKind == JsonValueKind.String)
                list.Add(new RTCIceServer { urls = urls.GetString() ?? "", username = username, credential = credential });
        }
        return list.Count > 0 ? list.ToArray() : DefaultIce();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _heartbeat?.Stop();
        _heartbeat?.Dispose();
        _link?.Send("sound", new { from = _id, stopped = true });
        lock (_gate) { foreach (var (_, peer) in _peers) try { peer.Pc?.close(); } catch { } _peers.Clear(); }
        _link?.Close();
        _ = DeleteShare();
        _http.Dispose();
    }
}
