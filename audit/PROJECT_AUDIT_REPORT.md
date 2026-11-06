# KIASA — Existing Project Audit

| | |
|---|---|
| Date | 2026-11-05 |
| Repository | `D:\My Work\KIASA` (GitHub `KIASA-Org/KIASA`, public) |
| Branch / commit | `user-live-desk` at `acc69f6980dd10f0e493088c0a88219eecfa3bc2`, **with uncommitted and untracked work** (§2.1) |
| Mode | Read-only audit. No application code, configuration, dependency, lockfile, migration or infrastructure was changed. The only file added is this report. |
| Requirements baseline | **No PRD was supplied and none exists in the repository.** The baseline in the audit request is used instead; §4 maps it item by item. |

Throughout, *Verified* means confirmed by reading the code or by a check run in this audit. *Plausible* means the code allows it but it was not reproduced. *Unverified* means it needs a runtime, platform or network test that was not run. Priority (P0–P3) and confidence are kept separate.

---

## 1. Executive assessment

### 1.1 What KIASA actually is

The audit request describes a remote-assistance product: a Windows client that shares a job seeker's screen and audio with an assigned manager, with a queue, consent, adaptive WebRTC and signed releases. **The repository does not implement that product.** It implements a team workspace for job seekers ("members") run by admins and managers:

- **Web app** (`apps/web`): Next.js 16.4.3, React 19.2.8 and Supabase (Postgres with RLS, Auth, Realtime, Storage), deployed on Vercel at kiasa.tech. It provides:
  - chat, teams and managers;
  - a jobs desk, and résumé tailoring through a ChatGPT browser-extension bridge;
  - browser meetings: a WebRTC mesh with Cloudflare TURN, screen sharing, and recording to the admin's own disk;
  - a "live script" page that streams a transcript of whatever the member's PC plays to admins;
  - "live sounds", where a member's computer audio is streamed to admins;
  - simulated members;
  - control pages for an auto-apply agent.
- **Windows desktop apps** (.NET 8 WPF):
  - *Sound Desk* (`apps/sound-desk`) streams all computer audio to admins.
  - *Admin Live Desk* (`apps/admin live-desk`, mostly untracked) reads members' live transcripts, pastes chosen text into the admin's own foreground app, and sends typed text to a member.
  - *User Live Desk* (`apps/user live-desk`) is an always-on-top window that shows what an admin types.
- **KIASA Browser** (`agentic browser/`, Go and playwright-go). It fills in and submits job applications on third-party applicant-tracking systems (Greenhouse, Lever, Ashby) using answers from a local LLM (Ollama, `qwen3:8b`) exposed through a Cloudflare tunnel. It reads email verification codes from the member's Gmail. It updates itself from an ed25519-signed manifest.
- **KIASA Live Script** (`apps/live-script`, Python): local speech recognition, or Windows Live Captions, served on `ws://127.0.0.1:8765`.

**Maturity: an early-production system for a small team, with local functionality and partial deployment.** It is not a production candidate for the remote-assistance PRD. Evidence:
- It is live: desktop apps pin `https://www.kiasa.tech`, and `apps/web/public/browser/latest.json` points at a published browser release.
- The build and quality checks pass (§6).
- It lacks CI, staging, migration tracking and monitoring.
- No binary carries an Authenticode signature.
- The Admin Live Desk source is not in git.
- One developer PC is the build machine and holds the release keys.

### 1.2 Strongest foundations (keep them)

1. **Database authorization.**
   - RLS is enabled on all 51 tables.
   - All 129 `SECURITY DEFINER` functions set `search_path = ''`.
   - Admin identity comes from `admins.user_id`.
   - Admin sessions are bound to approved devices inside the database (`admin_session_ok()`, `20261029230000_admin_devices.sql`), not just in the UI.
2. **Realtime access control.**
   - Private channels are guarded by `realtime.messages` policies.
   - Listening to sound or reading a live script needs a fresh heartbeat row (`sound_allowed`, `live_script_allowed`).
3. **Meeting negotiation.** Perfect negotiation is implemented correctly: polite/impolite roles, deferred offers while answering, and candidates bundled into the SDP after a bounded gather (`apps/web/src/components/meet/use-meeting.ts`). TURN credentials are short-lived Cloudflare credentials.
4. **Text delivery.** `apps/web/src/components/interview/live-link.ts` keeps text flowing through hidden tabs and poor networks: a paced in-flight window, HTTP fallback, gap repair and resync.
5. **KIASA Browser.**
   - Signed update manifests with a streamed SHA-256 check.
   - Local listeners bind to loopback only, with Host and Origin checks.
   - Secrets are sealed with DPAPI.
   - 13 Go test packages pass, offline.
6. **Desktop credentials.** No stored passwords; DPAPI-sealed refresh tokens; site pinned to HTTPS; no TLS-validation overrides; all apps run `asInvoker`.
7. **Web hygiene.**
   - The job-page reader is guarded against SSRF, both before the request and at connect time.
   - Résumé HTML is escaped before PDF printing.
   - Chat files are bound to the message's chat and limited by MIME allowlist.
   - No secrets in the 180-commit history (pattern scan).
8. **Résumé fact restoration.** After AI edits, companies, dates, schools, names and contact details are put back (`apps/web/src/lib/resume/apply-init.ts`).

### 1.3 The five most important weaknesses

1. **The automated job-application agent can submit in the member's name with nothing confirmed by them.**
   - There is no member review of the answers.
   - Admins can switch it on for any member.
   - It can tick accuracy attestations for the member.
   - It completes "confirm you're a human" code checks.
   - It masks its automation on third-party sites.

   (KIASA-001…004)
2. **Third-party audio is captured and relayed to staff.** The interviewer and anyone else on a call are captured and relayed to staff in real time, with a staff-to-member text window. Consent rests only on the member, and staff observation leaves no audit trail. (KIASA-005, KIASA-008)
3. **Capture can continue, or restart, without a fresh decision.**
   - Ending or leaving a meeting does not stop capture.
   - A reload restarts the live script.
   - Sound Desk can resume sharing at a later logon, and only a tooltip shows that sharing is on.

   (KIASA-006, KIASA-009, KIASA-016)
4. **Meetings are weak on poor networks.**
   - Signaling has no recovery path.
   - Adaptation is static: caps are applied once, video is never shed, and diagnostics lack RTT, loss and jitter.
   - TURN credentials expire after 4 hours and are not refreshed.

   This is the PRD's central requirement. (KIASA-007, KIASA-015)
5. **Releases and operations are fragile.**
   - No Windows binary is code-signed.
   - The Sound Desk updater would run any downloaded `.exe`.
   - Migrations are pasted by hand with no record of what ran. A security control has already been found silently off in production for this reason.
   - There is no CI and no monitoring.

   (KIASA-010, KIASA-035, KIASA-036, KIASA-037)

### 1.4 Release blockers

The P1 findings KIASA-001 to KIASA-011 block a production release. For a release of the PRD baseline, these missing items also block it: the assistance queue and assignment, a desktop screen-capture client, adaptive and audio-first media, and durable consent and audit history (§4).

**Containment note.** KIASA-001 to KIASA-005 are graded P1 because the repository cannot show whether these paths are in active use with real employers. If any member has `apply_control.mode = 'apply'`, or if live capture or Live Desk is used during real third-party interviews, treat them as **P0**: suspend those paths and obtain legal review before continuing.

---

## 2. Repository coverage

### 2.1 Working-tree state at audit time

- **Modified, uncommitted:**
  - `apps/admin live-desk/{MainWindow.xaml, MainWindow.xaml.cs, Net/NotifyLink.cs}`
  - `apps/sound-desk/Net/SoundSender.cs`
  - `apps/user live-desk/{App.xaml, KiasaUserDesk.csproj, MainWindow.xaml(.cs), Net/NotifyLink.cs, Net/RealtimeLink.cs}`
  - `apps/web/src/lib/accounts/devices.ts`
- **Deleted in the working tree:** all 30 tracked files of `apps/live-desk/`. The folder was renamed to `apps/admin live-desk/`, whose copy is **untracked**, apart from 3 files.
- **Untracked:**
  - `apps/user live-desk/Net/PresenceLink.cs` and assets
  - migrations `20261105100000_say_to_meeting.sql` and `20261105300000_desk_presence.sql`
- **Ignored but present locally:** `apps/web/.env.local`. Only variable names were read: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. Also `agentic browser/internal/modelserver/prompts/MASTER_PROMPT.md`.
- **Running on the audit PC:** `KiasaLiveDesk`, `KiasaSoundDesk` and `KIASA Live Script`. The latter was listening on `127.0.0.1:8765` only. Builds were done from copies so the running binaries were not touched.

### 2.2 Coverage ledger

| Area | Size | Depth | Notes |
|---|---|---|---|
| Web: real-time (`components/meet`, `components/sound`, `components/interview`, `lib/meetings`, `app/say/*`) | ~4.5k lines | Read in full | — |
| Web: auth, server actions, route handlers, `proxy.ts`, `next.config.ts`, `public/sw.js`, `bridge/` | ~3k lines | Read in full | — |
| Web: chat, jobs, résumé, teams, sims, apply UI | ~8k lines | Server and authorization paths read; résumé AI-edit path read | UI rendering skimmed |
| Supabase migrations (36, including 2 untracked) | — | All read | Tables, RLS, definer functions, realtime policies, cron |
| `apps/sound-desk` | 1.4k | Read in full | — |
| `apps/admin live-desk` | 7.0k | Read in full | Including tests and tools |
| `apps/user live-desk` | 1.1k | Read in full | — |
| `agentic browser/` | 17.8k | Read in full | Including tests and scripts |
| `apps/live-script` | 1.5k | Read in full | — |
| Docs (`README.md`, `apps/web/docs/*.md`, app READMEs) | — | Read | — |

**Excluded or sampled:**
- `apps/web/src/content/docs/*` (~10k lines of sample marketing copy) was only searched for privacy and retention promises.
- Not reviewed:
  - images and stock assets;
  - CSS;
  - the landing-page animation;
  - `node_modules`, `bin/`, `obj/`, `dist/` and built `.exe` files (these are not tracked);
  - the 7.5 MB ONNX punctuation model.
- **Not present in this repository:** the Jobright "Job Saving Bot", which lives in a separate repo.
- **Not accessible:**
  - production Supabase (data, Auth, Realtime and hook settings);
  - Vercel environment;
  - Cloudflare TURN configuration;
  - GitHub release artifacts;
  - any second Windows machine, Windows 10, or an international network path.

**Method:** four parallel read-only area reviews: (1) web real-time, (2) web backend and database, (3) desktop apps, (4) Go browser and Python capture. Every P1 finding and most P2 findings were then re-checked directly against the source.

### 2.3 Stack inventory

| Component | Language / framework | Key dependencies (as pinned) | Entry points |
|---|---|---|---|
| `apps/web` | TypeScript, Next.js 16.4.3 (App Router, Turbopack), React 19.2.8 | `@supabase/supabase-js` 2.117.3, `@supabase/ssr` 0.12.7, zod 4, web-push 3.6.7, playwright-core + `@sparticuz/chromium` (PDF), motion | `src/app/**`, middleware `src/proxy.ts`, route handlers under `src/app/{say,desk,jobs,dev}` |
| Database | Supabase Postgres, `pg_cron` | 36 SQL files in `apps/web/supabase/migrations` | Applied **by hand** in the SQL editor (`apps/web/docs/site.md`, "Connecting accounts") |
| `apps/sound-desk` | C# .NET 8 WPF + WinForms tray | NAudio 2.2.1, Concentus 2.1.0, SIPSorcery 6.2.4 | `App.xaml.cs` |
| `apps/admin live-desk` | C# .NET 8 WPF | — | `MainWindow.xaml.cs`; tests in `tests/` |
| `apps/user live-desk` | C# .NET 8 WPF | — | `MainWindow.xaml.cs` |
| `agentic browser` | Go 1.27.3, module `stealth-app` | playwright-go v0.6201.1 | `main.go`, `cmd/setup`, `cmd/modelserver`, `tools/*` |
| `apps/live-script` | Python 3.12, PyInstaller | sherpa-onnx 2.0.1, websockets 17.4, PyAudioWPatch, comtypes, huggingface_hub | `live_server.py` |

**External services:**
- Supabase (database, Auth, Realtime, Storage)
- Vercel
- Cloudflare Realtime TURN
- Google STUN
- GitHub Releases
- Cloudflare quick tunnels (`*.trycloudflare.com`)
- Google Gmail API (OAuth, read-only)
- Hugging Face (speech model download)
- ChatGPT, through the member's browser extension

