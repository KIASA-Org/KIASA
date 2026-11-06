using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace SoundDesk.Net;

public sealed class RealtimeLink
{
    private const int HeartbeatMs = 12_000;
    private const int ConnectMs = 20_000;
    private static readonly int[] Backoff = [300, 800, 1_500, 3_000];

    private readonly Account _account;
    private readonly string _topic;
    private readonly Action<string, JsonElement> _heard;
    private readonly Action _joined;
    private readonly Action _lost;
    private readonly object _gate = new();
    private CancellationTokenSource? _cancel;
    private ClientWebSocket? _socket;
    private volatile bool _isJoined;
    private volatile bool _refused;
    private int _beats;
    private int _ref;
    private string _joinRef = "";
    private readonly SemaphoreSlim _sending = new(1, 1);

    public RealtimeLink(Account account, string topic, Action<string, JsonElement> heard, Action joined, Action lost)
    {
        _account = account;
        _topic = "realtime:" + topic;
        _heard = heard;
        _joined = joined;
        _lost = lost;
    }

    public bool Joined => _isJoined;

    public void Send(string name, object payload)
    {
        if (!_isJoined) return;
        _ = Write(_socket, new { topic = _topic, @event = "broadcast", payload = new { type = "broadcast", @event = name, payload }, @ref = NextRef(), join_ref = _joinRef });
    }

    public void Open()
    {
        Close();
        var cancel = new CancellationTokenSource();
        lock (_gate) _cancel = cancel;
        _ = Task.Run(() => Run(cancel.Token));
    }

    public void Close()
    {
        CancellationTokenSource? cancel;
        lock (_gate) { cancel = _cancel; _cancel = null; _socket = null; }
        _isJoined = false;
        cancel?.Cancel();
    }

    private string NextRef() => Interlocked.Increment(ref _ref).ToString();

    private async Task Write(ClientWebSocket? socket, object message)
    {
        if (socket is not { State: WebSocketState.Open }) return;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message);
        await _sending.WaitAsync();
        try { await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None); }
        catch { }
        finally { _sending.Release(); }
    }

    private async Task Run(CancellationToken cancel)
    {
        var tries = 0;
        while (!cancel.IsCancellationRequested)
        {
            using var socket = new ClientWebSocket();
            var wasJoined = false;
            try
            {
                Log.Write($"RealtimeLink: connecting to {_topic}");
                var token = await _account.Token();
                if (token == null) throw new InvalidOperationException("no sign-in");
                using (var connecting = CancellationTokenSource.CreateLinkedTokenSource(cancel))
                {
                    connecting.CancelAfter(ConnectMs);
                    await socket.ConnectAsync(_account.RealtimeAddress(), connecting.Token);
                }
                Log.Write("RealtimeLink: websocket connected");
                lock (_gate) { if (cancel.IsCancellationRequested) return; _socket = socket; }
                tries = 0;
                var joinRef = NextRef();
                _joinRef = joinRef;
                await Write(socket, new
                {
                    topic = _topic,
                    @event = "phx_join",
                    payload = new
                    {
                        config = new { broadcast = new { ack = false, self = false }, presence = new { enabled = false, key = "" }, postgres_changes = Array.Empty<object>(), @private = true },
                        access_token = token,
                    },
                    @ref = joinRef,
                    join_ref = joinRef,
                });
                using var heartbeatStop = CancellationTokenSource.CreateLinkedTokenSource(cancel);
                var heartbeat = Beat(socket, heartbeatStop.Token);
                try { wasJoined = await Read(socket, joinRef, cancel); }
                finally { heartbeatStop.Cancel(); }
            }
            catch (Exception ex) when (!cancel.IsCancellationRequested) { Log.Write($"RealtimeLink: error: {ex.Message}"); }
            catch (OperationCanceledException) { return; }
            if (cancel.IsCancellationRequested) return;
            _isJoined = false;
            _lost();
            // Refused by the database (not allowed, or the session is over): wait long, not 300 ms (KIASA-018).
            var wait = _refused ? 30_000 + Random.Shared.Next(5_000) : tries < Backoff.Length ? Backoff[tries] : 5_000;
            _refused = false;
            try { await Task.Delay(wait, cancel); }
            catch (OperationCanceledException) { return; }
            tries += 1;
        }
    }

    private string? _beatRef;

    private async Task Beat(ClientWebSocket socket, CancellationToken stop)
    {
        try
        {
            while (true)
            {
                await Task.Delay(HeartbeatMs, stop);
                if (_beatRef != null) { socket.Abort(); return; }
                _beatRef = NextRef();
                await Write(socket, new { topic = "phoenix", @event = "heartbeat", payload = new { }, @ref = _beatRef });
                // A fresh sign-in for the channel every ~10 minutes: tokens last an hour (KIASA-019).
                if (++_beats % 50 == 0 && _isJoined && await _account.Token() is { } fresh)
                    await Write(socket, new { topic = _topic, @event = "access_token", payload = new { access_token = fresh }, @ref = NextRef(), join_ref = _joinRef });
            }
        }
        catch (OperationCanceledException) { }
        finally { _beatRef = null; }
    }

    private async Task<bool> Read(ClientWebSocket socket, string joinRef, CancellationToken cancel)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        var joined = false;
        while (socket.State == WebSocketState.Open)
        {
            var part = await socket.ReceiveAsync(buffer, cancel);
            if (part.MessageType == WebSocketMessageType.Close) return joined;
            message.Write(buffer, 0, part.Count);
            if (!part.EndOfMessage) continue;
            using var document = JsonDocument.Parse(message.GetBuffer().AsMemory(0, (int)message.Length));
            message.SetLength(0);
            var root = document.RootElement;
            var name = root.GetProperty("event").GetString();
            var replyTo = root.TryGetProperty("ref", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString() : null;
            switch (name)
            {
                case "phx_reply":
                    if (replyTo == _beatRef) _beatRef = null;
                    if (replyTo != joinRef) break;
                    var status = root.GetProperty("payload").GetProperty("status").GetString();
                    Log.Write($"RealtimeLink: join reply status={status}");
                    if (status != "ok") { _refused = true; return false; }
                    joined = true;
                    _isJoined = true;
                    _joined();
                    break;
                case "broadcast":
                    var inner = root.GetProperty("payload");
                    if (inner.TryGetProperty("event", out var what) && inner.TryGetProperty("payload", out var payload))
                        _heard(what.GetString() ?? "", payload.Clone());
                    break;
                case "phx_close":
                case "phx_error":
                    return joined;
            }
        }
        return joined;
    }
}
