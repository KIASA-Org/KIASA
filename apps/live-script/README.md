# KIASA Live Script

The app behind **Turn on live script** on KIASA's Interview page (`/interview`). It turns
what a Windows 10 or 11 PC plays (WASAPI loopback, not the microphone) into text, on the
CPU. Audio and text stay on the PC: the page talks to it at `ws://127.0.0.1:8765/ws`, and
only KIASA's addresses may connect.

- `live_script.py`: capture and recognition (Nemotron streaming model through sherpa-onnx;
  about 660 MB, downloaded on first run), and a standalone window.
- `live_server.py`: the service the page talks to. Capture stops 15 s after the last page
  closes; the service quits after 10 minutes with no page. It saves a copy of each script
  when capture stops (`%LOCALAPPDATA%\KIASA Live Script\transcripts` when built).
- `build.ps1`: builds `dist\KIASA-Live-Script.zip`. The first run of the .exe registers the
  `kiasa-live://` link for that Windows user.

Publish a new build as a GitHub release and update `DOWNLOAD` in
`apps/web/src/components/interview/interview-app.tsx`.

Testing beside a running copy: set `LIVE_SCRIPT_PORT` and `LIVE_SCRIPT_ORIGINS` for the app,
and `NEXT_PUBLIC_LIVE_SCRIPT_PORT` when building the site.
