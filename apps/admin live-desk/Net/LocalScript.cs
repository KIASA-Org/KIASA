using System.IO;
using System.Net.WebSockets;
using System.Text.Json;

namespace LiveDesk.Net;

/// <summary>The admin's own script, read straight from KIASA Live Script on this same computer, so
/// that it does not have to go out to the server and come back before it shows here.
///
/// Only for the admin's own script, and only while their page says it is on (the window decides
/// that, and stops this otherwise): the capture app keeps capturing while anything is connected to
/// it, and it must never go on with no page open to say so. This only listens. It never starts or
/// stops a capture.
///
/// The capture app lets in the pages it knows by their address. This is not a page, so it gives the
/// address of the app's own page on this computer.</summary>
public sealed class LocalScript
{
    private static readonly int Port = int.TryParse(Environment.GetEnvironmentVariable("KIASA_DESK_CAPTURE_PORT"), out var port) ? port : 8765;
    private const int AgainMs = 3_000;

    private readonly Action<string> _onText;
    private readonly Action<bool> _onLive;
    private readonly object _gate = new();
    private CancellationTokenSource? _cancel;

    /// <param name="onText">The whole script so far, each time it changes. Not on the window's thread.</param>
    /// <param name="onLive">Whether words are coming from here now. Not on the window's thread.</param>
    public LocalScript(Action<string> onText, Action<bool> onLive)
    {
        _onText = onText;
        _onLive = onLive;
    }

    public void Start()
    {
        CancellationTokenSource cancel;
        lock (_gate)
        {
            if (_cancel != null) return;
            cancel = _cancel = new CancellationTokenSource();
        }
        _ = Task.Run(() => Run(cancel.Token));
    }

    public void Stop()
    {
        CancellationTokenSource? cancel;
        lock (_gate)
        {
            cancel = _cancel;
            _cancel = null;
        }
        cancel?.Cancel();
    }

    private async Task Run(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            try
            {
                using var socket = new ClientWebSocket();
                socket.Options.Proxy = null;   // This computer: never by way of a proxy.
                socket.Options.SetRequestHeader("Origin", $"http://127.0.0.1:{Port}");
                using (var connecting = CancellationTokenSource.CreateLinkedTokenSource(cancel))
                {
                    connecting.CancelAfter(3_000);
                    await socket.ConnectAsync(new Uri($"ws://127.0.0.1:{Port}/ws"), connecting.Token);
                }
                await Read(socket, cancel);
            }
            catch (OperationCanceledException) when (cancel.IsCancellationRequested) { return; }
            catch (Exception) { /* Not running, or gone: looked for again below. */ }
            if (cancel.IsCancellationRequested) return;
            _onLive(false);
            try { await Task.Delay(AgainMs, cancel); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task Read(ClientWebSocket socket, CancellationToken cancel)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        var listening = false;
        while (socket.State == WebSocketState.Open)
        {
            var part = await socket.ReceiveAsync(buffer, cancel);
            if (part.MessageType == WebSocketMessageType.Close) return;
            message.Write(buffer, 0, part.Count);
            if (!part.EndOfMessage) continue;
            using var document = JsonDocument.Parse(message.GetBuffer().AsMemory(0, (int)message.Length));
            message.SetLength(0);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            if (type == "state")
            {
                listening = root.TryGetProperty("state", out var s) && s.GetString() == "listening";
                if (!listening) _onLive(false);
            }
            else if (type == "text" && listening)
            {
                // What it holds while no capture is on is the script from the time before: not shown.
                var text = root.TryGetProperty("text", out var words) ? words.GetString() ?? "" : "";
                if (text.Length == 0) continue;
                if (LiveDesk.Core.Timing.On) LiveDesk.Core.Timing.Line($"local text len={text.Length}");
                _onText(text);
            }
        }
    }
}
