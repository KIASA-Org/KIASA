# KIASA — Desktop Screen and Audio Sharing: Implementation Report

Date: 2026-11-05. Branch: `user-live-desk` (uncommitted working tree; nothing was committed or pushed).
Scope: the first upgrade from `audit/PROJECT_AUDIT_REPORT.md` §3.4 (gaps 1–4): a Windows desktop screen-and-sound sharing session, with consent, that an authorized manager receives in the website.

---

## 1. Summary

**What works, tested end to end on this PC (one Windows 11 machine, two processes, local Supabase):**
- A member's **KIASA Sound Desk** app (extended, not a new product) captures a **real display** (or one window) and the **computer's sound**, optionally the **microphone**, and sends them over WebRTC to the **manager's browser** at `/support/<id>`. The manager can **talk back**.
- Sharing starts only from the member's own click in a consent window that names the manager. A persistent, always-on-top **sharing bar** shows who is watching, the state, and **Pause screen / Computer sound / Microphone / Stop all**.
- The database decides who may do what. Only the member can consent. The live channel, the relay and the seat are limited to the member and the assigned manager. Every session event goes to an **append-only log**.
- Stop releases every capture device **in 48–118 ms, before any network call** (measured, 6 runs). It works with the backend down; the end is written later.
- A restart, crash or later launch **never resumes** sharing.
- **Direct and forced-relay (TURN) sessions both work**, with the chosen candidate pair recorded.
- Under 512 and 256 kbit/s caps, **voice stays clean** (0–0.6 % audio loss) while the picture slows and shrinks.

**What does not meet the goal (measured):**
- At a **128 kbit/s** cap the picture **freezes**; voice is still clean.
- With **150 ms delay + 30 ms jitter + 3 % loss per hop**, the picture is close to frozen (0.6 fps) and voice concealment is 11 %.
- Root cause for both: the media stack (SIPSorcery) does no packet pacing, retransmission (NACK/RTX) or FEC for video. See §8.

**What was not tested:**
- Two separate computers, international paths, Windows 10, a real network switch.
- Unplugging a display or audio device during a session.
- Sign-out during a session.
- The pre-existing native "Share sound" feature after the SIPSorcery upgrade.

These are marked NOT RUN in §7, with procedures in §9.

**Deliverable:** `apps/sound-desk/dist/KIASA Sound Desk.exe` v1.1.0 is an **unsigned development build**. Its updater is **off** (KIASA-010). A production release needs code signing (§10).

---

## 2. What changed, by audit finding

| Finding | What was done | State |
|---|---|---|
| §3.4 gaps 1–2 (no assistance session, no desktop capture client) | New support-session workflow: database (`support_sessions`, `support_events`, RPCs, channel rules), desktop capture/encode/send in Sound Desk, manager receiver in the website | Built, tested on one PC |
| §3.4 gap 4 / **KIASA-008** (no durable record) | `support_events`, append-only, insert only through `SECURITY DEFINER` functions; members see their own history at `/support` | Done **for support sessions only**; meetings, live sounds and scripts still unlogged |
| **KIASA-006** (meeting End/Leave keeps capture; Rejoin re-sends screen) | `use-meeting.ts` releases camera, mic and screen on Leave and on End (and when the meeting row says ended); Rejoin goes through the lobby, asks for devices again and never re-attaches a screen | Done; meetings e2e now asserts no live track after Leave and within 2 s of End |
| **KIASA-009** (Sound Desk: tooltip-only indicator, auto-resume from stored flag) | Distinct red-dot tray icon while anything is shared; balloon notices on start/stop; double-click asks before sharing; the `was-sharing` flag is deleted at start and never honoured; any session left open by an earlier run is ended (`app_restart`) | Done |
| **KIASA-010** (updater runs any `.exe`; no signing) | Updater not started (dev-only env override); build labelled unsigned | Updater disabled; **signing not done** (no certificate) |
| **KIASA-012** (`/say/ice` to any signed-in account) | `/say/ice` now requires an approved member or admin (403 otherwise) and is counted per person (429 after 60/hour, `relay` kind in `attempts`) | Done, tested |
| **KIASA-013** (self-declared identity in signals) | For support sessions: the app answers only the **seat** the database issued to the manager's latest page (`support_join`); offers carry an **epoch**; old seats/epochs are ignored | Done for support; meetings unchanged |
| **KIASA-015** (no adaptive media) | Support sessions: RTCP-driven controller for bit rate / fps / size / audio bit rate with hysteresis; encoder buffer cap; key frame after loss | Done for support, measured (§6); meetings unchanged |
| **KIASA-017** (lost ICE candidates) | In the new session code: candidates gathered before the offer are queued and sent after it; the browser buffers early candidates; the app adds the candidates inside the browser's answer itself | Done for support; the old `SoundSender.cs` path still has the bug |
| **KIASA-018** (refused-join reconnect storm; `*.old` deletion) | `RealtimeLink` waits 30–35 s after a refused join; the updater cleanup deletes only `KIASA Sound Desk.exe.old` | Done |
| **KIASA-019** (stale tokens on long channels) | `RealtimeLink` pushes a fresh `access_token` about every 10 minutes | Done (Sound Desk copy only) |
| Dependency advisories (found during this work) | SIPSorcery 6.2.4 → **10.0.17**, fixing GHSA-28gm-jrmw-xx93 (malformed UDP ends a media session) and GHSA-jwjp-4649-v8jp (SCTP out-of-bounds read), both high severity | Done |

