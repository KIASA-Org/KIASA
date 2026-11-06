# KIASA Screen/Audio — Quality & Stability Upgrade Report

Date: 2026-11-06 · Branch: `user-live-desk` · Scope: the support-session screen/audio
pipeline (`apps/sound-desk` sender, `apps/web/src/components/support` receiver).

This upgrade targets the field report that KIASA's picture looks far worse than RustDesk on
the same network (screenshots 2026-11-06: picture pinned at **720×404, 1–2 fps, ~8 kbit/s**,
sender **aiming at 70 kbit/s**, route **relay**). It is an evidence-based set of targeted fixes,
not a rewrite. **RustDesk parity is NOT VERIFIED here** — a controlled two-machine / cross-network
benchmark cannot run in this environment (see §6). The specific failure in the screenshots —
quality locked at the floor and never recovering — is fixed and covered by a regression test.

---

## 1. Pipeline, as actually built (file references)

Capture → encode → transport → receive → render:

- **Capture:** `apps/sound-desk/Capture/Screens.cs` (`Grabber`, GDI BitBlt / PrintWindow), fed on the
  `Screen` thread in `Support/SupportSession.cs:467` (`VideoLoop`).
- **Scale/convert:** `VideoLoop` fits the source into 1920×1080 × `plan.Scale`, even dims
  (`SupportSession.cs:511-514`), NV12 via `Capture/Screens.cs` `Nv12.Convert`.
- **Encode:** `Media/H264Encoder.cs` — Media Foundation H.264 (hardware MFT, software fallback),
  constant bit rate, buffer capped to one frame (`BufferFor`, `H264Encoder.cs:25`).
- **Rate control:** `Media/RateControl.cs` — the only congestion control on the path.
- **Transport:** SIPSorcery WebRTC (`SupportSession.cs` `SendFrame`/`SendAudio`), DTLS-SRTP, direct or
  Cloudflare TURN relay. **No pacing, no RTX, no FEC** (library limitation — see §5).
- **Signalling:** Supabase private channel `support:<id>` (`Net/RealtimeLink.cs`, `support-link.ts`).
- **Receive/render:** `apps/web/src/components/support/support-link.ts` (`SupportReceiver`) →
  `support-room.tsx` `<video>`; Details panel figures from `getStats()`.

Reported dimensions observed independently: the decoded picture is 720×404 (0.375 scale of 1080p),
confirming the **rate controller drove resolution to its floor** — not a capture/encoder defect.

## 2. Root causes — confirmed vs. rejected

**Confirmed (fixed):**

1. **Recovery deadlock → quality pinned at the floor.** `RateControl.Report` (old) only climbed after
   `_sinceBad ≥ 8 s` with *zero* bad reports, and **any** single loss report reset `_sinceBad`. On a
   relay that drops the odd burst, the 8 s window never completes → the rate is stuck at the 70 kbit/s
   floor even when the line is clean. This matches screenshot 2 exactly (**0% loss shown, still
   70 kbit/s**). *Dominant cause.*
2. **Floor too low to be usable.** `Least = 70_000` yields an unreadable 720×404 @ 2 fps even when that
   is the final resting rate.
3. **Key-frame storm.** `SupportSession.cs` requested a full key frame on *every* loss report
   (≥1.5 s apart). Unpaced, each key frame is a packet burst that itself causes loss → self-sustaining.
4. **`0×0` sender telemetry.** `SendState` hard-coded `width = 0, height = 0` (`SupportSession.cs:580`).
   A reporting bug, not broken capture (the real stream was 720×404).
5. **Static desktop mislabeled "poor".** `support-link.ts` flagged the connection poor whenever
   `fps < 2`, but a still screen legitimately decodes few frames → false "Poor connection" banner.
6. **Cumulative `freezeCount` shown raw** — grows forever; not a per-interval measure.

**Rejected / not the cause:**

- *Capture broken* — rejected: the decoded picture is a real 720×404 frame; `0×0` was only the
  sender's self-report field.
- *Encoder resolution hard-cap* — rejected: `MaxWidth/Height` are 1920×1080; 720×404 is the controller's
  0.375 scale, not a cap.
- *RTT ≈ 205–266 ms alone means a bad line* — rejected: the controller does not classify on RTT alone;
  relay RTT of this order is normal cross-network.
- *REMB collapse* — already handled: REMB is recorded, never acted on (`RateControl.Remb`).

