using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace LiveDesk.Net;

/// <summary>One connection to Supabase's live channels, holding one private channel. It reconnects
/// by itself; a connection gone quiet is replaced whole (asked for by the reader).</summary>
public sealed class RealtimeLink : ILink
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
        lock (_gate)
        {
            cancel = _cancel;
            _cancel = null;
            _socket = null;
        }
        _isJoined = false;
        // Not waited for: on a dead connection this takes a while, and nothing depends on it.
        cancel?.Cancel();
    }

    private readonly object _sendGate = new();
    private object? _latest;      // only the newest broadcast waits to go out
    private bool _draining;

    /// <summary>Sends a broadcast, keeping ONLY the newest in flight. On a slow line the admin types
    /// faster than the line drains; queuing every keystroke would leave the latest word stuck behind a
    /// backlog of stale ones (measured 2026-11-06: bursts arriving seconds late). Instead the newest
    /// state replaces any still waiting, so the user always gets as near to live as the line allows.</summary>
    public void Send(string name, object payload)
    {
        if (!_isJoined) return;
        var message = new { topic = _topic, @event = "broadcast", payload = new { type = "broadcast", @event = name, payload }, @ref = NextRef(), join_ref = _joinRef };
        bool start;
        lock (_sendGate) { _latest = message; start = !_draining; if (start) _draining = true; }
        if (start) _ = Drain();
    }

    private async Task Drain()
    {
        while (true)
        {
            object? next;
            lock (_sendGate)
            {
                next = _latest;
                _latest = null;
                if (next == null) { _draining = false; return; }
            }
            await Write(_socket, next);
        }
    }

    public void Refresh() => _ = RefreshNow();

    private async Task RefreshNow()
    {
        var token = await _account.Token();
        if (token != null && _isJoined) await Write(_socket, new { topic = _topic, @event = "access_token", payload = new { access_token = token }, @ref = NextRef() });
    }

    private string NextRef() => Interlocked.Increment(ref _ref).ToString();

    private async Task Write(ClientWebSocket? socket, object message)
    {
        if (socket is not { State: WebSocketState.Open }) return;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message);
        await _sending.WaitAsync();
        try { await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None); }
        catch (Exception) { /* The read side sees it close, and starts again. */ }
        finally { _sending.Release(); }
    }

    private async Task Run(CancellationToken cancel)
    {
        var tries = 0;
        var refusals = 0;
        while (!cancel.IsCancellationRequested)
        {
            using var socket = new ClientWebSocket();
            var wasJoined = false;
            try
            {
                var began = Environment.TickCount64;
                var token = await _account.Token();
                if (token == null) throw new InvalidOperationException("no sign-in");
                var tokenAt = Environment.TickCount64;
                if (Route.Proxy != null) socket.Options.Proxy = Route.Proxy;
                using (var connecting = CancellationTokenSource.CreateLinkedTokenSource(cancel))
                {
                    connecting.CancelAfter(ConnectMs);
                    await socket.ConnectAsync(_account.RealtimeAddress(), connecting.Token);
                }
                _joinAskedAt = Environment.TickCount64;
                if (LiveDesk.Core.Timing.On) LiveDesk.Core.Timing.Line($"open {_topic} token={tokenAt - began}ms connect={_joinAskedAt - tokenAt}ms try={tries}");
                lock (_gate)
                {
                    if (cancel.IsCancellationRequested) return;
                    _socket = socket;
                }
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
            catch (Exception ex) when (!cancel.IsCancellationRequested)
            {
                // Tried again below.
                if (LiveDesk.Core.Timing.On) LiveDesk.Core.Timing.Line($"FAIL {_topic} {ex.GetType().Name}: {ex.Message}");
            }
            catch (OperationCanceledException) { return; }
            if (cancel.IsCancellationRequested) return;
            _isJoined = false;
            _lost();
            // Refused by the server (not allowed on this channel) is not a network fault: asking again
            // every few seconds only opens connection after connection, in the way of the ones that work.
            var refused = _refused;
            _refused = false;
            refusals = refused ? refusals + 1 : wasJoined ? 0 : refusals;
            var wait = refused ? Math.Min(120_000, 30_000 * refusals) : tries < Backoff.Length ? Backoff[tries] : 5_000;
            try { await Task.Delay(wait, cancel); }
            catch (OperationCanceledException) { return; }
            tries += 1;
        }
    }

    private string? _beatRef;
    private long _joinAskedAt;
    private volatile bool _refused;

    private async Task Beat(ClientWebSocket socket, CancellationToken stop)
    {
        try
        {
            while (true)
            {
                await Task.Delay(HeartbeatMs, stop);
                // No answer since the last: the connection is gone, even if nothing has said so.
                if (_beatRef != null) { socket.Abort(); return; }
                _beatRef = NextRef();
                await Write(socket, new { topic = "phoenix", @event = "heartbeat", payload = new { }, @ref = _beatRef });
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
                    if (LiveDesk.Core.Timing.On) LiveDesk.Core.Timing.Line($"join {_topic} {status} answer={Environment.TickCount64 - _joinAskedAt}ms {(status == "ok" ? "" : root.GetProperty("payload").ToString())}");
                    if (status != "ok") { _refused = true; return false; }   // Not allowed (the script may have been turned off).
                    joined = true;
                    _isJoined = true;
                    _joined();
                    break;
                case "broadcast":
                    var inner = root.GetProperty("payload");
                    if (inner.TryGetProperty("event", out var what) && inner.TryGetProperty("payload", out var payload))
                    {
                        if (LiveDesk.Core.Timing.On)
                            LiveDesk.Core.Timing.Line($"sock {_topic} {what.GetString()} n={(payload.TryGetProperty("n", out var seq) ? seq.ToString() : "-")} tail={(payload.TryGetProperty("tail", out var tail) ? tail.GetString()?.Length ?? 0 : -1)}");
                        _heard(what.GetString() ?? "", payload.Clone());
                    }
                    break;
                case "phx_close":
                case "phx_error":
                    return joined;
            }
        }
        return joined;
    }
}

