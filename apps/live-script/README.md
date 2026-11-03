# KIASA Live Script

The app behind **Turn on live script** on KIASA's Interview page (`/interview`). It turns
what a Windows PC plays into text, in the way the member chooses on the page:

- **KIASA live capture** (Windows 10 or 11): WASAPI loopback, not the microphone, through
  our speech model, on the CPU.
- **System live capture** (Windows 11, 22H2 or newer): Windows' own Live Captions, read
  from its window. It needs no speech model, and the app never fetches one for it.

Audio and text stay on the PC: the page talks to the app at `ws://127.0.0.1:8765/ws`, and
only KIASA's addresses may connect.

- `live_script.py`: capture and recognition (Nemotron streaming model through sherpa-onnx;
  about 660 MB, downloaded the first time KIASA live capture is turned on), and a
  standalone window.
- `system_captions.py`: system live capture. Windows has no way to subscribe to Live
  Captions, so this reads its window with UI Automation (`CaptionsTextBlock`) several times
  a second, and stitches that buffer, whose newest words Windows keeps correcting, into one
  script. It minimises the captions window while it works, and leaves it as it found it.
  Live Captions runs with the rights of whatever opened it, and Windows keeps a window with
  higher rights out of reach, so if another program opened it as administrator the page asks
  the member to close it, and connects by itself when they do.
- `live_server.py`: the service the page talks to. Capture stops 15 s after the last page
  closes; the service quits after 10 minutes with no page. It saves a copy of each script
  when capture stops (`%LOCALAPPDATA%\KIASA Live Script\transcripts` when built).
- `build.ps1`: builds `dist\KIASA-Live-Script.zip`. The first run of the .exe registers the
  `kiasa-live://` link for that Windows user.

Publish a new build as a GitHub release, and update `VERSION` in `live_server.py` and
`DOWNLOAD` in `apps/web/src/components/interview/live-capture.tsx`. Opened while another
version is running, the new app stops it and takes over the port.

Testing beside a running copy: set `LIVE_SCRIPT_PORT` and `LIVE_SCRIPT_ORIGINS` for the app,
and `NEXT_PUBLIC_LIVE_SCRIPT_PORT` when building the site.
