"""
KIASA Live Script: the small service behind "Turn on live script" on KIASA's Interview page.

The speech model stays loaded, so captions start as soon as the member clicks. Audio and
text stay on this PC. The service only listens on this PC (127.0.0.1), and only pages listed
in ALLOWED_ORIGINS can connect, so other websites can't start capture. Capture stops by
itself soon after the last page closes, and the service quits after a while with no page.

Run from source:
    python live_server.py
Then open http://127.0.0.1:8765 for a demo page with the button.

Built as KIASA Live Script.exe (see build.ps1), it registers the link kiasa-live:// for this
Windows user the first time it runs, so the Interview page can open it.

Connecting from a page:
    const ws = new WebSocket("ws://127.0.0.1:8765/ws");
    ws.send(JSON.stringify({action: "start"}));   // or {action: "stop"}
    ws.onmessage = (e) => JSON.parse(e.data);
Messages from the service:
    {"type": "state", "state": "loading" | "ready" | "listening" | "failed", "detail": "..."}
    {"type": "text", "text": "the whole script so far"}
    {"type": "error", "message": "..."}

LIVE_SCRIPT_ORIGINS adds more pages (comma-separated); LIVE_SCRIPT_PORT changes the port.
"""
import asyncio
import json
import os
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http import HTTPStatus
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)  # running as the built .exe, with no console
if FROZEN:
    # No console to write to: keep what would be printed in a log, and tell the model
    # downloader not to draw progress bars.
    log_dir = Path(os.environ["LOCALAPPDATA"]) / "KIASA Live Script"
    log_dir.mkdir(parents=True, exist_ok=True)
    sys.stdout = sys.stderr = open(log_dir / "service.log", "a", encoding="utf-8", buffering=1)
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

from websockets.asyncio.server import broadcast, serve
from websockets.exceptions import ConnectionClosed

import live_script as ls

HOST = "127.0.0.1"
PORT = int(os.environ.get("LIVE_SCRIPT_PORT", "8765"))
DEMO_PAGE = ls.HERE / "live_demo.html"
INTERVIEW_PAGE = "https://kiasa.tech/interview"
ALLOWED_ORIGINS = [
    f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}", "https://kiasa.tech", "https://www.kiasa.tech",
] + [origin.strip() for origin in os.environ.get("LIVE_SCRIPT_ORIGINS", "").split(",") if origin.strip()]
STOP_AFTER = 15   # seconds after the last page closes before capture stops (a reload comes back sooner)
QUIT_AFTER = 600  # seconds with no page open, and nothing captured, before the service quits


class Service:
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.clients = set()
        self.recognizer = None
        self.engine = None
        self.state = {"type": "state", "state": "loading", "detail": "Loading speech model..."}
        self.text = ""
        self.last_page = time.monotonic()

    # Engine threads call this, so hand the event over to the server's own thread.
    def put(self, event: tuple) -> None:
        self.loop.call_soon_threadsafe(self.on_event, event)

    def on_event(self, event: tuple) -> None:
        if event[0] == "text":
            self.text = event[1]
            self.send({"type": "text", "text": event[1]})
        elif event[0] == "error":
            self.send({"type": "error", "message": event[1]})
            self.stop()
            if self.recognizer is None:
                self.set_state("failed", "The speech model did not load")
        elif event[0] == "status" and event[1].startswith("Listening"):
            self.set_state("listening", event[1])
        elif event[0] == "status":
            self.set_state(self.state["state"], event[1])

    def send(self, message: dict) -> None:
        broadcast(self.clients, json.dumps(message))

    def set_state(self, state: str, detail: str) -> None:
        self.state = {"type": "state", "state": state, "detail": detail}
        self.send(self.state)

    def load_model(self) -> None:
        try:
            recognizer = ls.load_recognizer(self.put_status)
            self.loop.call_soon_threadsafe(self.on_loaded, recognizer)
        except Exception as exc:
            self.put(("error", f"{type(exc).__name__}: {exc}"))

    def put_status(self, text: str) -> None:
        self.put(("status", text))

    def on_loaded(self, recognizer) -> None:
        self.recognizer = recognizer
        self.set_state("ready", "Ready")

    def start(self) -> None:
        if self.state["state"] == "failed":  # no model yet (no internet?): try again
            self.set_state("loading", "Loading speech model...")
            threading.Thread(target=self.load_model, daemon=True).start()
            return
        if self.recognizer is None or self.engine is not None:
            return  # still loading, or already on
        self.text = ""
        self.send({"type": "text", "text": ""})
        self.engine = ls.Engine(self, self.recognizer)
        threading.Thread(target=self.engine.run, daemon=True).start()

    def stop(self) -> None:
        if self.engine is None:
            return
        self.engine.close()
        self.engine = None
        self.save()
        self.set_state("ready" if self.recognizer else "loading", "Stopped")

    def save(self) -> None:
        if self.text:
            ls.TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
            path = ls.TRANSCRIPT_DIR / f"script_{datetime.now():%Y%m%d_%H%M%S}.txt"
            path.write_text(self.text + "\n", encoding="utf-8")

    def stop_if_no_page(self) -> None:
        if not self.clients:
            self.stop()

    async def handle(self, connection) -> None:
        self.clients.add(connection)
        try:
            await connection.send(json.dumps(self.state))
            await connection.send(json.dumps({"type": "text", "text": self.text}))
            async for raw in connection:
                try:
                    action = json.loads(raw).get("action")
                except (ValueError, AttributeError):
                    continue
                if action == "start":
                    self.start()
                elif action == "stop":
                    self.stop()
        except ConnectionClosed:
            pass  # a closed or crashed tab is normal
        finally:
            self.clients.discard(connection)
            self.last_page = time.monotonic()
            # Nobody is left to see it: capture must not go on unseen.
            self.loop.call_later(STOP_AFTER, self.stop_if_no_page)

    async def quit_when_unused(self) -> None:
        while self.clients or self.engine is not None or time.monotonic() - self.last_page < QUIT_AFTER:
            await asyncio.sleep(15)


def serve_demo_page(connection, request):
    """Serve the demo page on plain web requests; let WebSocket requests through."""
    if request.path != "/ws":
        response = connection.respond(HTTPStatus.OK, DEMO_PAGE.read_text(encoding="utf-8"))
        response.headers["Content-Type"] = "text/html; charset=utf-8"
        return response
    return None


def register_link() -> None:
    """Let this Windows user's browsers open the built app from a kiasa-live:// link."""
    if not FROZEN:
        return
    import winreg

    base = r"Software\Classes\kiasa-live"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, "URL:KIASA Live Script")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\shell\open\command") as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, f'"{sys.executable}" "%1"')


async def main() -> None:
    from_link = any(arg.startswith("kiasa-live:") for arg in sys.argv[1:])
    register_link()
    service = Service(asyncio.get_running_loop())
    try:
        server = await serve(service.handle, HOST, PORT, origins=ALLOWED_ORIGINS, process_request=serve_demo_page)
    except OSError:
        # Already running. Opened by hand, it still takes the member to the page.
        if FROZEN and not from_link:
            webbrowser.open(INTERVIEW_PAGE)
        return
    async with server:
        threading.Thread(target=service.load_model, daemon=True).start()
        print(f"Live Script service running at http://{HOST}:{PORT}", flush=True)
        if FROZEN and not from_link:
            webbrowser.open(INTERVIEW_PAGE)
        await service.quit_when_unused()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