/// <summary>A member's script being read: the connection and the reader, with everything the reader
/// does happening one thing at a time on one line of work.</summary>
public sealed class ScriptRun : IDisposable
{
    private readonly Channel<Action> _work = Channel.CreateUnbounded<Action>(new UnboundedChannelOptions { SingleReader = true });
    private readonly ScriptReader _reader;
    private readonly Timer _clock;

    public ScriptRun(Account account, string member, Action<string, int, string?> onText, Action<ReadingState> onState)
    {
        ScriptReader? reader = null;
        var link = new RealtimeLink(account, $"live-script:{member}",
            (name, payload) => Post(() => reader!.Heard(name, payload)),
            () => Post(() => reader!.Joined()),
            () => Post(() => reader!.Lost()));
        _reader = reader = new ScriptReader(link, onText, onState);
        _ = Task.Run(Work);
        Post(_reader.Begin);
        _clock = new Timer(_ => Post(_reader.Tick), null, 250, 250);
    }

    public bool SaysItIsThere => _reader.SaysItIsThere;

    private void Post(Action job)
    {
        if (LiveDesk.Core.Timing.On)
        {
            var at = Environment.TickCount64;
            var inner = job;
            job = () =>
            {
                var waited = Environment.TickCount64 - at;
                var began = Environment.TickCount64;
                inner();
                var took = Environment.TickCount64 - began;
                if (waited > 50 || took > 30) LiveDesk.Core.Timing.Line($"WORK waited={waited} took={took}");
            };
        }
        _work.Writer.TryWrite(job);
    }

    private async Task Work()
    {
        await foreach (var job in _work.Reader.ReadAllAsync())
        {
            try { job(); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine(ex); }
        }
    }

    public void Dispose()
    {
        _clock.Dispose();
        Post(_reader.End);
        _work.Writer.TryComplete();
    }
}