---

## 3. Design: what was reused and why

**Entry point: KIASA Sound Desk** (`apps/sound-desk`). It already had what the session needs:
- the KIASA sign-in through `/say/sign-in` with DPAPI-sealed tokens;
- a raw Phoenix Realtime client;
- WASAPI loopback, Opus (Concentus) and SIPSorcery WebRTC to a browser.

User Live Desk is a text window with no media stack, so extending Sound Desk was the proportionate choice. The exe name and installs stay the same; the version moves to 1.1.0.

**Receiver: the existing website** — a new page `/support/<id>`, using the same Supabase Realtime private-channel pattern as live sounds and meetings.

```
Member PC: KIASA Sound Desk                                 Manager: browser /support/<id>
 ConsentWindow (member's click) ─► support_accept / support_request (RPC, the member's token)
 SharingBar (topmost, excluded from capture)                   support_join → new seat (RPC)
 Grabber (GDI BitBlt display / PrintWindow window)
   → Nv12 (BGRA→NV12, area-averaged scaling)
   → H264Encoder (Media Foundation: GPU MFT, else Windows software MFT)
   → SIPSorcery RTCPeerConnection ── DTLS-SRTP, direct or TURN ──► <video>
 SystemSound (process loopback, all apps except KIASA)                <audio>
 Microphone (WASAPI, Communications device) → Mixer → Opus 48k ──►   (manager hears)
 VoicePlayer (Opus → WASAPI) ◄────────────────────────────────────── manager mic (sendrecv)
 Signalling: Realtime private channel support:<id>  (join/offer/answer/candidate/state/leave/ended)
 Proof of life: support_beat every 10 s (app) / 5 s (page) — returns status, seat, revocation
 Relay: GET /say/support/ice?session=  (app)   ·   supportRelay(session) server action (page)
```

**Session rules (database, `20261106090000_support_sessions.sql`):**
- A manager is an admin, or the top manager of the member's team (`support_manager_ok`). An admin acting as manager is also subject to the device lock (`support_i_manage`).
- `support_request(manager, consent)`: the member picks a manager they may ask and consents in the same call; the session is live at once.
- `support_invite(member)`: the manager invites; nothing is shared until `support_accept(session, consent)`, which only the member can call, within 10 minutes.
- One open session per member (unique partial index). Ended is final; `support_end` is idempotent.
- The channel `support:<id>` is open to the member and the assigned manager while the session is live, the app has beaten within 2 minutes, and the manager is still allowed. Realtime checks this only at join, so both ends re-check the row (`support_beat`) and close on `ended` / `revoked`.
- Lapse: a live session whose app has not beaten for 2 minutes ends as `lapsed`; an unanswered invitation as `invite_expired`.
- Consent records `screen: "display" | "window"`, `system_audio` and `mic`. **Window titles are never stored.**
- Screen and sound are **never stored**. Only events are.