**Environment variable names** (values not read):
- Web:
  - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, or the older name `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SECRET_KEY`, or the older name `SUPABASE_SERVICE_ROLE_KEY`
  - `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  - `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`
  - `MEETING_TURN_URLS`, `MEETING_TURN_USERNAME`, `MEETING_TURN_CREDENTIAL`
  - `KIASA_LIMITS`, `VERCEL`
  - `NEXT_PUBLIC_LIVE_SCRIPT_PORT`
  - `PDF_EXECUTABLE_PATH`
- Desktop:
  - `KIASA_{SOUND_DESK,USER_DESK,DESK}_{SITE,DATA}`
  - `KIASA_DESK_TRACE`, `KIASA_DESK_DIRECT`, `KIASA_DESK_CAPTURE_PORT`, `KIASA_DESK_ONLY_INTO`
- Go: `KIASA_PUBLIC_KEY`, `KIASA_TEST_HEADLESS`
- Python: `LIVE_SCRIPT_PORT`, `LIVE_SCRIPT_ORIGINS`

**Supported operating systems:**
- Desktop apps: Windows only, x64. No `supportedOS` entries in the manifests. Windows 10 is untested according to the project's own notes.
- Web: tested in Chromium only (`apps/web/docs/verification.md`, "Not verified").

### 2.4 Discrepancies between documentation and code

| Location | Claim | Reality |
|---|---|---|
| `apps/web/docs/site.md` "Connecting accounts" | Lists the migrations to run | Stops at `20261102090000_job_reads.sql`; 7 later files are not listed (KIASA-035) |
| `apps/live-script/live_server.py:7`, `README.md:11` | "Audio and text stay on this PC" | The text is streamed to admins (KIASA-005) |
| `agentic browser/internal/agent/agent.go:5-6`, `internal/greenhouse/greenhouse.go:2-4` | Nothing presses a form's submit button | Submit is implemented (`agent.go:340-343`, `agent/submit.go`) |
| `apps/web/src/components/apply/apply-work.tsx:174-178` | "It does not press submit" | True for "fill" mode only; "apply" mode submits |
| `apps/web/src/components/meet/recorder.ts` | "written … a second at a time" | The file is committed only on `close()` (KIASA-014) |
| `apps/web/src/content/docs/account.ts:97` | Details "are deleted at once" | Résumé and chat files remain after deletion (KIASA-011) |
| `apps/web/src/content/docs/legal.ts:380,414-421` | Retention periods | No deletion jobs for most data (KIASA-032) |
| `apps/admin live-desk/tests/e2e.cjs:6-7` | Refers to `apps/live-desk` | That folder is deleted |

---

## 3. Architecture

### 3.1 Component topology and trust boundaries

```
 [TB1] Member's Windows PC (member-controlled)                        [TB4] Third parties
 ┌──────────────────────────────────────────────────────────────┐     ┌────────────────────────┐
 │ Chrome ── kiasa.tech pages (chat, jobs, meet, interview,      │     │ ATS sites (Greenhouse, │
 │           apply, live sounds)                                 │     │ Lever, Ashby)          │
 │   │  ws://127.0.0.1:8765 (Origin allowlist)                   │     │ Gmail API (read-only)  │
 │   └── KIASA Live Script (Python): loopback ASR or Live        │     │ ChatGPT (via bridge)   │
 │        Captions (UIA); transcripts saved under %LOCALAPPDATA% │     │ Hugging Face (model)   │
 │ ChatGPT Bridge extension (<all_urls>)                         │     └──────────▲─────────────┘
 │ KIASA Browser (Go): member's Chrome profile, proxy,           │────────────────┘ form fill / submit
 │   DPAPI-sealed kapp_ key and Gmail token                      │──┐
 │ Sound Desk (.NET): WASAPI loopback → Opus → SIPSorcery        │  │ HTTPS: questions + résumé + facts
 │ User Live Desk (.NET): topmost text window                    │  │
 └──────┬──────────────────────────────────┬────────────────────┘  ▼
        │ HTTPS (REST, server actions)      │ WSS (Realtime)     [TB5] Operator PC: Model Server
        ▼                                  ▼                     (Go) → Ollama; exposed by a
 [TB2] Vercel: Next.js server         [TB3] Supabase              Cloudflare quick tunnel
  - server actions (service key)        - Postgres + RLS          (*.trycloudflare.com)
  - /say/*, /desk/sign-in (tokens)      - Auth (+ access-token hook)
  - /say/ice → Cloudflare TURN API      - Realtime private channels:
  - /jobs/resume/pdf (Chromium)           meet:<id>, sound:<uid>, live-script:<uid>,
  - push (VAPID)                          notify:<uid>, say:<id>, desk
                                        - Storage: avatars, chat-files, resumes
        ▲                                  ▲
        │                                  │
 [TB6] Staff PCs: admin browser (/admin/*, /meet), Admin Live Desk (.NET: reads scripts,
       pastes into own foreground app, sends notify text), managers' browsers
```

**Trust boundaries:**
- **TB1.** Anything running on the member's PC is under the member's control. Its local listeners must refuse other local web origins.
- **TB2/TB3.** The server and database enforce every authorization rule. Realtime checks permissions **only when a channel is joined**.
- **TB4.** Third-party content (job descriptions, form labels, emails) is untrusted input, and it reaches an LLM prompt.
- **TB5.** The model server holds members' résumés and facts in transit. Cloudflare decrypts tunnel traffic at its edge.
- **TB6.** Staff hold broad read access. Their observation leaves no record (KIASA-008).

### 3.2 Signaling path versus media path

| Feature | Signaling / control path | Media / data path | Initiator and consent |
|---|---|---|---|
| Meetings `/meet/[id]` | Realtime private channel `meet:<id>`: presence (peer state) plus broadcast `signal` and `ended`; admissions and chat in Postgres | Full-mesh browser-to-browser RTCPeerConnections; STUN (Google) or TURN (Cloudflare, or static `MEETING_TURN_*`) | Organized by admins and top managers; members ask to join and a host admits them; browser prompts for camera, mic and screen |
| Live sounds (web) | `sound:<memberId>` broadcast; `sound_shares` heartbeat row | One-way audio, member → each listening admin, P2P or TURN; the picture is captured but never sent | The member clicks Share sound; an amber notice shows on every page |
| Sound Desk (native) | Same channel and row, through a raw Phoenix WebSocket (`Net/RealtimeLink.cs`) | WASAPI loopback → Opus 64 kbps mono → SIPSorcery → admin's browser | Tray menu or double-click; tooltip only (KIASA-009) |
| Live script | `live-script:<memberId>` broadcast (change, tick, want, resync, seen) plus HTTP fallback; `live_sessions` heartbeat | Text only, no WebRTC. Capture runs locally on `127.0.0.1:8765` | The member turns it on; an amber bar shows; resumes after a reload (KIASA-016) |
| Live Desk notify | `notify:<memberId>` broadcast, admins send (`20261105200000_notify_to_user.sql`) | Text: full message, selection and sequence number every ≤50 ms | Admin-initiated; the member's window shows it |
| Desk presence | `desk` broadcast (**untracked migration, not yet applied per project notes**) | — | Any approved member can send or read (KIASA-024) |
| Auto-apply | Supabase RPCs with a `kapp_` key (`browser_agent_*`); `apply_control` mode | HTTPS to the model server through the tunnel; form fill and submit on ATS sites | Member or **admin** can set the mode (KIASA-001) |

No media goes through ordinary application APIs. Signaling goes over Supabase Realtime, and only text features use HTTP fallback.

### 3.3 Session lifecycle trace: meetings (the closest to an "assistance session")

1. **Login.**
   - `signIn` (`apps/web/src/lib/accounts/actions.ts`) uses Supabase SSR cookies.
   - `src/proxy.ts:8-31` refreshes the session on private routes.
   - For admins, `trustSignIn` (`lib/accounts/devices.ts`) applies the device lock.
2. **Request / organize.**
   - `start` and `schedule` in `lib/meetings/actions.ts` are open to admins and top managers (`organizer()`, :24-35).
   - A manager's meeting that includes people outside their team waits for an admin's approval (`meeting_people.approval`, `20261029150000_meeting_people.sql`).
   - **There is no assistance queue.**
3. **Assignment.** The people invited are rows in `meeting_people`. A card in chat rings for them (`components/chat/chat-meeting.tsx`).
4. **Page.** `app/meet/[id]/page.tsx` → `meetingFor()` (`lib/meetings/server.ts`).
   - The database decides visibility.
   - ICE servers are minted per page load. The Cloudflare TTL is 14,400 s (`server.ts:20`).
5. **Lobby.** Camera and mic are requested when the page opens (`use-meeting.ts:327-357`), even for a meeting that has ended.
6. **Approval.** `askToJoin` and `decideJoin` write `meeting_admissions`. Hosts are all admins plus the creator.
7. **Participant authorization.**
   - `realtime.messages` policies: read = `meeting_member()`, send = `in_meeting()` (`20261029180000_security.sql:102-110`).
   - These are checked only at channel join. The page rejoins after admission.
   - Identity inside messages is self-declared (KIASA-013).
8. **Signaling.**
   - A broadcast `signal` carries `{from, to, user, description|candidate}`.
   - Perfect negotiation is used.
   - Candidates are embedded in the SDP after the first srflx or relay candidate (+150 ms; at most 2.5 s), then trickled.
9. **ICE/TURN.**
   - Google STUN plus Cloudflare TURN, with port-53 URLs removed.
   - There is no relay-only mode and no regional selection.
   - Whether TCP/TLS (`turns:` on port 443) URLs are present depends on Cloudflare's response. Unverified.
10. **Capture and media.** Settings:

    | Track | Settings |
    |---|---|
    | Voice | `contentHint` "speech"; Opus `maxaveragebitrate` 64000 with FEC; priority "high" |
    | Camera | 960×540 @ 24, ≤700 kbps |
    | Screen | 15 fps (max 30); `contentHint` "detail"; ≤1.8 Mbps |

    Caps are applied only on the first "connected" (KIASA-015).
11. **Degradation and reconnection.**
    - Only the browser's own congestion control adapts the stream.
    - `restartIce` runs only on "failed".
    - Peers are torn down when they leave presence.
    - The channel is not re-joined after it closes (KIASA-007).
12. **Pause and resume.** There are per-device toggles for mic, camera and screen. There is no session-level pause. Each toggle is a paced presence update (4 per 31 s), so others can see a change up to ~30 s late.
13. **Termination.**
    - The host's End sets `ended_at` and broadcasts `ended`. Receivers confirm it against the database.
    - **Non-host clients keep their tracks and peer connections** (KIASA-006).
14. **Cleanup and audit.**
    - The recorder stops.
    - TURN credentials are not revoked; they expire after 4 h.
    - **No audit record is written.**

**Live sounds** (web and Sound Desk):
1. The member clicks.
2. `getDisplayMedia` runs; on Sound Desk, the WASAPI loopback starts.
3. The `sound_shares` row is upserted every 15 s.
4. The admin joins the channel. Allowed while the row is less than 90 s old.
5. The admin sends `listen`, the member offers, the admin answers.
6. Stop: all tracks stop, peers close, the channel is removed and the row is deleted.
   - Web: done correctly (`components/sound/sound-share.tsx:58-71`).
   - Sound Desk: deleting the row is racy (KIASA-018).

**Live script:**
1. The member turns it on.
2. The page opens `kiasa-live://` and connects to `127.0.0.1:8765`.
3. A `live_sessions` row is created.
4. Text is broadcast on `live-script:<id>`.
5. An admin reads it on `/admin/live` or in the Admin Live Desk.
6. Turning it off deletes the row. A closed tab drops off after about 90 s.

### 3.4 Principal gaps against the PRD baseline

1. No assistance queue, assignment or reassignment, or session state machine.
2. No desktop screen-capture client. Screen sharing exists only in browser meetings.
3. No adaptive or audio-first media, no screenshot fallback, and diagnostics without RTT, loss or jitter.
4. No durable consent or audit history.
5. No signed installation; partly signed updates (the Go browser only).
6. No mock interviews or coding practice.
7. Present but outside the baseline, with high compliance risk: automated application submission, third-party audio and transcript relay, and a staff-to-member live text window.

---

## 4. Feature matrix

"Status" is what the code implements. "Verification" is what was actually proven. Phases follow the audit request because no PRD was supplied.

| ID | Requirement (baseline) | Phase | Status | Implementation evidence | Verification | Gap |
|---|---|---|---|---|---|---|
| B-01 | Windows desktop client, authenticated with the platform account | Current | Partial | Sound Desk, User Live Desk and Admin Live Desk sign in via `/say/sign-in` and `/desk/sign-in`; refresh token sealed with DPAPI | Built in this audit (§6); not run | No desktop **screen** client; three diverging auth and Realtime copies |
| B-02 | Authorized manager assignment and assistance queue | Current | **Missing** | Closest: meetings organized by admins and top managers (`lib/meetings/actions.ts:24-35`) | — | No queue, request, assignment, reassignment or SLA |
| B-03 | Browser-based viewer for the manager | Current | Partial | `/meet/[id]` (screen tiles), `/admin/sounds`, `/admin/live` | Not run | No zoom or readability tools found; mesh only |
| B-04 | User approval before screen capture | Current | Partial | Browser picker, started by the user's click | Not run | Rejoin re-sends the screen without a click (KIASA-006) |
| B-05 | User approval before microphone capture | Current | Implemented | `getUserMedia` browser prompt | Not run | Acquired as the page opens, even for ended meetings (KIASA-046) |
| B-06 | Optional system-audio approval | Current | Partial | Share-audio option in `getDisplayMedia`; Sound Desk on click | Not run | Sound Desk auto-resume flag (KIASA-009) |
| B-07 | Visible sharing status | Current | Partial | Amber notices (`live-capture.tsx:284-290`, sound share) | Not run | Sound Desk shows only a tooltip; recording notice is late (KIASA-009, -014) |
| B-08 | Immediate pause and stop | Current | Partial | Stop works for sound sharing and the live script | Not run | Meeting end and leave do not stop capture; no session-level pause (KIASA-006) |
| B-09 | WebRTC media and signaling | Current | Implemented | `use-meeting.ts`, `sound-link.ts`, `SoundSender.cs` | Project e2e scripts exist; **not run here** (Docker unavailable) | No recovery path (KIASA-007) |
| B-10 | ICE with STUN/TURN fallback | Current | Implemented | `lib/meetings/server.ts:14-41` | Unverified | Credentials not refreshed; `/say/ice` too broad (KIASA-007, -012) |
| B-11 | UDP/TCP/TLS relay fallback; relay-only testing | Current | Unknown | Uses Cloudflare's list as returned | Unverified | No `iceTransportPolicy` test switch |
| B-12 | Adaptive streaming | Current | **Missing** | Static caps only | — | KIASA-015 |
| B-13 | Audio-first degradation | Current | Partial | Voice priority "high" (set once) | — | Video never shed (KIASA-015) |
| B-14 | Readable screen content | Current | Partial | `contentHint` "detail", 15 fps, 1.8 Mbps | Unverified | Cap missing mid-call; no screenshot fallback |
| B-15 | Reconnection | Current | Partial | Strong in `live-link.ts`, good in `sound-link.ts`, weak in meetings | Not run | KIASA-007 |
| B-16 | Useful network diagnostics | Current | Partial | Tile Details panel: route, bytes, level, mic | Not run | No RTT, loss, jitter or FPS; relay label shows configuration, not the route used |
| B-17 | Server-side session authorization | Current | Implemented | RLS on 51 tables; Realtime policies | Static review | Self-declared identity in signals (KIASA-013) |
| B-18 | Role separation | Current | Implemented | anon / pending / member / manager / admin / tester; keyed clients | Static review | Admin linking by email (KIASA-020); `setTeam` (KIASA-043) |
| B-19 | Consent and audit history | Current | **Missing** | Only the latest `decided_by` / `changed_by` is kept | — | KIASA-008 |
| B-20 | Protected credentials | Current | Partial | DPAPI; hashed keys; nothing in git | History scan clean | Plaintext release and model-server keys; JavaScript-readable session cookies (KIASA-023, -025, -031) |
| B-21 | Signed installation | Current | **Missing** | No `signtool` in any build script | — | KIASA-010 |
| B-22 | Signed updates | Current | Partial | Go browser: ed25519 manifest plus SHA-256 | Go tests pass | Rollback replay (KIASA-025); Sound Desk unauthenticated (KIASA-010); other apps update by hand |
| B-23 | Résumé management (import, export, versions, review of AI edits) | Current, if implemented | Partial | Import prompt; base and per-job tailored résumés; PDF; facts restored | Not run | No versions; saved without approval; job titles only warned (KIASA-034) |
| B-24 | Job discovery and ingestion; eligibility distinctions | Current, if implemented | Partial | `jobs` table, bot keys, SSRF-safe page reader | Not run | Eligibility handled only by routing legal topics in auto-apply |
| B-25 | Mock interviews (history, privacy) | Current, if implemented | **Missing** | `/interview` is live transcription of whatever the PC plays, not a mock-interview feature | — | See KIASA-005 |
| B-26 | Coding practice | Unknown | Missing | None found | — | Needs PRD |
| B-27 | Notifications | Current | Implemented | Web push (VAPID, `lib/accounts/push.ts`), chat alerts, notify window | Not run | — |
| B-28 | Support context sharing | Current | Partial | Chat with files; meeting chat | Not run | — |
| L-01 | Remote control | Later | Deferred (absent) | Admin Live Desk types only into the **admin's own** foreground app (`Win/Typer.cs`) | — | Correctly absent |
| L-02 | Recording | Later | Implemented early | Admin-only, to the admin's disk (`components/meet/recorder.ts`) | Not run | Consent and notice gaps (KIASA-014) |
| L-03 | macOS | Later | Deferred | Windows-only apps | — | — |
| L-04 | Multiple viewers per session | Later | Partial | Mesh meetings; an admin hears one sound share at a time | — | — |
| L-05 | VPN | Later | Not needed / absent | Nothing in the core depends on a VPN | — | KIASA Browser uses proxies for another purpose (KIASA-004) |

**Features outside the baseline:**

| Feature | Status | Notes |
|---|---|---|
| Chat | Implemented | — |
| Teams and top managers | Implemented | — |
| Simulated members | Implemented | KIASA-033 |
| Jobs desk, plans, leaderboard | Implemented | Pay visible to all members (KIASA-032) |
| Auto-apply agent and model server | Implemented; shipped in browser 1.4.x | KIASA-001…004, -026…-031 |
| Live script | Implemented | KIASA-005, -016 |
| Live sounds / Sound Desk | Implemented | KIASA-005, -009, -017, -018 |
| Live Desk notify and presence | Implemented, partly uncommitted | KIASA-024, -038 |

---

## 5. Findings

Each finding has a stable ID. The P1 and P2 findings use the full template. The P3 findings are condensed.

### P1

#### KIASA-001 — Auto-apply can submit applications that no member has reviewed, and admins can switch it on for any member

- **Category:** consent / compliance. **Priority:** P1 (P0 if any member is in `apply` mode). **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - `agent browser`: `agentic browser/internal/agent/agent.go:340-343`. When `outcome == "filled" && work.Mode == "apply"`, it calls `l.submit(...)`. There is no approval step for each job.
  - `apps/web/supabase/migrations/20261104090000_auto_apply.sql:34` reads "A member sets their own; an admin can set anyone's". Lines `:59-65` are the insert and update policies, which allow `jobs_admin()` with any `mode`.
  - `:177` re-takes jobs that are already filled, so a form the member may have looked at is filled again with fresh model output.
  - `apps/web/src/components/apply/apply-work.tsx:170-178`: the UI offers Stop and "Fill forms, don't send" ("It does not press submit"), but its status label shows "Applying".
  - The comments in `agent.go:5-6` and `greenhouse/greenhouse.go:2-4` still say nothing presses submit.
- **Failure scenario:** an admin, or a member through direct REST, upserts `apply_control.mode = 'apply'`. The member's KIASA Browser then submits up to 100 applications a day in the member's name, with answers the member never saw.
- **Impact:**
  - Applications are sent under a person's name without their informed approval.
  - This creates exposure to misrepresentation claims and employer bans.
  - Trust is lost.
- **Root cause:** the switch is modelled as a mode, not as per-application consent, and the policy is wider than the UI.
- **Targeted fix:**
  1. Restrict the admin branch of the policies to `with check (mode in ('off','fill'))`. Only the member may set `apply`, through an explicit opt-in that records who, when and which version of the disclosure they saw. Keep a history table.
  2. Add an `apply_reviews` record per job: the member sees the exact answers, approves them, and the record stores a hash of the answer set. The agent refuses to submit unless the hash of what it typed matches.
  3. Correct the comments and the UI copy.
- **Modules:** `20261104090000_auto_apply.sql`, `internal/agent/{agent.go,submit.go}`, `components/apply/apply-work.tsx`.
- **Acceptance criteria:**
  - An RLS test shows an admin upsert of `mode='apply'` for another user is rejected.
  - An agent test shows that without a matching approved-answers record, no submit is pressed.
  - The UI copy and status match the mode.

#### KIASA-002 — Model-written answers are submitted as written, with accuracy statements ticked for the member

- **Category:** compliance / data integrity. **Priority:** P1. **Confidence:** High on the code. The fabrication rate is from the owner's notes, not measured here. **Type:** Compliance risk.
- **Evidence:**
  - `agentic browser/internal/modelserver/model.go:240-277` puts free text in as written. It only filters blanks and the "need clarification" marker.
  - `MASTER_PROMPT.md` forbids inventing details, but no code checks answers against the résumé.
  - `internal/modelserver/rules.go:157-167`: when `AgreeForMe` is "yes", every required statement or checkbox is ticked. The setting's own copy (`apps/web/src/components/apply/apply-details.tsx:221-226`) names "confirming your application is your own work".
  - Résumé tailoring may change job titles and only warns: `apps/web/src/lib/resume/apply-init.ts:62-64` ("Restore the real title if a background check would verify it").
  - Tailored résumés are saved without an approval step: `lib/resume/actions.ts:150-168`. They are then used by the agent.
- **Failure scenario:** the model adds a qualification the member does not have, and it is sent with a ticked "all information is accurate" statement.
- **Impact:** false statements to employers in the member's name. This is legal exposure for both the members and KIASA.
- **Root cause:** there is no human-in-the-loop for generated content, and attestations are treated as form plumbing.
- **Targeted fix:**
  - Mark each answer `source = rule | saved | model`.
  - Require member approval of every `model` answer (fold this into KIASA-001's review).
  - Never tick an attestation while unreviewed model text is present.
  - In résumé tailoring, restore job titles like the other facts, or require explicit approval of each title change.
- **Modules:** `internal/modelserver`, `internal/agent`, `lib/resume/apply-init.ts`, `lib/resume/actions.ts`.
- **Acceptance criteria:**
  - A form containing an unapproved model answer is never submitted.
  - Attestation boxes stay unticked unless every free-text answer is approved.
  - A title change is either restored or approved.

#### KIASA-003 — The agent completes "confirm you're a human" emailed-code checks

- **Category:** compliance. **Priority:** P1. **Confidence:** Medium-high. **Type:** Compliance risk.
- **Evidence:**
  - `agentic browser/internal/greenhouse/submit.go:44-51` detects a code step when the page text matches `/verification code|security code|sent to|enter the .*code|confirm you/`.
  - `internal/agent/submit.go:58-66` then reads the code from Gmail, types it and submits again.
  - The project's own fixtures quote the real flow:
    - `greenhouse/testdata/form.html:114`: "Enter the 6-character security code to confirm you're a human".
    - `lever/testdata/apply.html:55`.
  - This contradicts the code's own rule at `internal/modelserver/rules.go:563-566`: an automated agent "cannot truthfully say so, in the same way it does not get past a CAPTCHA".
- **Failure scenario:** the site's anti-automation step is completed by automation.
- **Impact:** breach of site terms; possible account bans for members; reputational and legal risk.
- **Root cause:** the code step is treated as an ordinary email verification.
- **Targeted fix:** when the code step's wording asks to prove a human is present, end the job as `waiting`, and hand the code entry to the member in person.
- **Modules:** `internal/greenhouse/submit.go`, `internal/ats/submit.go`, `internal/agent/submit.go`.
- **Acceptance criteria:** with the fixtures above, the job ends `waiting` and no code is typed.

#### KIASA-004 — Automation and network origin are masked on third-party sites

- **Category:** compliance / terms of service. **Priority:** P1 (decision needed). **Confidence:** High on the facts; the ATS terms were not reviewed. **Type:** Compliance risk.
- **Evidence:**
  - `agentic browser/browser/runner.go:141-145` launches with `--disable-blink-features=AutomationControlled` and `--disable-infobars`.
  - `browser/stealth.go:62-173` removes automation switches and rewrites "HeadlessChrome" in headless mode.
  - `main.go:219-231` and `proxy/geo.go` set the browser's time zone to match the proxy's exit location.
  - `internal/settings/settings.go:163-169` accepts the proxy formats of commercial proxy sellers.
  - `browser/gmail.go:67-69` routes Gmail calls through the same tab "so Google sees one address".
  - Fingerprint test pages are referenced in `internal/brand/brand.go:18-20` and `main.go:484`.
  - `browser/human.go` (mouse and typing that imitate a person) is not called outside tests.
  - CAPTCHAs are not solved; they end as "skipped" (`internal/ats/submit.go:31-35`).
- **Failure scenario:** automated submissions designed not to be recognized as automated.
- **Impact:** breach of terms of service on the ATS platforms; risk to member accounts; legal exposure.
- **Root cause:** a design goal of not being detected.
- **Targeted fix:** obtain a legal and terms-of-service review per platform before any automated submission. This audit does not recommend ways to improve evasion. The options are:
  - remove the masking measures, and identify automated submissions openly; or
  - obtain the platforms' permission or use their official APIs where offered.
  - In either case, record the purpose of each proxy setting.
- **Modules:** `agentic browser/browser`, `proxy`, `main.go`, `internal/settings`.
- **Acceptance criteria:** a written legal decision is on file, and the masking flags are removed or individually justified in it.

#### KIASA-005 — Third-party audio is captured and relayed to staff in real time, alongside a staff-to-member text window

- **Category:** consent / privacy / compliance. **Priority:** P1 (P0 if used in real third-party interviews). **Confidence:** High on the facts. **Type:** Compliance risk.
- **Evidence:**
  - **Capture of everything the PC plays,** including the far side of calls:
    - `apps/live-script/live_script.py` (loopback capture);
    - `apps/sound-desk/Audio/Loopback.cs:35` (WASAPI loopback of the default render device).
  - **Relay to admins:**
    - `apps/web/src/components/interview/live-link.ts` (text);
    - `components/sound/sound-link.ts` and `apps/sound-desk/Net/SoundSender.cs` (audio).
  - **Staff-to-member text:**
    - `notify:<uid>` (`20261105200000_notify_to_user.sql`);
    - the Admin Live Desk `NotifyPanel` (`apps/admin live-desk/MainWindow.xaml:230-238`);
    - the User Live Desk window, which is `Topmost="True" AllowsTransparency="True"` with an opacity control (`apps/user live-desk/MainWindow.xaml:6`).
  - **What the member is told:** the on-page text "Use it on a call only if everyone on the call has agreed" (`components/interview/interview-app.tsx:101`).
  - **What the code does not do:** nothing records the other parties' consent or notifies them. Nothing limits the feature to mock interviews.
  - **Incorrect privacy claims:**
    - `apps/live-script/live_server.py:7` and `README.md:11` say "Audio and text stay on this PC".
    - The sign-up disclosure (`components/site/blocks/forms.tsx:119`) mentions chats and meetings only, not listening to sound or reading live scripts.
- **Failure scenario:** a member runs this during a real interview. The interviewer's voice is transcribed and streamed to KIASA staff without the interviewer's knowledge, and staff can type text that appears on top of the member's screen.
- **Impact:**
  - Possible breach of laws that require all parties to consent to recording or interception.
  - Possible breach of employers' interview-integrity rules.
  - Significant reputational risk.
- **Root cause:** consent is modelled for the member only; the feature has no product boundary (mock versus real).
- **Targeted fix:**
  1. Obtain legal review for the jurisdictions of members and interviewers. Decide what is allowed in writing.
  2. If kept, scope it to sessions where all parties consent. Examples: KIASA mock interviews with staff, or a consent attestation recorded for each session before capture starts, with the counterpart named.
  3. Correct `live_server.py`, the README and the sign-up disclosure.
  4. Record each session in the audit log (KIASA-008).
- **Modules:** `apps/live-script`, `apps/sound-desk`, `components/interview`, `components/sound`, both Live Desks, the notify migration.
- **Acceptance criteria:**
  - A documented legal position exists.
  - Capture cannot start without a recorded per-session consent.
  - The documentation matches the data flow.

#### KIASA-006 — Ending or leaving a meeting does not release capture, and Rejoin re-sends the screen without a click

- **Category:** consent / capture control. **Priority:** P1. **Confidence:** High (code); runtime not reproduced. **Type:** Verified defect.
- **Evidence:**
  - `apps/web/src/components/meet/meeting-room.tsx:144`: `const joined = letIn && (joinedHere || asked)` ignores `over`.
  - `:196-198`: only the recorder stops when the meeting is over.
  - `:244`: `leave()` only changes state.
  - `use-meeting.ts:314-324`: peer connections close only when `joined` turns false.
  - `use-meeting.ts:350-356`: camera, mic and screen tracks stop only when the component unmounts.
  - `use-meeting.ts:145-146`: `connect()` re-adds `screenRef` on rejoin.
- **Failure scenario:**
  - An admin presses "End for everyone". Every other participant's page shows "This meeting has ended", but it keeps capturing mic, camera and any shared screen, and keeps sending to the others.
  - After "Leave", the capture indicators stay on. "Rejoin" streams the screen again without a new choice.
- **Impact:** capture continues after the person was told it stopped. This is a direct consent failure.
- **Root cause:** stopping capture is tied to unmounting the component, not to the session state.
- **Targeted fix:**
  - Use `joined = letIn && !over && (joinedHere || asked)`.
  - On `over` or `left`, stop every local track and call `stopScreen()`.
  - On Rejoin, ask for devices again and never re-attach an old screen track.
  - Move capture start out of page open and into the lobby, only when the meeting is not `over`.
- **Modules:** `components/meet/meeting-room.tsx`, `components/meet/use-meeting.ts`.
- **Acceptance criteria:**
  - Within 2 s of End or Leave, every other tab has all peer connections `closed`, `getTracks().every(t => t.readyState === 'ended')`, and the camera light is off.
  - Rejoin does not share the screen until it is chosen again.
  - A Playwright test covers both.

#### KIASA-007 — Meeting signaling has no recovery path on unreliable networks

- **Category:** reliability (core requirement). **Priority:** P1. **Confidence:** Medium. The code paths are verified; how often they trigger needs a runtime test. **Type:** Verified defect plus plausible risk.
- **Evidence (paths in `apps/web/src/components/meet/use-meeting.ts`):**
  - **The retry loop never retries.** `:110-118` retries up to 30 times on a "rate limited" reply, but channels are created without `broadcast.ack`, so `send()` resolves "ok" as soon as the message is queued on the socket. If `channel.current` is null, the message is dropped.
  - **No rejoin after the channel closes.** `:284` only sets "paused" on close; `:291` re-creates the channel only when its dependencies change. Comments at `:57-60` admit that a presence-limit close leaves the page "cut off".
  - **Presence blips tear down media.** `:251` disconnects any peer that is missing from presence, even while its media is flowing.
  - **Minimal ICE recovery.** `:183` calls `restartIce` only on "failed". The "disconnected" state and the `online` event are not handled.
  - **TURN credentials go stale.** `apps/web/src/lib/meetings/server.ts:20` requests a 4-hour TTL once per page load. They are reused for every later connection and restart.
  - **No re-offer timer.** A pair stuck in `new` or `have-local-offer` is shown without a "Connecting…" label (`meeting-room.tsx:557`).
- **Failure scenario:**
  - A lost offer or answer leaves a pair silent forever.
  - A Realtime channel close (presence limit, expired token or server close) leaves the room unable to signal until reload.
  - A 2 s socket drop interrupts media for everyone.
  - Meetings longer than 4 h, or lobbies left open that long, cannot use the relay.
- **Impact:** the central "works over unreliable international networks" requirement is not met for meetings.
- **Root cause:** recovery relies on presence events and the browser's own timers. There is no delivery confirmation and no per-link supervision.
- **Targeted fix:**
  1. Use `broadcast: { ack: true }`, or end-to-end acknowledgement of each signal with retry.
  2. On `CLOSED`, `CHANNEL_ERROR` or `TIMED_OUT`: remove the channel and re-subscribe with jittered backoff, then re-track presence. The `SoundChannel.keepUp` pattern in `sound-link.ts` already does this.
  3. Per link: if not "connected" within 10 s, the impolite side re-offers with `iceRestart`.
  4. Give a peer 20 s of grace after it leaves presence while `connectionState === 'connected'`.
  5. On "disconnected" lasting more than 3 s, or on the window `online` event, `restartIce` from the impolite side.
  6. Add a `meetingIce(meetingId)` server action that refreshes credentials at about 75% of the TTL, then call `pc.setConfiguration()`.
- **Modules:** `use-meeting.ts`, `meeting-room.tsx`, `lib/meetings/server.ts`, a new action in `lib/meetings/actions.ts`.
- **Acceptance criteria** (scenarios from §7.3):
  - With 20% of signal messages dropped by a test hook, every pair connects within 30 s.
  - A forced channel close recovers presence and signaling within 15 s without a reload.
  - A 5 s socket outage causes no media gap.
  - With TTL set to 10 min in a test, a peer joining at minute 15 connects through the relay.

#### KIASA-008 — Staff observation and decisions leave no durable record

- **Category:** consent / audit. **Priority:** P1 (baseline requirement B-19). **Confidence:** High. **Type:** Verified absence.
- **Evidence:**
  - **Unseen reading:** admins read all chats unseen through `admin_reads()` and `all_chats` (`20261027210000_team_chats.sql:129-133`).
  - **Listening and reading:** admins read live scripts (`live_script_allowed`, `20261101130000_live_sessions.sql:52-69`) and listen to sound (`sound_allowed`, `20261105120000_sound_shares.sql:49-67`).
  - **Overwritten fields:** `meeting_admissions.decided_by`, profile decisions, device approvals and `apply_control.changed_by` keep only their latest value.
  - **No audit table** exists in any migration.
- **Failure scenario:** a member asks who listened to their computer's sound last week. There is no answer.
- **Impact:** consent cannot be shown, staff misuse cannot be investigated, and privacy obligations cannot be met.
- **Root cause:** not designed.
- **Targeted fix:**
  - Create an append-only `audit_events (id, at, actor, action, subject_user, object_type, object_id, detail jsonb)` table, with insert only through `SECURITY DEFINER` functions and no update or delete grants.
  - Write to it from:
    - admission decisions;
    - starting and stopping a listen or read (a `log_observation(topic)` RPC called before the channel is joined);
    - recording start and stop;
    - `apply_control` changes;
    - device approvals.
  - Show a member their own history.
- **Modules:** a new migration; `lib/meetings/actions.ts`, `components/sound/*`, `components/interview/live-now.tsx`, the Admin Live Desk; account and device actions.
- **Acceptance criteria:** each listed action adds exactly one row; admins cannot update or delete rows (RLS test); a member can see their own events.

#### KIASA-009 — Sound Desk: only a tooltip shows that sharing is on, and sharing can resume without the member acting

- **Category:** consent. **Priority:** P1. **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - `apps/sound-desk/App.xaml.cs:37-41` sets the tray icon once. `:132-140` changes only the tooltip text. A double-click toggles sharing without confirmation (`:45`).
  - The `Connected` and `Disconnected` events (`Net/SoundSender.cs:32-33`) are never subscribed, so a listening admin is never shown.
  - `Net/Updater.cs:111` writes a "was sharing" flag before an update. `:137-142` honours it at any later start, with no expiry. `App.xaml.cs:25,100` then calls `StartSharing()` without any action from the member.
- **Failure scenario:** an update restart does not happen. Days later, at Windows logon ("Start with Windows"), the app starts streaming all computer audio. The only sign is a tooltip on an icon that Windows 11 may have hidden in the overflow area.
- **Impact:** audio is streamed without a current decision by the member and without a visible indicator.
- **Root cause:** sharing state persists beyond the member's decision; there is no indicator design.
- **Targeted fix:**
  - Use a distinct "live" tray icon while sharing.
  - Show a toast on start, on stop and when each admin connects. Show the listener count in the tooltip and menu.
  - Ask for confirmation on a double-click start.
  - Make the flag carry a nonce and timestamp. Honour it only within 2 minutes and only when launched by the update script with a matching argument. Say "Sharing resumed after update".
- **Modules:** `apps/sound-desk/App.xaml.cs`, `Net/Updater.cs`, `Net/SoundSender.cs`.
- **Acceptance criteria:**
  - A normal launch, or a flag older than 2 minutes, never starts sharing.
  - The icon differs while sharing.
  - Toasts fire on start and on each connection.

#### KIASA-010 — No Windows binary is code-signed, and the Sound Desk updater would run any downloaded `.exe`

- **Category:** supply chain / release. **Priority:** P1 for a production release. The updater is dormant until the server returns a URL. **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - `apps/sound-desk/Net/Updater.cs:75-90` calls `GetAsync(url)` with no check of scheme or host. Its only validation is the `MZ` header.
  - `:115-128` then copies the file over the running exe with a hidden `cmd` script and starts it. The version is an unsigned JSON string.
  - `apps/web/src/app/say/sound-desk/version/route.ts:4-5` currently returns `url: ""`.
  - No `build.ps1` in any app, and no script in `agentic browser/scripts/`, calls `signtool`. PyInstaller output is unsigned.
- **Failure scenario:** anyone who can change the version endpoint's response (a site compromise or a bad deploy) gets silent code execution on every member PC running Sound Desk. Members installing any KIASA app see SmartScreen warnings and cannot check the publisher.
- **Impact:** a supply-chain compromise path, and a weak install experience.
- **Root cause:** the updater was built without the Go browser's signed-manifest design; there is no signing certificate or pipeline.
- **Targeted fix:**
  - Port `agentic browser/internal/update` to .NET: an ed25519-signed manifest `{version, url, sha256, size, issued_at, expires_at, min_version}` with an embedded public key, HTTPS on one pinned host, and the hash checked before the swap.
  - Obtain a code-signing certificate. Sign every exe and installer in the build scripts. Check `WinVerifyTrust` and the expected signer before an update is applied.
  - Do not set a URL in `say/sound-desk/version` before this is done.
- **Modules:** `apps/sound-desk/Net/Updater.cs`, all `build.ps1`, `agentic browser/scripts/build-installer.ps1`, `apps/live-script/build.ps1`.
- **Acceptance criteria:**
  - A tampered, unsigned, downgraded or HTTP-served update is refused and logged.
  - `Get-AuthenticodeSignature` reports `Valid` with the expected signer on every release artifact.

#### KIASA-011 — Deleting an account leaves résumé files and chat files in storage

- **Category:** privacy / data retention. **Priority:** P1. **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - `apps/web/src/lib/accounts/actions.ts:166-170` (`forgetPhotos`) empties only the `avatars` bucket. It is called at `:281` and `:360` by account deletion and removal.
  - Nothing removes `resumes/<uid>/*` objects. They are removed only one at a time, by hand, in `components/jobs/jobs-resumes.tsx:136`.
  - Deleting a chat message nulls its `attachment` but leaves the `chat-files` object.
  - The product copy promises the details "are deleted at once" (`src/content/docs/account.ts:97`).
- **Failure scenario:** after a deletion request, the person's résumés (with contact details and work history) remain in storage indefinitely.
- **Impact:** a broken privacy promise; legal exposure under data-protection law.
- **Root cause:** deletion handles the database rows and avatars only.
- **Targeted fix:**
  - In both deletion paths, list and remove `resumes/<uid>/*`, and remove chat files whose message sender is the user.
  - Add a scheduled sweep for storage objects that no row references.
  - Include `tailored_resumes`, `apply_details` and transcripts in the deletion checklist.
- **Modules:** `lib/accounts/actions.ts`, a new cron migration.
- **Acceptance criteria:** after deletion, no objects remain under `resumes/<uid>` and no chat files remain unreferenced (an e2e test against local Supabase).

### P2

#### KIASA-012 — `/say/ice` gives TURN credentials to any signed-in account, including unapproved self-registered ones

- **Category:** abuse / cost. **Priority:** P2. **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - `apps/web/src/app/say/ice/route.ts:11-14` checks only `auth.getUser(token)`, then returns `iceServers()`. That is a fresh 4-hour Cloudflare credential per call, or the static `MEETING_TURN_*` credential (`lib/meetings/server.ts:39`).
  - Anyone can create an account. `requestAccount` calls `createUser({… email_confirm: true})` (`lib/accounts/actions.ts:56`), limited to 5 per hour per address, and that account can sign in at once.
  - By contrast, `soundIce` requires an approved member or an admin (`lib/sound/actions.ts:8-13`).
- **Scenario:** a stranger signs up and loops on `/say/ice`, using KIASA's relay as a free relay.
- **Impact:**
  - Relay quota and cost.
  - If the quota is exhausted, real calls lose their relay, which is the part international users need most.
- **Root cause:** the route was written for native apps and checks only authentication.
- **Targeted fix:**
  - Require an admin, or `profiles.status = 'approved'`, as in `soundIce`.
  - Rate-limit per user with `tooMany`/`noteAttempt`.
  - Stop handing out static TURN credentials; use ephemeral ones only.
- **Modules:** `app/say/ice/route.ts`, `lib/meetings/server.ts`.
- **Acceptance criteria:** a pending account gets 403; more than N calls per hour gets 429.

#### KIASA-013 — Meeting participants declare their own identity in signals and presence

- **Category:** access control. **Priority:** P2. **Confidence:** High on the code; medium on the impact. **Type:** Verified defect.
- **Evidence:**
  - `use-meeting.ts:113,296` writes `user`, `name`, `recording` and `from` on the client. Receivers trust `entry.user` and `signal.user` (`:243,254`). Realtime broadcast does not attach the sender's identity.
  - Permissions are checked only at join, so a person removed from a meeting keeps send rights on a channel they have already joined.
  - The read policy is `meeting_member()`, so waiting or refused invitees can read all SDPs (participants' IP addresses) and presence.
  - Policies ignore `ended_at` (`20261029150000_meeting_people.sql:35-42`).
- **Scenario:** an admitted participant sends an offer with another participant's `from`. This takes over that participant's slot in a victim's browser, or appears under an admin's id, or hides the `recording` flag.
- **Impact:** impersonation and misdirected media inside a meeting; removal is not enforced.
- **Root cause:** the identity in Realtime payloads is not bound to the authenticated user.
- **Targeted fix:**
  - Issue a server-signed token `{meeting, user, peerId, exp}` per tab.
  - Carry it in presence and in each signal (or an HMAC over the signal with a per-meeting key), and drop anything that does not verify.
  - Show names from `start.people` keyed by the verified user.
  - Pin the DTLS fingerprint per peerId.
  - On removal, rotate the topic (or end and re-create the session).
  - Restrict reads to `in_meeting()` and add `ended_at is null` to the policies.
- **Modules:** `use-meeting.ts`, `lib/meetings/*`, the meeting policies.
- **Acceptance criteria:** forged presence or signals are ignored, and a removed user cannot reconnect (test).

#### KIASA-014 — Recording notice is late and self-declared, and the recording file can be lost

- **Category:** consent / data loss. **Priority:** P2. **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - Recording is admin-only (`meeting-room.tsx:452`).
  - Others learn about it only through the self-declared presence flag, which is paced at 4 calls per 31 s (`use-meeting.ts:301-306`). The lobby shows no recording state.
  - Yet the toast tells the admin "Everyone in the meeting sees that it is being recorded" (`meeting-room.tsx:240`).
  - `recorder.ts:36,151` writes through `createWritable()` and calls `close()` only on stop (`:174`); the swap file is committed only on close. There is no `pagehide` handling and no `onerror`.
  - The non-Chromium fallback keeps the whole recording in memory (`:150,175-181`).
- **Scenario:**
  - Participants are recorded for about 30 s before they see any notice, and people joining are never told before they join.
  - A tab crash an hour into a recording loses the whole file.
- **Impact:** a consent gap, and lost recordings.
- **Root cause:** recording state is not stored in the database; the File System Access swap-file semantics were missed.
- **Targeted fix:**
  - Add `meetings.recording_by` and `recording_since`, written by a server action and delivered through `postgres_changes`. Show the state in the lobby and the room within 2 s.
  - Commit periodically: close, then reopen with `createWritable({keepExistingData:true})` and seek.
  - Add a `beforeunload` warning and handle `onerror`.
- **Modules:** `meeting-room.tsx`, `recorder.ts`, the meetings migration and actions.
- **Acceptance criteria:**
  - Every participant and lobby shows "X is recording" within 2 s.
  - Killing the tab at minute 10 leaves at least 9 playable minutes.

#### KIASA-015 — No adaptive media; caps are applied inconsistently; diagnostics are thin

- **Category:** performance / readability. **Priority:** P2. **Confidence:** High. **Type:** Verified gap.
- **Evidence:**
  - `limit()` runs only on the first transition to "connected" (`use-meeting.ts:182`). Senders added later have no cap and no voice priority:
    - a screen share started mid-call (`:485-495`);
    - a camera or mic added later (`:402,430,456`).
  - There is no `degradationPreference`, `scaleResolutionDownBy`, DTX or RED, and no loop reading `availableOutgoingBitrate` or `qualityLimitationReason`.
  - `getStats` is used only by the Details panel. It shows the route, bytes and level, but no RTT, loss, jitter or FPS. "relay on/off" shows the configuration, not the selected candidate pair (`meeting-room.tsx:557`).
  - There is no screenshot fallback.
- **Scenario:**
  - A screen share started mid-call in a mesh of 4 pushes up to three uncapped streams from the sharer's uplink.
  - On a 256 kbps uplink, video is never shed, so audio suffers.
- **Impact:** poor readability and audio continuity on constrained links, which is the PRD's core scenario.
- **Root cause:** only static configuration, set once.
- **Targeted fix:**
  1. Call `limit()` after every `addTrack`/`replaceTrack` and on each `signalingstatechange` to `stable`.
  2. Add a 2 s stats loop per link. Under low bandwidth (`availableOutgoingBitrate` below a threshold for 5 s) or high loss, step down in this order: camera → screen frame rate (5 fps) → pause camera. Keep the screen's resolution for readability. Step up again only after 15 s healthy (hysteresis).
  3. Set `degradationPreference: 'maintain-resolution'` for the screen and `'balanced'` for the camera.
  4. Show RTT, loss, jitter, FPS, bitrate and the actual candidate-pair type in Details.
  5. Add a screenshot fallback: periodic JPEG frames on a data channel when video cannot hold 1 fps.
- **Modules:** `use-meeting.ts`, `rtc.ts`, `meeting-room.tsx`.
- **Acceptance criteria:**
  - `getParameters()` shows caps on every sender in any join or share order.
  - Under scenario N3 (§7.3), audio concealment stays under 5% and 12-px text stays readable within 5 s of a static screen. These targets are proposals.

#### KIASA-016 — The live script restarts after a reload, or in a duplicated tab, without a click

- **Category:** consent. **Priority:** P2. **Confidence:** High. **Type:** Verified behaviour.
- **Evidence:**
  - `apps/web/src/components/interview/live-capture.tsx:262-270` calls `turnOn()` on mount when sessionStorage says it was on. sessionStorage is copied into a duplicated tab.
  - `:195-202` can set `window.location.href = APP_LINK` without a user gesture.
  - The amber bar does reappear.
- **Scenario:** a reload days into a session (or a duplicated tab) starts streaming to admins again.
- **Root cause:** a convenience resume.
- **Fix:**
  - On mount, only re-attach if the local app is *already* capturing.
  - Otherwise show a "Resume live script?" button.
  - Never launch the protocol link without a gesture.
- **Modules:** `live-capture.tsx`.
- **Acceptance criteria:** a reload with the app idle does not start capture until the member clicks.

#### KIASA-017 — Sound sharing can lose ICE candidates and leak peer connections (web and Sound Desk)

- **Category:** reliability. **Priority:** P2. **Confidence:** Medium (web: verified ordering; native: depends on SIPSorcery). **Type:** Verified defect / unverified at runtime.
- **Evidence:**
  - Web: `components/sound/sound-link.ts:155-156,249-250` sets `described` only after `await channel.send(...)`. Candidates gathered during that await are neither in the SDP nor trickled. Unanswered listener connections never fail, so they are never dropped (`:151,159-162`).
  - Native: `apps/sound-desk/Net/SoundSender.cs:162` sends candidates only when `Described` is true, which is set at `:188`, after the offer is sent. A superseded `OfferTo` does not close its connection (`:183`). The peer map is unbounded and keyed by any `from` string.
- **Scenario:** relay TCP/TLS candidates found in that window are lost, so strict networks fail to connect. Abandoned listens hold TURN allocations.
- **Fix:**
  - Set `described` synchronously after taking the local-description snapshot, and queue candidates until then.
  - Drop peers that are not connected within 30 s.
  - Close superseded connections.
  - Cap peers at 8.
- **Modules:** `sound-link.ts`, `SoundSender.cs`.
- **Acceptance criteria:**
  - A relay-only run (§7.3, N6) connects 20 out of 20 times.
  - No connections remain 60 s after an abandoned listen.

#### KIASA-018 — Sound Desk capture, stop and rejoin defects

- **Category:** reliability. **Priority:** P2. **Confidence:** High (code). **Type:** Verified defects.
- **Evidence (paths in `apps/sound-desk/`):**
  - **Stop:** `Net/SoundSender.cs:330-334` fires `DeleteShare()` and then disposes `_http` at once, which cancels the request. A heartbeat upsert already in flight can re-insert the row, so admins see "sharing" for up to 90 s.
  - **Device change:** `Audio/Loopback.cs:35` binds the default device once. `:39` (`RecordingStopped`) only logs. A device switch silently ends capture while the app still says Sharing.
  - **Refused join:** `Net/RealtimeLink.cs:91,116,163` reconnects every ~300 ms after a refused join. The two desk copies have a 30–120 s backoff for this case.
  - **File deletion:** `Net/Updater.cs:146-149` deletes **every** `*.old` file in the exe's folder at each start, including a member's own files if the app runs from Downloads or the Desktop.
- **Fix:**
  - Add an async `StopAsync` that awaits the in-flight upsert, the stopped message and the delete (each with a timeout) before disposing.
  - Register `IMMNotificationClient` (`OnDefaultDeviceChanged`) to restart the loopback; on a `RecordingStopped` error, retry with backoff, then stop and tell the member.
  - Port the refusal backoff.
  - Delete only `KIASA Sound Desk.exe.old`.
- **Acceptance criteria:**
  - The row is gone within 2 s of Stop in 20 out of 20 trials.
  - Audio returns within 2 s of switching devices.
  - A refused join waits at least 30 s.
  - Unrelated `.old` files survive.

#### KIASA-019 — Desktop apps: crash paths, eager sign-out, and three diverging copies of the network code

- **Category:** reliability / maintainability. **Priority:** P2. **Confidence:** Medium-high. **Type:** Verified code paths.
- **Evidence:**
  - **Unguarded token parsing:** `Took()` parses and saves outside any `try` (`apps/sound-desk/Net/Account.cs:117`, `apps/admin live-desk/Net/Account.cs:152`, `apps/user live-desk/Net/Account.cs:134`), and is called from async-void handlers.
  - **No global handlers:** no app registers Dispatcher, AppDomain or TaskScheduler unhandled-exception handlers.
  - **Eager sign-out:** any 4xx on refresh, including 408 and 429, wipes the session.
  - **Stale tokens on long channels:** only the admin's script channels push a fresh `access_token` (`ScriptReader.cs:271-275`); the sound, notify and desk channels do not.
  - **Divergence:** `RealtimeLink.cs` and `Account.cs` are copied three times, and the copies have already diverged (KIASA-018).
- **Scenario:** a truncated refresh response crashes the app; an admin-desk crash mid-paste leaves script text on the clipboard; long-lived channels drop about hourly when their token expires.
- **Fix:**
  - Extract a shared `Kiasa.Desktop.Net` class library: account, Realtime with jittered backoff, token push on every channel, and a `NetworkChange` hook. Reference it from all three apps.
  - Add the three unhandled-exception handlers with logging.
  - Write `account.bin` atomically.
  - End the session only on `invalid_grant` or `refresh_token_not_found`.
- **Acceptance criteria:**
  - An injected bad refresh body and a locked `account.bin` do not end the process.
  - Every channel survives token rotation across 2 h (§7.3).

#### KIASA-020 — Email ownership is never verified, which gives an admin-takeover path

- **Category:** authentication. **Priority:** P2 (treat as P1 before adding any new admin). **Confidence:** Medium. **Type:** Plausible risk.
- **Evidence:**
  - `lib/accounts/actions.ts:56` creates accounts with `email_confirm: true`.
  - The `admin_linked` trigger links a new `admins` row to whichever account already has that email (`20261029180000_security.sql:25-33`).
  - An admin with no approved device gets their first device approved automatically (`lib/accounts/devices.ts:71`, the `"first"` branch).
- **Scenario:** an attacker requests an account with a future admin's email address. The owner later inserts the `admins` row with that email. The attacker becomes an admin, and their device is trusted.
- **Fix:**
  - Stop auto-confirming; require email confirmation.
  - Link admins by explicit `user_id` only, and refuse self-registered accounts.
  - Require an existing admin to approve a new admin's first device, or use an out-of-band code.
- **Acceptance criteria:**
  - Inserting an `admins` row never links a self-registered account.
  - A new account cannot sign in before confirming its email.

#### KIASA-021 — The admin device lock fails open on errors

- **Category:** authentication. **Priority:** P2. **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - `apps/web/src/lib/accounts/server.ts:124-126` treats any query error or missing row as "lock off". This feeds `currentViewer()` and `trustSignIn`. The database side does the opposite: a missing row means on.
  - The access-token hook ends with `exception when others then return event` (`20261029230000_admin_devices.sql:114`), which hands back the unrestricted token.
  - The project's notes record that the lock was found **off in production** on 2026-11-05 because this migration had not been run (see KIASA-035).
- **Fix:**
  - Treat only "table missing" (`42P01`/`PGRST205`) as off, or remove that fallback.
  - On any other error, fail closed.
  - In the hook, demote the role to `anon` on exception.
- **Acceptance criteria:** a unit test where the settings query errors yields `currentViewer() === null` for an admin on an unapproved device.

#### KIASA-022 — No staff MFA, and gaps in session revocation and password-change handling

- **Category:** authentication. **Priority:** P2. **Confidence:** Medium-high (production settings unverified). **Type:** Verified code / unverified configuration.
- **Evidence:**
  - **No MFA:** TOTP is off in `apps/web/supabase/config.toml:307-308`, and there are no AAL checks anywhere.
  - **Local sign-out only:** `signOut` uses `scope: "local"` (`actions.ts:145`). There is no "sign out everywhere".
  - **Password change:**
    - `changePassword` checks the old password with `signInWithPassword` (`:329-334`), which creates a new session and does not revoke others. For an admin, that new session is not in `admin_sessions`, so they are logged out.
    - `secure_password_change` is false in the local config (`config.toml:229`).
    - Supabase's minimum password length is 6 (`:183`), while the site requires 10.
  - **Rate limits:** the site's `attempts` limits cover only its own routes. The publishable key allows direct `/auth/v1/token?grant_type=password` calls. `tooMany` allows the attempt on error (`server.ts:77`) and is off unless `VERCEL=1` or `KIASA_LIMITS=on`.
- **Fix:**
  - Turn on TOTP. Require `aal2` for admins and managers, both in `is_admin()`/RLS and in `currentViewer`.
  - On password change, use a throwaway non-persisting client for the old-password check, then `signOut({scope:'others'})`.
  - Turn on secure password change, set minimum length to 10, and enable CAPTCHA and leaked-password protection in Supabase Auth.
  - Add "sign out all devices".
- **Acceptance criteria:**
  - Admin pages require MFA.
  - A password change revokes other sessions.
  - Direct password grants are throttled per account.

#### KIASA-023 — Inline scripts are allowed, and session tokens are readable by page scripts

- **Category:** web security. **Priority:** P2. **Confidence:** High. **Type:** Verified configuration.
- **Evidence:**
  - `apps/web/next.config.ts:16` sets `script-src 'self' 'unsafe-inline'`, applied in production only (`:60`).
  - The default `@supabase/ssr` cookies are not httpOnly, because the browser client reads them.
- **Scenario:** any XSS steals a session, including an admin's (valid for up to 1 h). No XSS was found (the only `dangerouslySetInnerHTML` is a static bootstrap in `app/layout.tsx:37`), so this is defence in depth.
- **Fix:** issue per-request nonces from `src/proxy.ts`, set a nonce-based CSP with `'strict-dynamic'`, and drop `'unsafe-inline'` for scripts.
- **Acceptance criteria:** the production CSP has no `'unsafe-inline'` in `script-src`, and pages still hydrate (Playwright suite).

#### KIASA-024 — The new `desk` presence channel is spoofable and visible to all members; notify ordering trusts the admin's clock

- **Category:** access control / reliability. **Priority:** P2. Fix before running the untracked migration. **Confidence:** High. **Type:** Verified defect.
- **Evidence:**
  - `apps/web/supabase/migrations/20261105300000_desk_presence.sql` (untracked) lets any approved member read and send any broadcast on the single topic `desk`.
  - `apps/user live-desk/Net/PresenceLink.cs:28` sends client-chosen `{id, name}`, which the admin desk trusts (`MainWindow.xaml.cs:338-343,405-411`).
  - Notify `seq` is the admin's wall-clock time (`MainWindow.xaml.cs:489`), and the user desk keeps one global `_lastSeq` (`Net/NotifyLink.cs:83-102`). A second admin, or a clock running ahead, blocks messages until restart.
  - The last message stays on the member's screen after the admin switches member or closes the app.
- **Fix:**
  - Use per-user topics `desk:<uid>`: insert only when the uid equals `auth.uid()`, and reads only for admins. Alternatively, a heartbeat row under RLS (as with `sound_shares`).
  - Track `seq` per sender session, and clear the member's window on switch and close.
- **Acceptance criteria:**
  - A member cannot appear as someone else, and non-admins cannot read the channel.
  - Two admins' messages are each shown in order.

#### KIASA-025 — KIASA Browser updates: signed rollbacks can be replayed, manifests never expire, and the signing key is a plaintext file

- **Category:** supply chain. **Priority:** P2. **Confidence:** High. **Type:** Plausible risk.
- **Evidence:**
  - `agentic browser/internal/update/update.go:52` signs only version, URL, SHA-256 and the rollback flag.
  - `:144-149`: with `Rollback`, *any* version that differs from the current one is accepted.
  - There is no expiry or minimum version, so anyone controlling `kiasa.tech/browser/latest.json` can replay any old signed rollback, or freeze updates.
  - The private key is a plaintext base64 seed at `%LOCALAPPDATA%\KIASA\release-signing-key.txt` (`tools/signrelease/main.go:28,89`).
- **Strengths:** unsigned code cannot be run; replacing the GitHub file breaks the hash check.
- **Fix:**
  - Add `issued_at`, `expires_at` and `min_version` to the signed fields.
  - Accept a rollback only while it is unexpired and above the floor.
  - Keep the key offline, on hardware or protected by a passphrase.
- **Acceptance criteria:** tests refuse a replayed old rollback and an expired manifest; the key is not readable as plaintext.

#### KIASA-026 — A `kiasa-browser://` link from any page can silently switch the account the browser works for

- **Category:** access control. **Priority:** P2. **Confidence:** Medium. **Type:** Plausible risk.
- **Evidence:**
  - `agentic browser/internal/link/link.go:73-90` checks only the database host.
  - `main.go:88-99` saves any valid `kapp_` secret, and a running instance picks it up silently (`:180-190`).
  - Flag injection is not possible (`main.go:68-79`).
- **Scenario:**
  1. The member accepts Chrome's external-protocol prompt on another member's page.
  2. The member's PC and proxy now work that member's jobs.
  3. A Gmail connect request then reports the victim's Gmail address to the other account (`internal/link/gmail.go:21-25`).
- **Fix:** confirm any change of account in a native dialog that names the account, or bind codes to a one-time nonce the server issues to the signed-in member.
- **Acceptance criteria:** a link holding a different account's code never takes effect without confirmation.

#### KIASA-027 — The Gmail code matcher can type an unrelated security code into an employer's form

- **Category:** privacy / correctness. **Priority:** P2. **Confidence:** High on the logic. **Type:** Verified logic.
- **Evidence:**
  - `agentic browser/internal/gmail/codes.go:17-19,158-187` accepts any sender on a broad ATS list (including Rippling, ADP, Oracle and Workday), or any substring of the company name.
  - `client.go:464-494` reads the full bodies of up to 25 messages from the last hour, every 3 s, before filtering.
- **Scenario:** the member's own employer sends a Rippling login code, or a bank's code matches the company name. That code is entered on a third-party form.
- **Fix:**
  - Derive the expected sender domain from the job's host.
  - Fetch metadata first and read a body only after a match.
  - Require the email to arrive after submit was pressed.
- **Acceptance criteria:** tests where Rippling or bank codes are not used for a Greenhouse job.

#### KIASA-028 — Retries can submit the same application twice

- **Category:** correctness. **Priority:** P2. **Confidence:** Medium-high. **Type:** Verified logic.
- **Evidence:**
  - Outcomes `Unclear` and `NotSubmitted` after submit is pressed are reported as `failed` (`internal/agent/submit.go:55-57`).
  - `browser_agent_next_job` retries `failed` jobs up to 3 times, and re-offers `working` jobs after 15 min (`20261104090000_auto_apply.sql:174-177`).
  - A crash after submit leaves the job `working`.
- **Fix:** record a `submit_pressed` state before clicking; never auto-retry past it; send such jobs to the member.
- **Acceptance criteria:** the agent never presses submit twice for the same job and member (test with injected crashes).

#### KIASA-029 — Rule-based answers state facts the member did not give

- **Category:** data integrity / compliance. **Priority:** P2. **Confidence:** High. **Type:** Verified defect.
- **Evidence (all in `agentic browser/internal/modelserver/rules.go`):**
  - **Race:** `:785-790` matches on the first word only ("native"), so "Native American or Alaska Native" and "Native Hawaiian or Pacific Islander" (`apps/web/src/components/apply/apply-details.tsx:40`) get swapped depending on the order of the form's options.
  - **Inferred answers:** `:709-735` derives answers on sexual orientation, transgender status and pronouns from a single LGBTQ+ answer. This is encoded in tests at `server_test.go:351-357`.
  - **Decline rule gaps:** the decline rule covers only choice questions (`:145`). Text and checkbox demographic questions can reach the model or be ticked under `AgreeForMe` (`:161-168`).
  - **Referral source:** `:579-598` always answers "LinkedIn" for "how did you hear about us", whatever the truth (tested at `server_test.go:1005-1011`).
- **Fix:**
  - Answer demographic questions only with the member's saved value for that exact topic, matched against an explicit synonym set per option; otherwise decline.
  - Route every kind of demographic question through the rule.
  - Take the referral source from the job's stored source, a saved answer, or ask the member.
- **Acceptance criteria:** table tests over Greenhouse, Lever and Ashby option orders; no derived answers; the source comes from data.

#### KIASA-030 — Every prompt includes all saved sensitive facts, and third-party text can steer free-text answers

- **Category:** privacy / prompt injection. **Priority:** P2. **Confidence:** Medium. **Type:** Plausible risk.
- **Evidence:**
  - `internal/modelserver/model.go:178-210` sends every non-demographic fact (criminal record, citizenship, clearance, salary), the career text and the résumé with every question.
  - Labels, hints and the job description are third-party text (`:212-228`).
  - Choice answers are constrained to the form's options and re-checked (`:295-341`); free text is not.
- **Scenario:** a crafted job description gets the model to place the criminal-record or salary fact in an unrelated text box.
- **Fix:**
  - Send only the facts relevant to each question.
  - Fence third-party text as data in the prompt.
  - Never let a legal fact appear in free text for a question that did not ask for it, using a post-check.
- **Acceptance criteria:** an adversarial-label test cannot surface an unrelated saved legal fact.

#### KIASA-031 — Model server: plaintext key, quick-tunnel trust and long-lived browser keys

- **Category:** security. **Priority:** P2. **Confidence:** Medium. **Type:** Plausible risk.
- **Evidence:**
  - **Server key:** a plaintext file at `%LOCALAPPDATA%\KIASA\model-server-key.txt` (`cmd/modelserver/main.go:37`). Whoever holds it can set any `*.trycloudflare.com` address (`20261104090000_auto_apply.sql:253-256`).
  - **Long-lived browser keys:** browsers send their `kapp_` secret to that address (`internal/agent/agent.go:123-124,219`). Revoked keys keep working for up to 5 min (`internal/modelserver/server.go:28`).
  - **Global limiter:** the bad-key limiter is global (`server.go:442-449`), so anyone who knows the tunnel URL can lock out new browsers.
  - **Quick tunnels:** traffic is decrypted at Cloudflare's edge; these tunnels were not designed for production.
- **Fix:**
  - Seal the key with DPAPI.
  - Use a named tunnel on KIASA's domain and pin it in the browser.
  - Use short-lived per-request tokens instead of the `kapp_` secret.
  - Make the limiter per client.
- **Acceptance criteria:** browsers refuse unpinned hosts, and a revoked key fails within 30 s.

#### KIASA-032 — Retention promises are not built, and pay figures are visible to all members

- **Category:** privacy. **Priority:** P2. **Confidence:** Medium. **Type:** Verified gap.
- **Evidence:**
  - `apps/web/src/content/docs/legal.ts:380,414-421` states retention periods.
  - Only `attempts`, `bot_steps`, `job_reads` and `bot_runs` are pruned. Messages, `meeting_messages`, `applications`, `tailored_resumes`, `apply_details` and storage are never pruned.
  - `team_board()` (`20261026235000_jobs.sql`, around `:363-389`) returns every approved member's `monthly_salary`, `paid_month` and `paid_total` to the team.
- **Fix:**
  - Add `pg_cron` retention jobs matching the policy, or change the policy text.
  - Make pay visible only by opt-in, or to admins only.
- **Acceptance criteria:** the documented retention matches scheduled jobs; pay columns are only returned with consent.

#### KIASA-033 — Simulated members look like real members to admins and testers, and their work mixes into real metrics

- **Category:** data integrity / trust. **Priority:** P2. **Confidence:** Medium-high. **Type:** Verified behaviour.
- **Evidence:**
  - Admins create real auth accounts with generated names (`apps/web/src/lib/sims/actions.ts:64-71`, `lib/sims/names.ts:33`).
  - A `pg_cron` job inserts real `applications` rows on the day's real job links every 5 minutes (`20261028120000_sims_work.sql:95`).
  - Their presence imitates people (`20261028190000_sims_presence.sql`).
  - Ordinary members never see them (`visible()`, `hiddenFromViewer`), but **admins and "testers" see them shown as any member, with no label** (`lib/chat/server.ts:46-48`, `components/chat/chat-app.tsx:128-134,567`).
  - Admin trends and leaderboards include their applications.
- **Scenario:** an admin judges team performance from numbers inflated by simulated applications. A tester (a real member) sees simulated colleagues who look real.
- **Fix:**
  - Add an `is_simulated` badge wherever sims are rendered.
  - Exclude sims from metrics by default, with an explicit toggle.
  - Tell testers in writing.
- **Acceptance criteria:** every sim has a visible label; default metrics exclude sim rows.

#### KIASA-034 — Résumé module: no version history, and tailored résumés are saved without approval

- **Category:** data integrity. **Priority:** P2. **Confidence:** High. **Type:** Verified gap.
- **Evidence:**
  - `resume_profiles` has one row per user (`20261030090000_resume_tailor.sql:13-14`).
  - `tailored_resumes` has the primary key `(job_id, user_id)` and is overwritten by `upsert` (`:23-30`; `lib/resume/actions.ts:165`).
  - `tailorFromAnswer` saves straight after the automated checks.
  - The diff (`lib/resume/diff-profiles.ts`) and the `edited` flag exist, but there is no approval state.
- **Fix:**
  - Add a `resume_versions` table (append-only, with source `manual | ai_init | ai_tailor`).
  - Add a `status` (`draft | approved`) to tailored résumés. Only approved ones are used by downloads and the agent.
- **Acceptance criteria:** each save creates a version; the agent refuses unapproved résumés.

#### KIASA-035 — Migrations are pasted by hand with no record of what ran

- **Category:** delivery / security operations. **Priority:** P2 (high impact). **Confidence:** High. **Type:** Verified process gap.
- **Evidence:**
  - `apps/web/docs/site.md`, "Connecting accounts", step 3 tells people to paste each SQL file into the SQL Editor. Its list stops at `20261102090000_job_reads.sql`; seven later files are not listed.
  - Two migrations are untracked.
  - The code is written to tolerate missing tables silently (`lib/accounts/server.ts:120-126`, KIASA-021).
  - The project's notes record the device-lock migration being unapplied in production until 2026-11-05.
- **Scenario:** a security migration is missed and the control silently turns off.
- **Fix:**
  - Use `supabase db push` / `supabase migration up` with the `supabase_migrations.schema_migrations` table, so applied versions are recorded.
  - Add a `/api/health` check that reports the latest applied migration against the latest in the build, and fails readiness on a mismatch.
  - Drop the code paths that tolerate missing tables.
- **Acceptance criteria:**
  - The production schema version is queryable.
  - CI fails if a migration file is not in the tracked list.
  - A deploy is blocked while migrations are pending.

#### KIASA-036 — No CI; tests are not run automatically; one test is stale; e2e needs a local Docker stack

- **Category:** delivery / quality. **Priority:** P2. **Confidence:** High. **Type:** Verified.
- **Evidence:**
  - There is no `.github/workflows`.
  - The Admin Live Desk unit tests fail 1 of 224 (§6): the test expects a reconnect after 8 s of silence, but uncommitted `Net/ScriptReader.cs:32` raised `ReopenQuietMs` to 20,000.
  - All feature e2e scripts (`apps/web/scripts/*-local/*.cjs`) need local Supabase in Docker.
  - The Playwright site suite starts `next dev`, which loads `.env.local`. The docs warn that its sign-up test must never reach the real database (`docs/site.md`, end of "Connecting accounts").
- **Fix:**
  - Add GitHub Actions on pull requests:
    - web: lint, typecheck, build;
    - Go: `go vet` and `go test ./...` (the browser tests skip without a driver);
    - .NET: build all three apps and run the Live Desk unit tests;
    - Python: compile check.
  - Add a nightly job with Supabase CLI plus Docker for the `*:local:e2e` suites.
  - Make the Playwright config blank the Supabase variables itself.
  - Update the stale test.
- **Acceptance criteria:** every PR shows these checks green; the e2e suites run nightly.

#### KIASA-037 — No observability, health checks or alerting

- **Category:** operations. **Priority:** P2. **Confidence:** High. **Type:** Verified absence.
- **Evidence:**
  - There are 5 `console.error` calls in `apps/web/src`, and no error-reporting SDK, health route or `vercel.json`.
  - The desktop apps log to local files with no rotation (`apps/sound-desk/Net/Log.cs:18`), and the logs include local IP candidates (`SoundSender.cs:208`).
- **Fix:**
  - Add an error reporter with personal data scrubbed (web and desktop).
  - Add `/api/health` for the database, migrations and TURN reachability.
  - Count joins, ICE failures and relay use as metrics.
  - Rotate desktop logs and redact IPs.
- **Acceptance criteria:** an injected server error raises an alert within 5 min; the health check fails on database or migration problems.

#### KIASA-038 — The Admin Live Desk source is not in git, and the two desks share an exe name and window title

- **Category:** maintainability. **Priority:** P2. **Confidence:** High. **Type:** Verified.
- **Evidence:**
  - `git status` shows `apps/admin live-desk/` untracked apart from 3 files, while `apps/live-desk/` (30 tracked files) is deleted.
  - Both `build.ps1` files produce "KIASA Live Desk.exe", and both `MainWindow.xaml:4` titles match.
  - The e2e check that refuses to run while "the real app is open" matches either app.
- **Fix:**
  - Commit the renamed folder with `git mv` history.
  - Give the apps distinct names and titles.
  - On a second launch, activate the existing instance instead of exiting silently.
- **Acceptance criteria:** a clean clone builds all three apps; the names differ.

### P3 (condensed: each gives evidence, scenario, fix and acceptance)

- **KIASA-039 — The local capture servers trust any local process.**
  - Evidence: the `apps/live-script/live_server.py:63-69` Origin allowlist stops other websites but not local programs, which can forge Origin, as `apps/admin live-desk/Net/LocalScript.cs:128-133` does.
  - Scenario: another local process feeds text that the admin desk pastes into the admin's documents.
  - Fix: a per-install secret handshake.
  - Acceptance: a connection without the secret is refused.
- **KIASA-040 — PDF printing has no per-member limit and an unhardened page.**
  - Evidence: `apps/web/src/app/jobs/resume/pdf/route.ts`, `lib/resume/server.ts:47-121`. One serialized page per instance; JavaScript and network on. Content is escaped (`resume-html.ts:125-127`).
  - Fix: a per-user limit; `javaScriptEnabled:false`; abort every request except `data:`.
  - Acceptance: a burst over N returns 429.
- **KIASA-041 — The ChatGPT Bridge extension has broad reach.**
  - Evidence: `apps/web/bridge/manifest.json` (`<all_urls>`, `scripting`). `background.js:144-177` opens any http(s) job URL with the member's access. `:14-31` lets kiasa.tech script read the ChatGPT account email.
  - Fix: request permissions at the time of use; block private and intranet hosts; do not return the email.
- **KIASA-042 — A member's pasted job description overwrites the shared job row.**
  - Evidence: `lib/resume/actions.ts:83,90` writes it with the service key; it then feeds other members' prompts.
  - Fix: store it per member, or queue it for admin review.
- **KIASA-043 — Input validation gaps.**
  - Evidence:
    - `lib/teams/contacts.ts:33` builds a PostgREST `.or()` string from input (blocked today by a prior lookup).
    - `decide`, `setTopManager`, `removeAccount`, `decideContact`, `decideJoin` and `placeSims` do not check UUIDs.
    - `lib/teams/actions.ts:69` checks admin status by **email**.
  - Fix: a shared zod UUID check; use `user_id`.
- **KIASA-044 — A race and an unindexed scan.**
  - Evidence: `lib/chat/server.ts:123-133` checks then inserts the "KIASA" chat, which can create duplicates. `lib/meetings/actions.ts:99` filters all messages by `attachment->>…` with no index.
  - Fix: a unique key; an expression index on `(attachment->>'type', attachment->>'id')`.
- **KIASA-045 — Small information leaks.**
  - Evidence: `visible(uuid)` and `team_of(uuid)` can be called by unapproved accounts (they reveal sims and teams). Admin pages run `everyone()` before the admin check (`app/admin/page.tsx:21`); the result is not rendered.
  - Fix: require `jobs_team()` inside them; check before querying.
- **KIASA-046 — Small meeting items.**
  - Evidence:
    - Camera and mic are acquired for an ended meeting (`use-meeting.ts:327-357`).
    - No limit on mesh size (the UI only advises about six, `chat-meeting.tsx:135`).
    - A second `useinbandfec=1` is added, and music sharing has no `stereo=1` (`rtc.ts:15-16`).
    - Repeated share and unshare grows the SDP.
    - The ringing `AudioContext` is created without a user gesture (`chat-meeting.tsx:301`).
    - The meet and live-script policies cast `::uuid` without a guard.
    - `live-link.ts:132-138` monkeypatches `sendHeartbeat`, which ties it to realtime-js 2.117.3.
  - Fix: each item is local and small; add a version-pinned test for the heartbeat patch.
- **KIASA-047 — Model server robustness.**
  - Evidence: `/health` has no authentication and calls Ollama on every request (`internal/modelserver/server.go:410-423`); the limiter is global.
  - Fix: cache health results; limit per client.
- **KIASA-048 — KIASA Browser reliability details.**
  - Evidence:
    - The Gmail `Evaluate` call has no timeout (`browser/gmail.go:44`).
    - `Engine.Close` can run twice (`main.go:139-176`).
    - `os.Exit` in the link callback skips cleanup (`:157-161`).
    - "Confirmed" is decided by a regex over the whole page body (`greenhouse/submit.go:34`, `ats/submit.go:28`).
    - `browser_agent_next_job`'s site regex appears to cover Greenhouse only (`auto_apply.sql:145`), while the browser also supports Lever and Ashby. Unverified whether a later migration changes this.
    - Pre-release versions disable updates (`update.go:89-102`).
    - Uninstall keeps the Gmail token and profile.
  - Fix: each with a unit test.
- **KIASA-049 — Live Script hygiene.**
  - Evidence:
    - Transcripts are plaintext with no retention (`%LOCALAPPDATA%\KIASA Live Script\transcripts`, `live_script.py:84`).
    - `taskkill` by image name ends every other copy (`live_server.py:312-316`).
    - The 660 MB model is pinned to a revision with no local hash check (`live_script.py:38-39,206`).
    - The punctuation model's license is not recorded.
    - `keep_fast` also disables throttling for `LiveCaptions.exe` (`system_captions.py:200-218`).
  - Fix: a retention setting and a delete button; kill only the PID holding the port; check hashes; record the license.
- **KIASA-050 — Desktop hygiene.**
  - Evidence:
    - The stateless linear resampler has no anti-alias filter, `PacketLossPercent` is never set (so FEC is likely inert), and there are allocations per frame (`apps/sound-desk/Audio/Loopback.cs:30-129`).
    - Member text with newlines can press Enter in the admin's single-line targets (`apps/admin live-desk/Win/Typer.cs:153-158,441-442`).
    - A thread is spawned per UI Automation look (`Win/CaretTracker.cs:55-62`).
    - Test-build `TestPipe` uses the default ACL (`Win/TestPipe.cs:33`; excluded from release builds by `#if DESK_TEST`).
    - Proxy credentials go in clear over `http://` proxies (`Net/Route.cs:37-41`).
    - No `AutomationProperties` anywhere (accessibility).
  - Fix: a stateful resampler and `PacketLossPercent≈10`; strip control characters for single-line targets; one UIA worker; `PipeOptions.CurrentUserOnly`; HTTPS-only proxies; automation names and keyboard navigation.
- **KIASA-051 — Opaque tracked binary and dependency advisories.**
  - Evidence:
    - `agentic browser/rsrc_windows_amd64.syso` is tracked with no generator.
    - `npm audit` reports 8 moderate advisories, all through dev-only `eslint-config-next` → `typescript-eslint` → `minimatch` (GHSA-g3hv-75wg-m249).
    - Sound Desk uses obsolete Concentus APIs (CS0618) and an un-awaited task (`SoundSender.cs:178`, CS4014).
  - Fix: document or generate the `.syso`; update `eslint-config-next` when a fixed version is available; address the warnings.

---

## 6. Validation results

**Environment:**
- Windows 11 Pro 10.0.26200
- Node 24.15.0, npm 11.12.1
- Go 1.27.3
- .NET SDK 8.0.421
- Python 3.12.10

Checks were run against the working tree as it stood (including uncommitted changes). Nothing in the repository was modified. Builds of the desktop apps and the web app ran on copies in a temporary folder.

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Web lint | `npx eslint .` (in `apps/web`) | **Pass**: exit 0, 0 errors, 1 warning (`bridge/chatgpt.js:32` unused `wait`) |
| 2 | Web typecheck | `npm run typecheck` (`next typegen && tsc --noEmit`) | **Pass**: exit 0 |
| 3 | Web production build | `next build` in an isolated copy **without** `.env*` | **Pass** after two environment-only failures (below): compiled in 10.9 s, TypeScript in 10.0 s, 101 static pages, all routes listed. Without environment variables the account pages render their sample design, so a build with production variables was **not** run. |
| 4 | npm advisories | `npm audit --json` | 8 moderate, 0 high, 0 critical; all dev-only (KIASA-051) |
| 5 | Go vet | `go vet ./...` (`GOFLAGS=-mod=readonly`, `GOPROXY=off`) | **Pass** |
| 6 | Go tests | `go test -count=1 ./...` (same flags; local Chrome and driver) | **Pass**: 13 packages ok, 0 skipped, about 120 s. The browser tests use stand-in pages and abort any request that would leave the machine. |
| 7 | Sound Desk build | `dotnet build -c Release --source <local NuGet cache>` | **Pass**, 4 warnings: CS0618 ×2, CS4014 at `SoundSender.cs:178`, WFAC010 |
| 8 | Admin Live Desk build | same | **Pass**, 0 warnings |
| 9 | User Live Desk build | same | **Pass**, 0 warnings |
| 10 | Admin Live Desk unit tests | `dotnet run --project tests/LiveDesk.Tests.csproj` | **Fail**: 223 passed, 1 failed ("quiet: a new connection: opened 1"). This is a stale test, not a product regression (KIASA-036). |
| 11 | Python sources | `ast.parse` of the 3 files | **Pass** |
| 12 | Secret scan, git history | `git log --all -p -G <patterns>` over 180 commits | **No matches.** Patterns: Supabase secret, JWT, Google OAuth secret, private keys, `sk-`, Google API key, VAPID and TURN env values. |
| 13 | Secret scan, tracked files | sub-review with the same patterns | No matches; `.env.example` holds no values |

**The two environment-only build failures:**
- Turbopack could not resolve `next` through a `node_modules` junction outside the project root.
- Webpack failed on a relative path across drives.

A real `node_modules` copy fixed both. Neither is a project defect.

**Runtime observation:** on the audit PC, KIASA Live Script was listening on `127.0.0.1:8765` only, which agrees with the loopback-only bind claim.

**Blocked or deliberately not run:**

| Check | Reason |
|---|---|
| `chat`, `jobs`, `meet`, `meet:people`, `sound`, `teams` and `sims` `:local:e2e`, and `auto-apply-local/*` | They need local Supabase in Docker. Docker Desktop was not running and was not started, to avoid side effects on a shared PC. |
| Playwright site suite (`tests/*.spec.ts`) | It would start `next dev` with `.env.local` (the project's real Supabase); the docs warn its sign-up test must not reach the real database. |
| `apps/admin live-desk/tests/*.cjs` e2e | They move the real mouse and drive desktop apps, and the real apps were running. |
| Any WebRTC runtime test: two participants, unauthorized join, end, leave, forced TURN, outage, token expiry, concurrent actions | They need the local stack; procedures are in §7.3. |
| Network matrix, relay-only, international routes | No shaping or relay environment. |
| Windows 10, a second PC, device switching, SmartScreen, installation, update apply | Platform tests not available. |
| `dotnet list package --vulnerable`, `govulncheck`, `pip-audit` | Not run; the tools were not installed. |
| Production settings (Auth hook, sign-ups, private-only Realtime, CAPTCHA, TURN variables, applied migrations, `apply_control` rows) | No access. |

**Remaining uncertainty:**
- How often messages are lost on hosted Supabase Realtime.
- The real presence and broadcast limits on hosted Supabase.
- Which transports Cloudflare returns.
- Whether `apply` mode or live capture is in use with real third parties.
- The fabrication rate of the model's answers (taken from the owner's notes, not measured).

---

## 7. Performance and reliability

### 7.1 Measured in this audit

No media, network or load measurement was made. The only figures are check durations: build 33 s, Go tests about 120 s, typecheck 16 s.

The project's working notes contain earlier measurements, which were **not re-verified here** and are not counted as evidence:
- Live Captions about 0.7 s behind speech.
- Live-script delay about 2.5–3.2 s at about 4 kbit/s.
- Meeting join about 2.7 s on a machine where STUN does not answer.

### 7.2 Likely bottlenecks (inferred from code, needing verification)

1. **Mesh upload.**
   - Each participant uploads N−1 copies of every stream.
   - With the camera at 700 kbps and N=6, that is 3.5 Mbps up for the camera alone, and a screen share adds up to 5 × 1.8 = 9 Mbps.
   - A share started mid-call is not capped (KIASA-015).
   - *Verify:* `getStats` `outbound-rtp` bitrate per sender, and `qualityLimitationReason`, with 2, 4 and 6 participants.
2. **Supabase Realtime limits.**
   - The code paces presence calls at 4 per 31 s to stay under an observed 5 per 30 s (`CLIENT_PRESENCE_MAX_CALLS`, read from the local container and assumed for hosted).
   - Broadcast is not acknowledged (KIASA-007).
   - *Verify:* against hosted Supabase with a soak test of join and leave churn.
3. **TURN relay capacity and egress** (§7.4). *Verify:* the share of calls whose selected candidate pair is `relay`.
4. **PDF printing on Vercel:** one serialized Chromium page per instance (`lib/resume/server.ts`). *Verify:* the p95 under 10 concurrent requests.
5. **Model server:** a single consumer GPU, one request per member at a time, and a global limiter. *Verify:* queue wait at 10 concurrent browsers.
6. **Sound Desk CPU:** allocations per callback and the resampler (KIASA-050). *Verify:* CPU% and GC counts over 1 h.

### 7.3 Low-bandwidth and adverse-network test matrix (proposed)

**Set-up:**
- Two Windows PCs or VMs. Shape traffic with Linux `tc netem` on a gateway, or with Clumsy on Windows. Apply the shaping to the **member side**.
- Rates are kbps. "Up" and "down" are from the member's point of view, and RTT is round-trip.
- A relay-only run needs a test switch that sets `iceTransportPolicy: 'relay'`, which does not exist yet (KIASA-015).

| ID | Up / down (kbps) | RTT (ms) | Loss (%) | Jitter (ms) | Event | Content |
|---|---|---|---|---|---|---|
| N1 | 64 / 64 | 300 | 2 | 20 | — | Voice only |
| N2 | 128 / 128 | 300 | 3 | 30 | — | Voice + screen |
| N3 | 256 / 256 | 150 | 1 | 20 | — | Voice + screen (static text) |
| N4 | 512 / 512 | 800 | 5 | 50 | — | Voice + camera + screen |
| N5 | 1,000 / 5,000 | 50 | 0 | 5 | — | Baseline, all media |
| N6 | 512 / 512 | 200 | 1 | 20 | UDP blocked; only TCP/TLS 443 allowed | Voice + screen through relay |
| N7 | 256 / 256 | 200 | 10 (bursty) | 40 | — | Voice + screen |
| N8 | 512 / 512 | 150 | 1 | 20 | Full outage of 5 s, 30 s and 120 s | Voice + screen |
| N9 | 512 / 512 | 150 | 1 | 20 | Network switch (new IP), Wi-Fi to LTE | Voice + screen |
| N10 | 128 / 2,000 | 250 | 2 | 30 | The sharer's uplink is the constraint | Screen |
| N11 | 512 / 512 | 150 | 1 | 20 | 2-hour session; token rotation; TURN TTL crossing (set TTL to 10 min in test) | Voice + screen |

**Measurements** (from `getStats` every 1 s, on both ends):
- **Setup time:** from clicking Join to `connectionState === 'connected'`, plus the first decoded audio frame.
- **Audio continuity:** `concealedSamples / totalSamplesReceived` and `jitterBufferDelay`.
- **Video:** `framesPerSecond`, `frameWidth/Height` and `qualityLimitationReason` for screen and camera.
- **Network:** `currentRoundTripTime`, `availableOutgoingBitrate`, `packetsLost`, and the selected candidate-pair type.
- **Recovery:** from the end of an outage to audio flowing again.
- **Readability:** share a fixed page of 10, 12 and 14 px text. A human rater or OCR at the viewer scores the time until it is readable.
- **Client resources:** CPU and memory, through Task Manager or PerfMon.
- **Relay load:** relay bytes from the relay's own statistics.

**Proposed targets** (these are *targets*, not results):
- Setup p90 ≤ 5 s (N3).
- Concealment ≤ 5% (N2, N3).
- 12-px text readable within 5 s of a static screen (N3).
- Recovery ≤ 10 s after a 30 s outage (N8).
- No silent dead pairs in N7.
- A relay-only connection always succeeds (N6).

**Required functional cases:**
- two authorized participants;
- an unauthorized join attempt;
- a refused or expired admission;
- pause and resume of each device;
- a local stop during an outage, where capture must stop locally even when offline;
- token expiry;
- reconnect;
- concurrent end and admit.

Simulation results must be kept separate from real international-route trials. Run at least one pair across the actual countries involved, on residential networks, at peak hours.

### 7.4 Relay capacity and egress model

**Assumptions (not measurements):**
- Voice: Opus 64 kbps plus RTP/UDP/IP/TURN overhead at 50 packets/s ≈ **82 kbps**.
- Camera: ≈ **720 kbps** (700 cap + ~3%).
- Screen: ≈ **1,850 kbps** (1,800 cap + ~3%).

GB per hour for one relayed stream in one direction = kbps × 3600 / 8 / 10⁶:

| Stream | GB per relayed stream-hour |
|---|---|
| Voice | 0.037 |
| Camera | 0.32 |
| Screen | 0.83 |

**Per session** (each direction through the relay):
- 1:1 call, voice and camera both ways: 2 × (0.037 + 0.32) ≈ **0.72 GB/h**.
- 1:1 with one screen share and voice both ways: 2 × 0.037 + 0.83 ≈ **0.90 GB/h**.
- Mesh of N fully relayed: each participant sends N−1 copies, so relayed traffic grows as N(N−1).
- Live sounds: **0.037 GB/h per listening admin.**

**Monthly example:** 20 members × 2 h/day × 22 days of 1:1 voice and camera, all relayed = 880 h × 0.72 ≈ 634 GB.

**Unknowns that change the result:**
- What share of sessions actually need the relay. Measure the selected candidate-pair type; it is often a minority.
- Whether the provider bills inbound plus outbound or outbound only.

The repository's own comment (`apps/web/.env.example`) says Cloudflare's relay is "free up to 1,000 GB a month". This was **not verified**, and no prices are given here. With the current `/say/ice` exposure (KIASA-012), relay use is not bounded by membership.

**Scaling the control plane and the relay separately:**
- The control plane is Vercel plus Supabase. It scales with joins and signals, and is limited by Realtime rate limits.
- The relay scales with media minutes. It is managed by Cloudflare, with no capacity to plan apart from quota.
- At present scale, no SFU or microservice change is justified.

---

## 8. Recommended changes (ranked backlog)

Effort ranges: **S** ≤ 1 day, **M** 2–5 days, **L** 1–3 weeks (one engineer). The uncertainty column reflects unknown production state or the need for runtime work.

### 8.1 Quick fixes (S)

| Rank | Change | Findings | Depends on | Uncertainty | Acceptance |
|---|---|---|---|---|---|
| 1 | Restrict `apply_control` so admins can only set `off`/`fill`; check production for `mode='apply'` rows and turn them off | 001 | — | Low | RLS test; no `apply` rows without a member opt-in |
| 2 | End the job as `waiting` on human-verification code steps; stop auto-ticking attestations | 002, 003 | — | Low | Fixture tests |
| 3 | Meeting: `joined` includes `!over`; stop all tracks on end and leave; no screen re-attach on Rejoin | 006 | — | Low | Playwright test (§5) |
| 4 | `/say/ice`: approved members and admins only, plus rate limit; no static TURN credentials | 012 | — | Low | 403 / 429 tests |
| 5 | Device lock and access-token hook fail closed | 021 | — | Low | Unit test |
| 6 | Fix `desk_presence.sql` **before** running it | 024 | — | Low | RLS test |
| 7 | Live script: no auto-resume without a click | 016 | — | Low | Reload test |
| 8 | Sound Desk: expire the resume flag, live icon and toasts, confirm double-click, remove the `*.old` sweep, refusal backoff, awaited stop | 009, 018 | — | Medium (Windows UX) | Tests in KIASA-009 and KIASA-018 |
| 9 | Account deletion removes résumé and chat files | 011 | — | Low | e2e test |
| 10 | Call `limit()` after every sender change | 015 (part) | — | Low | `getParameters` test |
| 11 | Correct the misleading copy and comments (live-script README, `agent.go`, `apply-work`, sign-up disclosure) | 001, 005 | — | Low | Review |
| 12 | Commit the Admin Live Desk; fix the stale test; distinct exe names | 036, 038 | — | Low | Clean clone builds; tests green |
| 13 | `setTeam` by `user_id`; UUID checks | 043 | — | Low | Unit tests |

### 8.2 Medium changes (M)

| Rank | Change | Findings | Depends on | Uncertainty | Acceptance |
|---|---|---|---|---|---|
| 14 | Member review gate for auto-apply (approved-answer hash), `submit_pressed` state, answer provenance | 001, 002, 028 | 1, 2 | Medium | Agent tests |
| 15 | Append-only `audit_events` table and its writers; member-visible history | 008 | — | Low | RLS and e2e tests |
| 16 | Meeting signaling recovery: acks, channel rejoin, re-offer timer, presence grace, `restartIce` on disconnect and `online`, TURN refresh | 007 | 3 | Medium (runtime) | N7, N8, N9, N11 |
| 17 | Recording state in the database; crash-safe writes | 014 | — | Low | Tests in KIASA-014 |
| 18 | Email confirmation, admin linking by `user_id`, approval of a new admin's first device | 020 | — | Low | Tests |
| 19 | Staff MFA (TOTP + AAL2 in `is_admin`); revoke other sessions on password change; Supabase Auth settings | 022 | — | Medium (production settings) | Tests |
| 20 | Migration tracking (Supabase CLI), schema-version health check, remove missing-table tolerance | 035, 021 | — | Low | Deploy blocked while migrations are pending |
| 21 | CI workflow (web, Go, .NET, Python) plus nightly e2e on the Supabase CLI | 036 | 12 | Low | Green checks on every PR |
| 22 | Signed Sound Desk updater (port the Go design) **and** an Authenticode pipeline for all binaries | 010, 025 | Certificate purchase | Medium | Signature tests |
| 23 | Rollback expiry and floor in the browser manifest; protect the signing key | 025 | — | Low | Tests |
| 24 | Observability: error reporting, health route, ICE and relay metrics, desktop log rotation | 037 | 20 | Low | Alert test |
| 25 | Shared .NET network library; global exception handlers; token push on every channel | 019, 017 | — | Medium | Fault-injection tests |
| 26 | Identity binding in meeting signaling; restrict reads; `ended_at` in policies | 013 | 16 | Medium | Forged-signal test |
| 27 | Diagnostics (RTT, loss, jitter, FPS, actual route) and a relay-only test switch | 015 | — | Low | UI shows the stats |
| 28 | Privacy: retention jobs, pay opt-in, sim labels and metric separation, résumé versions and approval | 032, 033, 034 | — | Low | Tests |
| 29 | Auto-apply data correctness: demographic and source rules, prompt minimisation, Gmail matcher, account-switch confirmation, model-server key and tunnel | 026, 027, 029, 030, 031 | 14 | Medium | Tests |
| 30 | CSP nonces | 023 | — | Medium | Playwright with a strict CSP |

### 8.3 Architecture and product work (L)

| Rank | Change | Findings | Notes |
|---|---|---|---|
| A1 | **Legal and terms-of-service review, and a product decision** on automated submission, the detection masking, and live third-party capture with staff relay | 001–005 | Blocking. Not engineering effort, but it decides whether ranks 2, 11, 14 and 29 are enough, or whether those features are removed. |
| A2 | Adaptive media policy: a stats loop with hysteresis, audio-first shedding, a screen readability mode, and a screenshot fallback over a data channel | 015 | Build after rank 16; validate with §7.3 |
| A3 | If the PRD's remote-assistance product is in scope: assistance request queue, assignment and reassignment, a session state machine (`requested → assigned → consented → live ⇄ paused → ended / failed / expired`) with server-side transitions, and a desktop screen-capture client | B-02, B-01 | Reuse `meeting_people`, admissions, Realtime, TURN and the Go updater design; start 1:1 peer-to-peer |
| A4 | Session hardening: httpOnly-cookie session handling where feasible, or shorter JWT lifetimes for staff | 023 | Measure the effect on Realtime clients first |

### 8.4 When to keep the current design

- **Supabase Realtime for signaling.** It is adequate at this scale. Add acknowledgements and rejoin (rank 16) rather than replacing it.
- **Peer-to-peer mesh.** It is right for 1:1 assistance and for small meetings of 4 or fewer. An SFU (for example LiveKit) is justified only if multi-viewer sessions or meetings over about 5 people become requirements.
- **Cloudflare TURN with short-lived credentials.** Keep it; fix the scope (rank 4) and refresh (rank 16).
- **`live-link.ts` pacing and resync,** the sound channel's `keepUp`, and the perfect-negotiation code. Keep them; they are the strongest real-time code in the repository.
- **RLS-centred authorization** and definer functions with an empty `search_path`. Keep them; extend them with audit logging.
- **The Go browser's update design.** It is the model for the other apps (ranks 22 and 23).
- **No microservices.** No rewrite is justified by current scale or evidence.

---

## 9. Delivery plan

### 9.1 Immediate (this week)

1. **Contain** (A1 starts):
   - Query production for `apply_control.mode = 'apply'` and set any such rows to `fill` or `off`.
   - Pause any use of live capture or Live Desk in interviews with outside parties until the legal review is done.
   - Do not set a URL in `/say/sound-desk/version`.
2. **Ship the quick fixes,** ranks 1–13, in two or three small PRs:
   - Database policies: ranks 1, 4, 5 and 6, plus the desk migration fix.
   - Meeting and live-script consent: ranks 3, 7 and 10.
   - Sound Desk and desktop: ranks 8 and 12.
   - Agent: ranks 2 and 11.
   - Data deletion: rank 9.
   - Validation: two-participant consent tests run locally with Docker started deliberately, plus a manual Sound Desk check on one PC.
3. **Confirm production settings:** the Auth hook, sign-ups off, private-only Realtime, TURN variables, and the list of migrations applied.

### 9.2 Next milestones (weeks 2–6)

- **M1, trust foundations:**
  - Rank 15, audit events.
  - Rank 18, admin linking.
  - Rank 19, MFA.
  - Rank 20, migration tracking.
  - Rank 21, CI.
- **M2, meeting reliability:**
  - Rank 16, signaling recovery.
  - Rank 17, recording.
  - Rank 27, diagnostics.
  - Then run matrix rows N1–N11 in simulation.
- **M3, release integrity:**
  - Ranks 22 and 23, signing and updater.
  - Rank 25, the shared .NET library.
  - Rank 24, observability.
- **M4, data correctness and privacy:**
  - Ranks 14 and 29, if auto-apply survives A1.
  - Rank 28, privacy.

### 9.3 Later production hardening

- A2, adaptive media.
- A3, the assistance product, if it is in scope.
- A4, session hardening.
- KIASA-013, identity binding.
- The P3 items.

### 9.4 What to preserve, and where a refactor is justified

**Preserve:**
- `live-link.ts` and `sound-link.ts`.
- The perfect-negotiation core in `use-meeting.ts`.
- All RLS and definer-function patterns.
- `agentic browser/internal/update`.
- The local-listener hardening in `internal/settingsui` and `proxy/forwarder.go`.
- The Typer's safety checks.

**Refactor:**
- The desktop network and account code: three diverging copies become one library (KIASA-019).
- Meeting signaling recovery: extract a supervised `Link` class with its own timers out of the 512-line hook (KIASA-007).
- The Sound Desk updater: replace it rather than patch it (KIASA-010).

### 9.5 Validation tracks (keep separate)

1. **Development:** unit tests and local e2e (Docker Supabase); CI on every PR.
2. **Platform:**
   - Windows 10 and 11 machines;
   - device hot-swap;
   - SmartScreen and signature checks;
   - install, update and rollback;
   - hidden tray icons;
   - high-DPI and accessibility.
3. **Regional network:**
   - the §7.3 matrix in simulation;
   - then real routes between the actual countries;
   - relay-only runs.
4. **Load:**
   - Realtime join and broadcast soak on hosted Supabase;
   - PDF route concurrency;
   - model-server queue;
   - relay volume from production candidate-pair statistics.

---

## 10. Open questions

These cannot be resolved from the repository, and each one changes what should be built.

1. **Is there a PRD?** Is the remote-assistance product (a desktop screen-share client, an assistance queue, manager assignment) actually planned for the current release? Or is the current workspace the product? Which of mock interviews, coding practice and job search are in scope?
2. **Auto-apply in production:**
   - Does any member have `apply_control.mode = 'apply'`?
   - Has `20261104190000_apply_gmail.sql` been applied?
   - Which browser versions are installed?
3. **Interview capture:**
   - Are live script, Sound Desk and Live Desk used during **real** interviews with outside employers, or only in consented mock sessions?
   - In which jurisdictions are the members and the interviewers?
4. **Supabase production settings:**
   - Is the custom access-token hook enabled?
   - Are sign-ups off, and is Realtime set to private channels only?
   - Are CAPTCHA, leaked-password protection, secure password change and a minimum password length configured?
5. **TURN:**
   - Are the Cloudflare TURN variables set in Vercel?
   - Does the returned list include `turns:` on port 443?
   - Are there current usage figures?
6. **Applied migrations:** which migrations have been applied in production? `20261105300000_desk_presence.sql` is not yet, according to the notes.
7. **Scale:**
   - Expected members, concurrent meetings and meeting sizes.
   - Hours of relayed media per month.
   - Target regions.
8. **Simulated members and testers:**
   - Are testers told which members are simulated?
   - Are sim applications excluded from any reporting used outside the admin team?
9. **Signing:** is a code-signing certificate (OV or EV) available? Who holds the release keys, and where is the backup?
10. **Retention:** is the intended policy the one in `legal.ts`? Which data must be deleted on account removal (transcripts on members' PCs, Gmail tokens, browser profiles)?
11. **Windows targets:** must Windows 10 be supported, and do any members use non-Windows machines?