**Confirmed but NOT fixed here (architectural — see §5):** SIPSorcery has no retransmission (RTX),
FEC, or send pacing, so raw UDP loss on the relay path is never recovered. This is the core reason
RustDesk (which retransmits) looks clean on the same lossy line.

## 3. Changes made, and how each affects delivered quality

| File | Change | Effect |
|---|---|---|
| `Media/RateControl.cs` | Loss smoothed with a ~6 s EWMA; a drop needs congestion **confirmed over two reports** (or one severe >30% report); recovery is gated only by a 5 s cool-down **after a real drop**, not by "no loss at all lately"; climb ×1.25/2 s (was ×1.15/3 s). | A clean line that had one blip now **climbs back within seconds** instead of being pinned. This fixes the field failure. |
| `Media/RateControl.cs` | Floor `Least` 70 → **100 kbit/s** (still ≤ a 128 kbit/s cap, so no overshoot). | The worst-case resting picture is readable rather than unusable. |
| `Media/RateControl.cs` | Exposed `SmoothedLoss` for diagnostics. | Trustworthy telemetry. |
| `Support/SupportSession.cs` | Key frame requested only on a **real loss burst (>2 packets)** and at most every **2 s** (was every loss, 1.5 s). | Stops the self-inflicted key-frame burst loss; the 10 s GOP + bursts-only requests still recover the picture. |
| `Support/SupportSession.cs` | `SendState` now reports the **actual encoded width/height**; diagnostics line adds smoothed loss. | Kills the misleading `0×0`; honest sender figures. |
| `support-link.ts` | "Poor" no longer triggers on low fps; it triggers on **real loss** or **genuine decode freezes while frames are advancing**; tracks per-interval freeze/frame deltas. | A static desktop is no longer called a bad connection. |
| `support-link.ts` / `support-room.tsx` | Unknown figures (`fps`/`width`/`height`) shown as **"—"**, never a fabricated `0`. | Section-6 requirement: unknown ≠ zero. |

Behaviour explicitly preserved: auth, manager authorization, consent, source selection, independent
audio controls, immediate local Stop, no auto-start, relay + direct fallback, encrypted transport.
No recording, remote control, or unattended access added.

## 4. Tests and results

`dotnet run --project tests -- rules` (pure controller math — deterministic, no hardware):

| Check | Result |
|---|---|
| Starts 15 fps, full size | PASS |
| Heavy loss lowers rate & frame rate | PASS (→100 kbit/s, 3 fps) |
| Heavy loss called degraded | PASS |
| Rate never below usable floor | PASS (≥100 kbit/s) |
| Long poor line shrinks picture, then voice | PASS |
| One good second doesn't raise (hysteresis) | PASS |
| Steady good line recovers to health | PASS (100 → 2500 kbit/s / 60 s) |
| **Occasional lost burst does NOT pin the floor** (regression for the field bug) | **PASS (100 → 2500 kbit/s)** |
| REMB alone doesn't cut the rate | PASS |
| 3% random loss on a long line doesn't collapse | PASS |
| Alternating loss doesn't flap the label | PASS (1 flip) |

`dotnet build` (sender): **0 errors** (4 pre-existing warnings, none from this change).
`tsc --noEmit` + `eslint` on `support-link.ts` / `support-room.tsx`: **clean**.

**Single-PC live media e2e** (real `KiasaSoundDesk.exe` + real Chromium, local Supabase, production
build served on :3002) — `node scripts/support-local/e2e.cjs`, **15/15 PASS**. Measured on a clean
(near-zero-loss) loopback path, so it proves the pipeline and the telemetry fixes, **not** loss
recovery or RustDesk parity:

| Observation | Value |
|---|---|
| Delivered picture | **1920×1080, 15.0 fps decoded**, NVIDIA H.264 MFT (hardware), 1200 kbit/s |
| Sender size reported (was `0×0`) | **1920×1080** — the telemetry fix confirmed live |
| Route actually chosen | direct, host → prflx, udp (not relay) |
| Static/paused screen | "0 frames in 2.5 s while paused" — **not** falsely called degraded |
| Audio / mic / two-way voice | reaches the manager; 445 voice packets back; 0 concealed |
| Reconnect after page close | live again in 3.2 s | 
| Stop / app-restart / offline-Stop | capture released at once; never auto-resumes |