**What each audio option captures** (as shown in the consent window):
- **Computer sound**: everything the PC plays from every app, *except KIASA Sound Desk itself* (Windows process loopback, Windows 11 / Windows 10 build 20348+). Choosing one window **does not** limit sound to that window.
- **Microphone**: Windows' default communications microphone, or one chosen by name.

**Echo routing (measured on this PC, not assumed):**
1. The manager's voice is played by the app. Process loopback excludes the app, so the voice is normally not in "computer sound". Measured in the harness: with this app's own tone playing, plain loopback heard rms 0.035, process loopback excluding the app the same, because of item 2.
2. A **virtual output device** that re-plays everything from its own process defeats that exclusion. This PC's default output is **NVIDIA Broadcast**. The app therefore watches for the manager's voice coming back: the loudness curves move together at a 0–400 ms delay, correlation > 0.7 for 2 s. When it finds that, it lowers computer sound by 20 dB while the manager speaks and tells the member.
   - Measured: found after 2.0 s in the harness, and in the real e2e (`echo guard True` after the manager talked).
3. On Windows without process loopback, that lowering is on from the start.
4. Microphone: an **echo guard, not echo cancellation**. While the manager is speaking, the mic is lowered by 15 dB unless it is clearly louder than their voice would be through the speakers. The consent window recommends headphones. The browser side uses Chrome's own echo cancellation on the manager's mic.
   - The mic guard was **not** measured acoustically (no speaker-to-mic test here).

**Weak-network design (support sessions):**
- Voice first: Opus 48 kbit/s, dropping to 24 kbit/s only when video is already at its floor.
- Video adapts from the browser's RTCP receiver reports:
  - Congestion means more than 8 % loss, or more than 3 % with a round trip over 300 ms, or a round trip over 700 ms. Then the rate falls ×0.7 (at most every 2 s).
  - Frame rate follows the rate (15/10/5/3/2 fps). Size follows it too (100/75/50/37.5 %), so key frames fit the line.
  - Recovery: ×1.15 every 3 s after 8 s without congestion; sizes return only after 10 s well above their threshold.
  - The "degraded" label shows at once and clears only after 5 s, so it doesn't flicker.
- Key frames: one at least every 10 s, and after any reported loss (at most every 1.5 s). The encoder's buffer is capped at one frame's worth.
- Bounded queues: each audio source holds at most 200 ms (older audio is dropped). The playback buffer is 250 ms. Video frames are never queued: a frame is dropped if the encoder is busy.
- Proof of life:
  - The app treats the manager as gone when the browser's RTCP reports stop for 8 s.
  - It then waits a **120 s grace period** (state "Reconnecting / waiting") and ends as `manager_gone`.
  - It re-offers to the newest seat as soon as the page asks again.
- States shown on both ends: waiting, connecting, live, degraded, reconnecting, paused, ended.

---

## 4. Files

**New — database:** `apps/web/supabase/migrations/20261106090000_support_sessions.sql`.

**New — website:**
- `src/lib/support/server.ts` (native caller check, approved-or-admin, relay allowance, session relay)
- `src/lib/support/actions.ts` (`supportRelay`)
- `src/app/say/support/ice/route.ts`
- `src/app/support/page.tsx` (list, invite, history)
- `src/app/support/[id]/page.tsx` (receiver)
- `src/components/support/support-link.ts` (receiver logic)
- `src/components/support/support-room.tsx`
- `src/components/support/support-desk.tsx`
- `src/styles/support.css`
- Tests: `scripts/support-local/auth.cjs`, `scripts/support-local/e2e.cjs`, `scripts/support-local/ui.ps1`

**Changed — website:**
- `src/app/say/ice/route.ts` (KIASA-012)
- `src/lib/meetings/server.ts` (`iceServers(ttl)`)
- `src/components/meet/use-meeting.ts`, `meeting-room.tsx` (KIASA-006)
- `src/components/site/app-bar.tsx` ("Support" tab for admins)
- `src/app/layout.tsx` (stylesheet)
- `package.json` (`support:local:auth`, `support:local:e2e`)
- `scripts/meet-local/e2e.cjs` (device-release checks; Rejoin goes through the lobby)

