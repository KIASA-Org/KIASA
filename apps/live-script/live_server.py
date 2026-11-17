"""
KIASA Live Script: the small service behind "Turn on live script" on KIASA's Interview page.
It reads Windows' own Live Captions (system_captions.py) and hands their words to the page.
It has no speech model of its own (from 1.2.0; before, it could also use one).

Audio and text stay on this PC. The service only listens on this PC (127.0.0.1), and only
pages listed in ALLOWED_ORIGINS can connect, so other websites can't start capture. Capture
stops by itself soon after the last page closes, and the service quits after a while with no
page.

Run from source:
    python live_server.py
Then open http://127.0.0.1:48765 for a demo page with the button.

Built as KIASA Live Script.exe (see build.ps1), it registers the link kiasa-live:// for this
Windows user the first time it runs, so the Interview page can open it.

Connecting from a page:
    const ws = new WebSocket("ws://127.0.0.1:48765/ws");
    ws.send(JSON.stringify({action: "start", source: "system"}));   // or {action: "stop"}
    ws.onmessage = (e) => JSON.parse(e.data);
Messages from the service:
    {"type": "hello", "version": "...", "sources": ["system"]}   (first; apps before 1.1.0 do not say it)
    {"type": "state", "state": "ready" | "connecting" | "listening" | "failed",
     "detail": "...", "source": "system" | null}
    {"type": "text", "text": "the whole script so far"}
    {"type": "error", "message": "...", "plain": true if it is meant to be read as it is}

LIVE_SCRIPT_ORIGINS adds more pages (comma-separated); LIVE_SCRIPT_PORT changes the port.
"""
import asyncio
import json
import os
import subprocess
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

from websockets.asyncio.client import connect
from websockets.asyncio.server import broadcast, serve
from websockets.exceptions import ConnectionClosed

import basics as ls
import system_captions

VERSION = "1.2.0"
# Windows Live Captions only: the app has no speech model of its own (from 1.2.0).
SOURCES = ["system"]

HOST = "127.0.0.1"
# Its own port: 8765, used before, is taken by other programs on some PCs (JobMail).
PORT = int(os.environ.get("LIVE_SCRIPT_PORT", "48765"))
DEMO_PAGE = ls.HERE / "live_demo.html"
INTERVIEW_PAGE = "https://kiasa.tech/interview"
ALLOWED_ORIGINS = [
    f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}", "https://kiasa.tech", "https://www.kiasa.tech",
] + [origin.strip() for origin in os.environ.get("LIVE_SCRIPT_ORIGINS", "").split(",") if origin.strip()]
STOP_AFTER = 15   # seconds after the last page closes before capture stops (a reload comes back sooner)
QUIT_AFTER = 600  # seconds with no page open, and nothing captured, before the service quits


class EngineFeed:
    """Where one engine's events go. A stopped engine can still have some on the way (closing
    its audio makes its loop fail, for one): they must not count against the engine after it."""

    def __init__(self, service: "Service"):
        self.service = service

    # Engine threads call this, so hand the event over to the server's own thread.
    def put(self, event: tuple) -> None:
        self.service.loop.call_soon_threadsafe(self.service.on_engine_event, self, event)


class Service:
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.clients = set()
        self.engine = None
        self.engine_thread = None
        self.feed = None
        self.source = None
        self.state = {"type": "state", "state": "ready", "detail": "Ready", "source": None}
        self.text = ""
        self.last_page = time.monotonic()

    def on_engine_event(self, feed: EngineFeed, event: tuple) -> None:
        if feed is not self.feed:
            return
        kind = event[0]
        if kind == "text":
            self.text = event[1]
            self.send({"type": "text", "text": event[1]})
        elif kind == "error":
            self.send({"type": "error", "message": event[1]})
            self.stop()
        elif kind == "problem":
            self.send({"type": "error", "message": event[1], "plain": True})
            self.stop()
        elif kind == "connecting":
            self.set_state("connecting", event[1])
        elif kind == "connected" or (kind == "status" and event[1].startswith("Listening")):
            self.set_state("listening", event[1])
        elif kind == "status":
            self.set_state(self.state["state"], event[1])

    def send(self, message: dict) -> None:
        broadcast(self.clients, json.dumps(message))

    def set_state(self, state: str, detail: str, progress: float | None = None) -> None:
        self.state = {"type": "state", "state": state, "detail": detail, "source": self.source}
        if progress is not None:
            self.state["progress"] = round(progress, 4)
        self.send(self.state)

    def start(self, source: str = "system") -> None:
        """Turn on: read Windows Live Captions (whatever source a page asks for)."""
        if self.engine is not None:
            return  # already on
        self.begin("system", lambda feed: system_captions.Engine(feed, ls.fix_terms))

    def begin(self, source: str, make_engine) -> None:
        self.text = ""
        self.send({"type": "text", "text": ""})
        self.feed = EngineFeed(self)
        self.engine = make_engine(self.feed)
        self.source = source

        def run(engine=self.engine, before=self.engine_thread):
            if before is not None:
                before.join(10)  # the capture before it lets go of what it holds first
            engine.run()

        self.engine_thread = threading.Thread(target=run, daemon=True)
        self.engine_thread.start()

    def stop(self) -> None:
        if self.engine is None:
            return
        self.engine.close()
        self.engine = None
        self.feed = None
        self.source = None
        self.save()
        self.set_state("ready", "Stopped")

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
            await connection.send(json.dumps({"type": "hello", "version": VERSION, "sources": SOURCES}))
            await connection.send(json.dumps(self.state))
            await connection.send(json.dumps({"type": "text", "text": self.text}))
            async for raw in connection:
                try:
                    message = json.loads(raw)
                    action = message.get("action")
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


async def another_version_running() -> bool:
    """Is the app holding our port another version of it? It only says so from 1.1.0 on."""
    try:
        async with connect(f"ws://{HOST}:{PORT}/ws", origin=f"http://{HOST}:{PORT}", open_timeout=3) as other:
            first = json.loads(await asyncio.wait_for(other.recv(), 3))
    except Exception:
        return False  # not one of ours, or too busy to say: leave it be
    return first.get("version") != VERSION


async def main() -> None:
    ls.keep_fast()  # first thing: Windows must not slow this process down as it runs on
    from_link = any(arg.startswith("kiasa-live:") for arg in sys.argv[1:])
    register_link()
    service = Service(asyncio.get_running_loop())

    async def listen():
        return await serve(service.handle, HOST, PORT, origins=ALLOWED_ORIGINS, process_request=serve_demo_page)

    try:
        server = await listen()
    except OSError:
        # Already running. A new download takes over from an older copy, which would otherwise
        # hold the port and leave the member stuck on the old app. Only a built app does this.
        if not FROZEN or not await another_version_running():
            if FROZEN and not from_link:  # opened by hand, it still takes the member to the page
                webbrowser.open(INTERVIEW_PAGE)
            return
        subprocess.run(
            [Path(os.environ["SystemRoot"]) / "System32" / "taskkill.exe",
             "/F", "/IM", Path(sys.executable).name, "/FI", f"PID ne {os.getpid()}"],
            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        await asyncio.sleep(1)
        server = await listen()
    async with server:
        print(f"Live Script service running at http://{HOST}:{PORT}", flush=True)
        if FROZEN and not from_link:
            webbrowser.open(INTERVIEW_PAGE)
        await service.quit_when_unused()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