Commands:
```
cd apps/sound-desk && dotnet run --project tests -- rules
cd apps/sound-desk && dotnet build
cd apps/web && npx tsc --noEmit && npx eslint src/components/support/*.ts*
# live e2e: npx supabase start; build+serve on :3002 against the local copy; then:
cd apps/web && node scripts/support-local/e2e.cjs
```
Note: serve a **production build** (`next build` + `next start`) against the local copy — `next dev`'s
HMR does not hydrate under Playwright, so the e2e's sign-in step times out against a dev server.

## 5. The remaining architectural gap (why parity still needs more)

RustDesk's stability on a lossy line comes from **retransmitting lost packets** and pacing its own
protocol; its "loss" is recovered and invisible. KIASA uses browser WebRTC with SIPSorcery, which on
this path has **no RTX, no FEC, and no send pacing**. So on a relay with real loss, KIASA still shows
glitches where RustDesk does not — the controller fixes here stop the *self-inflicted* collapse and
the *stuck-at-floor* bug, but they cannot manufacture loss recovery the transport doesn't have.

Options to actually reach RustDesk-class quality (each a larger, separate effort):
- **A. Direct-path preference tuning** (small) — ensure host/srflx is chosen when both ends can reach
  each other; relay is correct only when they genuinely can't.
- **B. Add pacing + FEC + RTX** to the media path (large) — rebuilds what RustDesk already has.
- **C. Embed RustDesk's engine** (large; it is open source — license review required) — matches it
  because it *is* it.

## 6. RustDesk comparison — NOT RUN here, with an executable procedure

This environment has one machine and no controlled cross-network path, so a fair RustDesk comparison
and the acceptance network matrix **cannot be run**. Do not read the unit-test recovery as parity.

Procedure to run it (two machines, same display/scaling/content, sequential not simultaneous):
1. Member machine: build `apps/sound-desk` (`dotnet build -c Release`), start a support session.
2. Manager machine: open `/support/<id>`, open **Details**; record Route, RTT, Picture, Sound, Sender.
3. Workloads: (a) static small-font text, (b) scrolling text, (c) a local motion clip with audio,
   (d) a mixed 30-minute session.
4. Repeat each with RustDesk between the same two machines; record its resolution/fps/latency.
5. Impairment matrix (e.g. `clumsy`/`tc`): caps 128/256/512 kbit/s, 1/2/5 Mbit/s, uncapped; RTT
   50/200/400 ms; loss 0/1/3/5%; a UDP-blocked (forced-relay) case. State uplink/downlink and whether
   delay is one-way or RTT.
6. Local single-PC smoke test (no RustDesk): `cd apps/web && node scripts/support-local/e2e.cjs --impair`.

Results table to fill (left blank — NOT RUN):

| Scenario | KIASA before | KIASA after | RustDesk | Repeats | Method | Verdict |
|---|---|---|---|---|---|---|
| Static text, healthy line | 720×404 @2fps (floor-locked) | _measure_ | _measure_ | — | two-PC + Details | NOT RUN |
| Scrolling text | — | _measure_ | _measure_ | — | two-PC | NOT RUN |
| Motion clip | — | _measure_ | _measure_ | — | two-PC | NOT RUN |
| 30-min mixed | — | _measure_ | _measure_ | — | two-PC | NOT RUN |
| 256 kbit/s cap | — | _measure_ | _measure_ | — | impair | NOT RUN |
| Forced relay + 3% loss | 8 kbit/s, pinned | _measure_ | _measure_ | — | impair | NOT RUN |

## 7. Verdict

- **Fixed and proven (unit):** the stuck-at-floor / no-recovery failure from the screenshots; the
  key-frame storm; `0×0` and static-screen telemetry falsehoods.
- **RustDesk parity: NOT VERIFIED.** Blocked on a two-machine, cross-network benchmark that cannot run
  here. **Next specific blocker:** run §6 on two machines; if clarity/stability still trail RustDesk on
  a lossy relay path, the cause will be the missing RTX/FEC/pacing (§5-B/C), which is the next build.

## 8. Rollback

Revert the five files in §3 (all on `user-live-desk`, uncommitted at time of writing):
`git checkout -- apps/sound-desk/Media/RateControl.cs apps/sound-desk/Support/SupportSession.cs apps/sound-desk/tests/RulesTests.cs apps/web/src/components/support/support-link.ts apps/web/src/components/support/support-room.tsx`