**New — desktop (`apps/sound-desk`):**
- `Capture/Screens.cs` (display/window lists, GDI grabber, NV12)
- `Media/H264Encoder.cs`, `Media/RateControl.cs`
- `Audio/Sources.cs` (process loopback, plain loopback, microphone, device watcher), `Audio/Mixer.cs` (mixer, echo-path detector, voice player)
- `Support/Protocol.cs` (seat/epoch/stop rules), `Support/SupportApi.cs`, `Support/SupportSession.cs`
- `Support/ConsentWindow.xaml(.cs)`, `Support/SharingBar.xaml(.cs)`
- `tests/` (`DeskTests.csproj`, `Program.cs`, `RulesTests.cs`, `AudioTests.cs`)

**Changed — desktop:**
- `App.xaml.cs` (tray, consent, sessions, KIASA-009, per-data-folder single instance)
- `KiasaSoundDesk.csproj` (packages, version 1.1.0, unsafe code, tests excluded)
- `Net/RealtimeLink.cs` (refusal backoff, token push)
- `Net/Updater.cs` (flag never honoured, safe `.old` cleanup)
- `Net/Log.cs` (log follows `KIASA_SOUND_DESK_DATA`)

**Not mine, left untouched:** the existing uncommitted changes in `apps/admin live-desk`, `apps/user live-desk`, `apps/sound-desk/Net/SoundSender.cs` (diagnostic logging), `apps/web/src/lib/accounts/devices.ts`, and the untracked migrations `20261105100000_say_to_meeting.sql` and `20261105300000_desk_presence.sql`.

**Dependencies:**

| Package | Change | Licence / note |
|---|---|---|
| SIPSorcery | 6.2.4 → 10.0.17 | BSD-3-Clause **plus an additional use restriction** (no use inside Israel and the Occupied Territories; the clause is also present in the 6.2.4 package). Legal should confirm it is acceptable for KIASA. |
| Concentus | 2.1.0 → 2.2.2 | MIT (SIPSorcery 10 requires it) |
| Vortice.MediaFoundation | new, 3.8.3 | MIT; brings Vortice.DirectX, Vortice.Mathematics, SharpGen.Runtime. Uses Windows' own Media Foundation; no native binaries shipped |
| node-turn 0.0.6 | **test only**, in the session scratchpad, not in the repo | MIT. Patched there to accept the RFC 6156 attribute 0x17 that SIPSorcery sends |

**Environment variable names:**
- Website, existing: `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`, `MEETING_TURN_URLS`, `MEETING_TURN_USERNAME`, `MEETING_TURN_CREDENTIAL`, `KIASA_LIMITS` (counting is on automatically on Vercel). No new website variables.
- Desktop, development and test only:
  - `KIASA_SOUND_DESK_SITE` (loopback URLs only)
  - `KIASA_SOUND_DESK_DATA` (own data folder, log and single-instance lock)
  - `KIASA_DESK_RELAY_ONLY=1`, `KIASA_DESK_SOFTWARE_VIDEO=1`, `KIASA_DESK_PLAIN_LOOPBACK=1`, `KIASA_DESK_LOG_SDP=1`
  - `KIASA_SOUND_DESK_UPDATER=unsafe-dev-only` (never in production)

**Relay credentials:**
- Support sessions request Cloudflare TURN credentials with a **2-hour TTL**. Both ends re-request after an hour, and the app caches only real TURN results.
- Revocation: Cloudflare's credentials are **not revoked** when a session ends. Ending stops media at both ends at once and closes channel access; a credential already handed out stays usable until its TTL.
- If `MEETING_TURN_*` is set, the same static credential is still handed to approved callers. The audit recommends ephemeral credentials only; production uses Cloudflare.

---

## 5. How to build, start and join

**Apply the database change** (local first, then staging/production, by hand as for every KIASA migration):
- Local: `docker exec -i supabase_db_web psql -U postgres -d postgres < apps/web/supabase/migrations/20261106090000_support_sessions.sql` (re-running is safe).
- Production: run the same file in Supabase's SQL Editor. **Do this before deploying the website**; without it `/support` says "not set up".

**Website:**
- Deploy as usual; no new variables.
- Locally against the local copy:
  1. `npx supabase start`
  2. apply the migration
  3. `npm run chat:local:seed`
  4. build and serve on 3002 with the local keys passed as `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (optionally `KIASA_LIMITS=on`, and `MEETING_TURN_*` for a test relay).

**Desktop:**
- Build: `apps\sound-desk\build.ps1` → `apps\sound-desk\dist\KIASA Sound Desk.exe` (self-contained single file, 69.8 MB, **unsigned**).
- Debug: `dotnet build apps\sound-desk -c Debug`.
- Against a local site: set `KIASA_SOUND_DESK_SITE=http://127.0.0.1:3002` and `KIASA_SOUND_DESK_DATA=<empty folder>`.

**Member:** start the app and sign in.
- To ask for help: tray icon → **Support session: share my screen…** → choose the manager, what to show, which sounds → **Start sharing**.
- When invited: the consent window opens by itself within about 15 s, naming the manager → choose → **Start sharing**, or **Decline**.
- The red-bordered bar at the top of the screen shows the state and offers Pause screen, Computer sound, Microphone and **Stop all**.

**Manager (admin or top manager):**
- Open `/support`. Admins have a **Support** tab; top managers open the address directly.
- To invite: choose a member and click **Invite**.
- For an open session: click **Open**. The receiver has **Fit / 100% / Zoom**, **Talk** (manager's microphone), **Details** (route, round trip, picture size, fps, rates, loss) and **End session**.
- Add `?relay=1` to force the relay in the browser.

**Tests:**
- `npm run support:local:auth` (database rules)
- `npm run support:local:e2e` with `--relay`, `--grace` or `--impair` (desktop + browser; `--impair` needs the shaping relay, §6)
- `dotnet run --project apps/sound-desk/tests -- rules|encode|audio|echo` (desktop units; `audio` and `echo` play quiet test tones)

---

## 6. Checks executed and measurements

**Static and unit checks:**

| Check | Result |
|---|---|
| Web typecheck (`tsc --noEmit`) | Pass |
| Web lint (`eslint .`) | 0 errors, 1 warning (pre-existing, `bridge/chatgpt.js`, the same one the audit found) |
| Web production build (local keys) | Pass, including `/support`, `/support/[id]`, `/say/support/ice` |
| Desktop build (Debug and `build.ps1` publish) | Pass. Warnings only: obsolete Opus API in the old `Loopback.cs`; an un-awaited call in the old `SoundSender.cs` |
| Desktop unit tests (`rules`) | **22/22 pass**: seat/epoch/stop rules; rate controller (loss response, hysteresis, size, voice floor, 3 % random loss tolerated, no flapping) |
| Desktop encode tests (`encode`) | **15/15 pass** on this PC: display and window lists; capture; NVIDIA hardware and Windows software H.264 at 1706×960 and 852×480; first frame has SPS+PPS+IDR; key frame on request |
| Desktop audio and echo tests | Pass: process loopback available (build 26200); a tone from an unrelated process heard; mixer emits a frame every 20 ms; backlog capped at 200 ms; echo path found in 2.0 s |

**Measured on this PC** (Windows 11 26200, RTX 4060 laptop, 2560×1440 + 1920×1080 displays):

| Item | Measured |
|---|---|
| GDI capture of a 1706×960 (DPI-virtualised) display | median 13.6–15.9 ms/frame |
| BGRA→NV12 | 11.8–13.1 ms at 1706×960; 1.8–3.1 ms at 852×480 |
| H.264 encode | NVIDIA MFT: median 1.2–1.6 ms (1706×960), 0.6–0.7 ms (852×480). Windows software MFT: 4.0–4.6 ms and 1.5–2.1 ms |
| Session live after the manager opens the page | 3.9–4.5 s direct (first open); 1.2–1.6 s relay; 0.6–3.3 s on reopen |
| Picture delivered | 1920×1080 at 14.7–15.0 decoded fps (from a 2560×1440 display) |
| Capture released on Stop, before any network call | 48, 50, 62, 77, 77, 118 ms (6 runs) |
| Manager's view closed after Stop all (end to end, incl. UI Automation) | 2.3–5.0 s |
| Meeting End for everyone → every track on other pages ended | within 2 s (asserted) |

**Weak-network matrix** (`--impair`).
- Setup: relay-only through the local shaping TURN relay. The shaper applies each condition **on every hop, in both directions**: app→relay→browser for screen and sound, and the reverse for the manager's voice. Router queue 300 ms, drop-tail.
- Figures are the browser's own `getStats` over the steady second half of each phase, plus the app's own plan.

| Condition | Picture at manager | Voice at manager | States shown | App's plan at end |
|---|---|---|---|---|
| No limit | 1139–1972 kbit/s, 14.8–15 fps, 1920×1080 | 21 kbit/s, 0 % lost, 0 % concealed | live | 2.4 Mbit/s, 15 fps, 100 % |
| 512 kbit/s | 193–273 kbit/s, **4.2–12.4 fps**, 1440×810 (two runs) | 0–0.6 % lost, 0–0.4 % concealed | live → degraded after 4 s | 388 kbit/s, 10 fps, 75 % |
| 256 kbit/s | 78 kbit/s, **5.4 fps**, 960×540 | 0 % lost | degraded / live / reconnecting | 233 kbit/s, 5 fps, 50 % |
| 128 kbit/s | **0 fps (frozen)** | 0 % lost, 0 % concealed | degraded / reconnecting | 212 kbit/s, 5 fps, 37.5 % |
| Back to no limit (60 s) | 6.9 fps, 1440×810, rising | 0 % lost | → live | 738 kbit/s → |
| 150 ms one-way delay, 30 ms jitter, 3 % loss per hop (≈ 300 ms RTT, ≈ 6 % end to end) | 0.6 fps | 4.6 % lost, **11.3 % concealed** | degraded / reconnecting | 70 kbit/s floor |
| 10 s outage | — | — | degraded / reconnecting during | back to live 11.1 s after the line returned (one run 1.0 s to "degraded") |

Before the fixes made during this work, the same matrix gave 16–59 % audio loss and a permanently frozen picture. That run is what found:
- the SSRC/feedback defects;
- the full-size key frames;
- the REMB collapse.

**Proposed targets, still unmet:**
- Picture at least 1 fps at 128 kbit/s.
- Voice concealment under 5 % at 3 % loss.

---

## 7. Acceptance checklist

| # | Item | Result | Evidence / note |
|---|---|---|---|
| 1 | Two distinct devices/accounts: Windows user shares a selected screen and system sound; authorized manager sees/hears them in the website | **PASS on one PC; two devices NOT RUN** | e2e steps "real screen arrives as H.264" (1920×1080, 15 fps) and "computer's sound reaches the manager" (browser audio energy > 0, 0 concealed). Member = app as Ana, manager = Chromium as the admin, on the same machine |
| 2 | Mic and system audio enabled/muted independently; manager-to-user voice works without unacceptable feedback | **PASS** for independence and voice delivery; **feedback: PARTIAL** | e2e "each sound is switched on its own" (manager sees each change) and "manager talks" (104–495 voice packets played). The echo path through NVIDIA Broadcast was detected and guarded in the real run. Acoustic speaker→mic echo NOT RUN |
| 3 | Wrong/unassigned/revoked accounts cannot join or obtain session credentials | **PASS** | `auth.cjs` 23/23: another member, an admin who is not the assigned manager, an unapproved sign-up, no token, a revoked manager; channel join, `support_join`, row read and relay all refused; 429 after 60 relay requests/hour |
| 4 | Direct and forced-TURN sessions both work; selected candidate paths recorded | **PASS** (local TURN) | `route.txt`: "direct, same network (host → host, udp)" and "relay (relay → relay, udp)"; 6.4 MB through the relay; all 15 e2e steps pass relay-only. Cloudflare TURN NOT RUN |
| 5 | 128/256/512 kbit/s caps, latency/loss, outage, network switch produce truthful degradation/recovery states | **PARTIAL** | States were truthful (degraded/reconnecting shown, live after recovery). 512 and 256: usable picture, clean voice. **128 kbit/s: picture FAIL.** Delay+jitter+loss: picture FAIL, voice degraded. Outage: PASS. **Network switch NOT RUN** |
| 6 | Local Stop during a signalling outage releases capture immediately; late messages cannot restart it | **PASS** | e2e with the gateway container stopped: bar gone, "capture released in 48–118 ms", end kept and written after restart; channel and `support_join` refused after the end |
| 7 | Manager end/leave, user logout, device changes, app restart, later Windows login do not leave or restart sharing; grace period separate from termination | **PASS** for end, leave + grace (ended 130 s after the manager left), app kill + restart (ended `app_restart`, no bar), fresh launch shares nothing. **NOT RUN** for logout, device changes and a real Windows logon | Logout calls `Stop(signed_out)` in code. Windows logon: the stored flag is deleted and never read; sharing needs the consent window |
| 8 | Existing meetings and sound sharing still work | **PASS** for meetings (24/24, with new device-release assertions) and web live sounds (14/14). **NOT RUN** for the native Sound Desk "Share sound" after the SIPSorcery upgrade | — |
| — | Pause semantics; Stop all; persistent indicator with manager identity and states | **PASS** | e2e pause: 0–1 frames in 2.5 s; sources say computer sound still on. Bar shows "Sharing with Chris Lim", state, each source; red-dot tray icon |
| — | Reject stale offers, duplicate joins, out-of-order messages; idempotent termination | **PASS** | unit rules; reopened page gets a new seat (old one ignored); `support_end` twice leaves the first reason |
| — | Session/consent/termination events recorded; no media stored | **PASS** | events seen: invited, consent, manager_joined, paused, …, ended; admin delete/update had no effect; app insert refused |
| — | Display removal / resolution change | **NOT RUN** (code path only) | The grabber reports "display disconnected" and pauses the picture, sound continues; a size change rebuilds the encoder |
| — | Hardware acceleration with fallback and visible failure | **PASS** (encoder) | NVIDIA MFT used; software MFT tested; failure text shown in the bar if neither works |

---

## 8. Known limitations and blockers

1. **No pacing, retransmission or FEC for video** (SIPSorcery sends each frame's packets at once and does not resend). This is why 128 kbit/s and lossy long lines freeze the picture.
   - The app works around part of it: smaller pictures, a key frame after loss, an encoder buffer cap.
   - Next step: pace packets over the frame interval, add RTX, or move to a media stack with those (libwebrtc via a native bridge, or an SFU).
   - A still-image fallback over a data channel (same consent, size-limited, ephemeral) is **not built**.
2. **SIPSorcery quirks found, and how they are handled:**
   - It keeps only one feedback item per RTCP packet; Chrome's REMB hides key-frame requests. Handled with loss-triggered key frames.
   - It ignores `a=candidate` lines in a remote answer. Handled: the app adds them itself.
   - It labels bundled RTCP as audio. Handled: matched by SSRC.
3. **GDI capture**: about 14 ms per 1706×960 frame here, and roughly proportional to pixels. Some GPU-composed windows can come out black through `PrintWindow`.
   - Windows.Graphics.Capture would be faster, and would make window capture reliable; it needs a newer target framework.
   - The sharing bar is excluded from capture (`WDA_EXCLUDEFROMCAPTURE`, Windows 10 2004+).
4. **Echo:**
   - The mic path has a guard, not AEC; headphones are recommended in the UI.
   - Virtual output devices (NVIDIA Broadcast, Voicemeeter…) make system audio include the manager's voice; that is detected and guarded, not removed.
5. **Windows support:**
   - System audio excluding KIASA needs Windows 11 or Windows 10 build 20348+; older builds use plain loopback with lowering.
   - Windows "N" editions without the Media Feature Pack have no H.264 encoder: the screen cannot be shared and the bar says so.
   - Windows 10 is not tested.
6. **One manager per session.** No reassignment flow; ending and inviting again is the path.
7. **Invitations reach the app by polling every 15 s**, not by push.
8. **TURN credentials are not revoked on end** (Cloudflare expiry only, 2 h).
9. **Unsigned build.** SmartScreen will warn. The updater is off; updates are manual.
10. **Licence:** the SIPSorcery additional-use clause needs a legal decision (it was already present in 6.2.4).
11. **Out of scope, still open from the audit:**
    - The old `SoundSender.cs` candidate-timing bug (KIASA-017).
    - Meeting signalling recovery (KIASA-007).
    - Staff audit logging outside support sessions (KIASA-008).
    - All P1 items KIASA-001…005 and 011.

    No new critical issue outside this scope was found, apart from the SIPSorcery advisories, which are fixed here.

---

## 9. Manual procedures for what was not run

- **Two devices / international:**
  - Install the unsigned exe on a second Windows PC, then sign in as an approved member in a team whose top manager (or an admin) uses another network.
  - Run an invite → accept → Open session.
  - Record Details: the route, and the local → remote candidate types.
  - Repeat with `?relay=1` on the manager's page and `KIASA_DESK_RELAY_ONLY=1` on the app, to prove the Cloudflare relay.
- **Network switch:** while live, move the member PC from Wi-Fi to a phone hotspot. Expect "Reconnecting…" on both ends, then live again once the page asks again (watchdog 8 s); otherwise the session ends after 2 minutes. Record the times.
- **Device changes:**
  - While live, plug in or remove headphones: the computer sound and the voice should follow the new default device within about 1 s.
  - Unplug the shared display: the bar says "display disconnected", the manager sees "paused", sound continues.
- **Logout:** while live, tray → Sign out. Expect the bar to close, the manager's view to say "The member signed out of the app", and the database to record `signed_out`.
- **Windows logon:** with "Start with Windows" on and a session live, restart Windows. Expect no bar, no capture, and the old session ended as `app_restart`.
- **Acoustic echo:** use the laptop's speakers (no headphones), mic on, and have the manager speak. Listen on the manager side for their own voice coming back; repeat with headphones.
- **Native "Share sound" regression:** tray → double-click → confirm. An admin listens at `/admin/sounds`; expect sound, then Stop.

---

## 10. Production requirements and rollback

**Before release:**
1. Run the migration.
2. Deploy the website.
3. Code-sign `KIASA Sound Desk.exe`. `build.ps1` now calls `sign.ps1`, which signs with Microsoft Artifact Signing (`KIASA_SIGN_MODE=artifact`) or a bought certificate (`KIASA_SIGN_MODE=certificate`). It timestamps the signature and checks it with `Get-AuthenticodeSignature`. With nothing set up, it warns "UNSIGNED"; with `KIASA_SIGN_REQUIRED=1` it fails. Tested on 2026-11-05: the unsigned and required paths, plus real signing and timestamping with a throwaway self-signed certificate, which the check correctly rejected as untrusted. Still needed: a real account or certificate.
4. Keep the updater off until it verifies a signed manifest (KIASA-010).
5. Decide on the SIPSorcery licence clause.

**Rollback:**
- Website: revert the changed files above, and delete `src/app/support`, `src/app/say/support`, `src/components/support`, `src/lib/support` and `src/styles/support.css`. The meeting fix can stay on its own.
- Database: everything is additive. To remove it:

```sql
drop policy if exists "support channel read" on realtime.messages;
drop policy if exists "support channel send" on realtime.messages;
drop table if exists public.support_events, public.support_sessions cascade;
drop function if exists public.support_manager_ok(uuid,uuid), public.support_i_manage(uuid),
  public.support_note_raw(uuid,text,jsonb), public.support_lapse(), public.support_managers(),
  public.support_members(), public.support_name(uuid), public.support_consent_ok(jsonb),
  public.support_request(uuid,jsonb), public.support_invite(uuid), public.support_accept(uuid,jsonb),
  public.support_decline(uuid), public.support_join(uuid), public.support_beat(uuid),
  public.support_note(uuid,text,jsonb), public.support_end(uuid,text), public.support_mine(),
  public.support_relay_ok(uuid), public.support_allowed(text);
-- (support_view takes the table's row type and is dropped with the table by cascade.)
```

  The `/say/ice` restriction (KIASA-012) is independent; keep it.
- Desktop: reinstall the previous 1.0.0 exe. Version 1.1.0 keeps the same data folder and sign-in. In 1.0.0, the stored `was-sharing` flag (KIASA-009) is honoured again.
