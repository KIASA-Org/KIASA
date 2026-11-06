// End-to-end test of a support session on THIS computer, against the LOCAL Supabase copy:
// the real KIASA Sound Desk app (member: Ana) capturing a real display and the computer's
// sound, H.264 from the graphics card or Windows, and a real Chromium (manager: the admin)
// receiving it in /support/<id>. The desktop windows are driven through UI Automation, so
// consent is clicked exactly as a person would. Prints PASS/FAIL per step with measurements.
//
// Usage, from apps/web: the steps of auth.cjs, then build the desk (dotnet build in
// apps/sound-desk) and: node scripts/support-local/e2e.cjs [--relay] [--grace]
//   --relay  both ends relay-only through the TURN server named by MEETING_TURN_URLS
//   --grace  also waits out the 2-minute manager grace period
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { execSync, execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function localEnv() {
  const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]*)"?`, "m")) || [])[1] || "";
  const env = { url: get("API_URL"), publishable: get("PUBLISHABLE_KEY") || get("ANON_KEY"), secret: get("SECRET_KEY") || get("SERVICE_ROLE_KEY") };
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error("Refusing: this is only for the local Supabase copy");
  return env;
}
const env = localEnv();
const RELAY = process.argv.includes("--relay") || process.argv.includes("--impair");
const GRACE = process.argv.includes("--grace");
// --impair: relay-only, then the weak-network matrix through the shaping test relay (control on :3480).
const IMPAIR = process.argv.includes("--impair");
const BASE = "http://127.0.0.1:3002";
const DESK = process.env.KIASA_DESK_EXE || path.resolve(__dirname, "../../../sound-desk/bin/Debug/net8.0-windows/KiasaSoundDesk.exe");
const TONE = path.resolve(__dirname, "../../../sound-desk/tests/bin/Debug/net8.0-windows/DeskTests.exe");
const UI = path.join(__dirname, "ui.ps1");
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const out = path.join(os.tmpdir(), `kiasa-support-e2e${IMPAIR ? "-impair" : RELAY ? "-relay" : ""}`);
const data = path.join(out, "desk-data");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(data, { recursive: true });
const results = [];
const errors = [];
async function step(name, fn) {
  const started = Date.now();
  try { const note = await fn(); results.push(`PASS  ${name}${note ? ` (${note})` : ""} [${Date.now() - started} ms]`); }
  catch (error) { results.push(`FAIL  ${name}: ${String(error.message).split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "")}`); }
  console.log(results.at(-1));
}
const wait = ms => new Promise(done => setTimeout(done, ms));
const ui = (window, id, action, seconds = 20, pid = 0) => {
  try {
    return execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", UI, "-Window", window, "-Id", id, "-Do", action, "-Seconds", String(seconds), "-ProcessId", String(pid)], { encoding: "utf8" }).trim();
  } catch (error) { return (error.stdout || "").trim() || "ERROR"; }
};
const CONSENT = "KIASA — Share your screen", BAR = "KIASA — You are sharing";
const log = () => { try { return fs.readFileSync(path.join(data, "log.txt"), "utf8"); } catch { return ""; } };

/** The member's sign-in for the app, sealed for this Windows user as the app keeps it. */
async function seedAccount(email) {
  const response = await fetch(`${BASE}/say/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: people[email].password }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`sign-in for the app: ${body.error}`);
  const kept = JSON.stringify({ Url: body.url, Key: body.key, Id: body.id, Name: body.name, Refresh: body.refresh_token });
  const file = path.join(data, "account-local.bin");
  const script = `Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($env:KEPT); [IO.File]::WriteAllBytes($env:FILE, [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))`;
  execFileSync("powershell", ["-NoProfile", "-Command", script], { env: { ...process.env, KEPT: kept, FILE: file } });
}
let desk = null;
function startDesk() {
  desk = spawn(DESK, [], { env: { ...process.env, KIASA_SOUND_DESK_SITE: BASE, KIASA_SOUND_DESK_DATA: data, ...(RELAY ? { KIASA_DESK_RELAY_ONLY: "1" } : {}) }, stdio: "ignore" });
  return desk.pid;
}
/** Ends only the test's own app, by its process id (never by name: see the project's notes). */
function killDesk() {
  if (desk?.pid) try { execSync(`taskkill /PID ${desk.pid} /T /F`, { stdio: "ignore" }); } catch {}
  desk = null;
}
const hydrated = (page, selector) => page.waitForFunction(selector => {
  const node = document.querySelector(selector);
  return !!node && Object.keys(node).some(key => key.startsWith("__react"));
}, selector, { timeout: 20000 });
/** How loud the shared sound is at the manager's end, over two seconds (0..128). */
const heardLevel = page => page.evaluate(async () => {
  const element = document.querySelector("audio[data-support-audio]");
  const tracks = element?.srcObject?.getAudioTracks() ?? [];
  if (!tracks.length) return null;
  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 2048;
  audio.createMediaStreamSource(new MediaStream(tracks)).connect(analyser);
  const buffer = new Uint8Array(analyser.fftSize);
  let peak = 0;
  for (let i = 0; i < 20; i++) { await new Promise(done => setTimeout(done, 100)); analyser.getByteTimeDomainData(buffer); for (const v of buffer) peak = Math.max(peak, Math.abs(v - 128)); }
  await audio.close();
  return peak;
});
const picture = page => page.evaluate(() => {
  const video = document.querySelector("video[data-support-video]");
  const quality = video?.getVideoPlaybackQuality?.();
  return { width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0, frames: quality?.totalVideoFrames ?? 0, dropped: quality?.droppedVideoFrames ?? 0 };
});
const stateOf = page => page.locator("[data-support-state]").getAttribute("data-support-state").catch(() => null);
const waitState = async (page, want, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = await stateOf(page); if (want.includes(s)) return s; await wait(250); }
  throw new Error(`state stayed ${await stateOf(page)}`);
};
const sources = page => page.locator("[data-support-sources]").innerText().catch(() => "");
const waitSources = async (page, re, ms = 12000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const text = await sources(page); if (re.test(text)) return text; await wait(300); }
  throw new Error(`sources say: ${await sources(page)}`);
};
const tone = ms => { for (let i = 0; i < Math.ceil(ms / 1500); i++) setTimeout(() => spawn(TONE, ["tone"], { stdio: "ignore" }), i * 1400); return wait(ms); };

(async () => {
  if (!fs.existsSync(DESK)) throw new Error(`Build the desk first: ${DESK}`);
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const ids = Object.fromEntries(Object.entries(people).map(([email, p]) => [email.split("@")[0], p.id]));
  await site.from("support_sessions").delete().neq("member_id", "00000000-0000-0000-0000-000000000000");
  await site.from("attempts").delete().eq("kind", "relay");
  await seedAccount("ana@example.com");

  const browser = await chromium.launch({
    channel: "chromium",
    // Not --use-fake-ui-for-media-stream: with it, Chrome gathers no TURN relay candidates
    // (measured here); the microphone is granted to the site below instead.
    args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.grantPermissions(["microphone"], { origin: BASE });
  // Test-only: keep each connection the page makes, to read the browser's own figures.
  await context.addInitScript(() => {
    const Real = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...args) { const pc = new Real(...args); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = Real.prototype;
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`page: ${error.message}`));
  page.on("console", message => { if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) errors.push(`console: ${message.text().slice(0, 200)}`); });
  let session = null;
  const relayQuery = RELAY ? "?relay=1" : "";

  const invite = async () => {
    await page.goto(BASE + "/support");
    await hydrated(page, ".support-desk");
    await page.getByLabel("Member to invite").selectOption(ids.ana);
    await page.getByRole("button", { name: "Invite" }).click();
    await page.getByText(/Invited Ana/).waitFor({ timeout: 10000 });
    const { data } = await site.from("support_sessions").select("*").eq("member_id", ids.ana).neq("status", "ended").single();
    return data;
  };
  const accept = (pid, { system = true } = {}) => {
    if (ui(CONSENT, "", "exists", 40, pid) !== "OK") throw new Error("no consent window appeared");
    const manager = ui(CONSENT, "ManagerName", "text", 5, pid);
    if (!/Chris Lim/.test(manager)) throw new Error(`consent names "${manager}"`);
    if (ui(CONSENT, "ScreenList", "select0", 5, pid) !== "OK") throw new Error("could not choose a display");
    if (system && ui(CONSENT, "SystemBox", "check", 5, pid) !== "OK") throw new Error("could not tick computer sound");
    if (ui(CONSENT, "StartSharing", "click", 5, pid) !== "OK") throw new Error("could not click Start sharing");
    if (ui(BAR, "", "exists", 15, pid) !== "OK") throw new Error("no sharing bar");
    return manager;
  };
  const open = async id => {
    const started = Date.now();
    await page.goto(`${BASE}/support/${id}${relayQuery}`);
    await waitState(page, ["live", "degraded", "paused"], 45000);
    return Date.now() - started;
  };

  const relayProbe = async label => { if (!RELAY) return; console.log("RELAY PROBE", label, await page.evaluate(async () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: ["turn:192.168.100.28:3478?transport=udp"], username: "kiasa", credential: "relay-test" }], iceTransportPolicy: "relay" }); pc.createDataChannel("x"); const list = []; pc.onicecandidate = e => e.candidate && list.push(e.candidate.type); await pc.setLocalDescription(); await new Promise(r => setTimeout(r, 3000)); pc.close(); return list.join(",") || "none"; })); };
  await page.goto(BASE + "/sign-in");
  await relayProbe("sign-in page");
  await signIn();
  await relayProbe("after sign-in");
  async function signIn() {
    await page.goto(BASE + "/sign-in");
    await hydrated(page, "form");
    await page.getByLabel("Email").fill("chrislim@kiasa.tech");
    await page.getByLabel("Password").fill(people["chrislim@kiasa.tech"].password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
  }

  let pid = startDesk();
  await relayProbe("after the app started");
  await step("a fresh launch of the app shares nothing and shows no sharing bar", async () => {
    await wait(6000);
    if (ui(BAR, "", "exists", 2, pid) === "OK") throw new Error("a bar appeared");
    if (/Support: session .* starting/.test(log())) throw new Error("a session started");
    return "6 s after launch";
  });
  await step("the manager invites; the app asks the member, naming the manager; nothing is captured before Start", async () => {
    session = await invite();
    if (session.status !== "invited") throw new Error(session.status);
    if (ui(CONSENT, "", "exists", 40, pid) !== "OK") throw new Error("no consent window");
    if (/Support: session .* starting|SystemSound:|H264: using/.test(log())) throw new Error("capture began before consent");
    return ui(CONSENT, "ManagerName", "text", 5, pid);
  });
  await relayProbe("before consent");
  await step("the member chooses Display 1 and computer sound, and clicks Start sharing; the bar shows", async () => {
    accept(pid);
    const who = ui(BAR, "SharingWho", "text", 5, pid);
    const { data } = await site.from("support_sessions").select("status, consent").eq("id", session.id).single();
    if (data.status !== "live" || data.consent.system_audio !== true || data.consent.mic !== false) throw new Error(JSON.stringify(data));
    return `${who}; consent ${JSON.stringify(data.consent)}`;
  });
  await relayProbe("after consent");
  let firstLive = 0;
  await step("the manager opens the session and it goes live", async () => {
    firstLive = await open(session.id);
    return `${firstLive} ms from opening the page to live`;
  });
  if (!firstLive) { console.log("FRESH PC IN PAGE", JSON.stringify(await page.evaluate(async () => { const cfg = window.__pcs.at(-1).getConfiguration(); const pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceTransportPolicy: "relay" }); pc.createDataChannel("x"); const list = [], errors = []; pc.onicecandidate = e => e.candidate && list.push(e.candidate.type); pc.onicecandidateerror = e => errors.push(e.errorCode + " " + e.url); await pc.setLocalDescription(); await new Promise(r => setTimeout(r, 4000)); return { list, errors, n: window.__pcs.length }; }))); console.log("ERRORS", [...new Set(errors)].slice(0, 6).join(" | ")); console.log("Not live: the rest would only fail. Stopping.", JSON.stringify(await page.evaluate(async () => Promise.all(window.__pcs.map(async pc => { const c = []; (await pc.getStats()).forEach(s => { if (s.type === "local-candidate" || s.type === "remote-candidate") c.push(`${s.type}:${s.candidateType}:${s.address}:${s.port}`); }); return { sig: pc.signalingState, gather: pc.iceGatheringState, ice: pc.iceConnectionState, local: !!pc.localDescription, localCands: (pc.localDescription?.sdp.match(/a=candidate/g) ?? []).length, remoteCands: (pc.remoteDescription?.sdp.match(/a=candidate/g) ?? []).length, state: pc.connectionState, c }; }))))); killDesk(); await browser.close(); process.exit(1); }
  await step("the member's real screen arrives as H.264 and keeps moving", async () => {
    let first = await picture(page);
    for (let i = 0; i < 30 && first.width === 0; i++) { await wait(500); first = await picture(page); }
    await wait(3000);
    const later = await picture(page);
    if (!first.width || later.frames <= first.frames) throw new Error(JSON.stringify({ first, later }));
    await page.screenshot({ path: path.join(out, "manager-view.png") });
    const encoder = (log().match(/H264: using ([^\n]*)/) || [])[1];
    return `${later.width}×${later.height}, ${((later.frames - first.frames) / 3).toFixed(1)} frames/s decoded, encoder ${encoder}`;
  });
  if (IMPAIR) { await impairMatrix(); killDesk(); await browser.close(); console.log(results.join(String.fromCharCode(10))); process.exit(results.some(r => r.startsWith("FAIL")) ? 1 : 0); }
  async function impairMatrix() {
    const shape = cfg => fetch("http://127.0.0.1:3480/", { method: "POST", body: JSON.stringify({ kbps: 0, delayMs: 0, jitterMs: 0, loss: 0, down: false, ...cfg }) }).then(r => r.json());
    const sample = () => page.evaluate(async () => {
      const pc = window.__pcs.at(-1);
      const o = { at: Date.now() };
      (await pc.getStats()).forEach(s => {
        if (s.type === "inbound-rtp" && s.kind === "video") Object.assign(o, { vBytes: s.bytesReceived, fps: s.framesPerSecond ?? 0, w: s.frameWidth ?? 0, h: s.frameHeight ?? 0, vLost: s.packetsLost, vGot: s.packetsReceived, freezes: s.freezeCount ?? 0 });
        if (s.type === "inbound-rtp" && s.kind === "audio") Object.assign(o, { aBytes: s.bytesReceived, aLost: s.packetsLost, aGot: s.packetsReceived, concealed: s.concealedSamples, samples: s.totalSamplesReceived, jitter: s.jitter });
        if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") o.rtt = s.currentRoundTripTime;
      });
      o.state = document.querySelector("[data-support-state]")?.getAttribute("data-support-state") ?? "ended";
      return o;
    });
    const plan = () => { const m = [...log().matchAll(/plan ([0-9]+) kbit[/]s ([0-9]+) fps scale ([0-9.]+)/g)].at(-1); return m ? `${m[1]} kbit/s ${m[2]} fps ×${m[3]}` : "?"; };
    async function phase(name, cfg, seconds, check) {
      await step(name, async () => {
        await shape(cfg);
        const states = new Set();
        const samples = [];
        const until = Date.now() + seconds * 1000;
        let firstDegraded = null;
        const begun = Date.now();
        while (Date.now() < until) { const s = await sample(); samples.push(s); states.add(s.state); if (!firstDegraded && (s.state === "degraded" || s.state === "reconnecting")) firstDegraded = Date.now() - begun; await wait(2000); }
        // The steady part: the last half.
        const tail = samples.slice(Math.floor(samples.length / 2));
        const a = tail[0], b = tail.at(-1), secs = (b.at - a.at) / 1000;
        const m = {
          videoKbps: Math.round(((b.vBytes - a.vBytes) * 8) / 1000 / secs), audioKbps: Math.round(((b.aBytes - a.aBytes) * 8) / 1000 / secs),
          fps: +(tail.reduce((x, s) => x + (s.fps || 0), 0) / tail.length).toFixed(1), size: `${b.w}×${b.h}`,
          audioLoss: +((b.aLost - a.aLost) / Math.max(1, (b.aLost - a.aLost) + (b.aGot - a.aGot)) * 100).toFixed(1),
          concealed: +((b.concealed - a.concealed) / Math.max(1, b.samples - a.samples) * 100).toFixed(1),
          rtt: b.rtt != null ? Math.round(b.rtt * 1000) : null, freezes: b.freezes - a.freezes,
        };
        const note = `video ${m.videoKbps} kbit/s at ${m.fps} fps ${m.size}, audio ${m.audioKbps} kbit/s, audio lost ${m.audioLoss}%, concealed ${m.concealed}%, rtt ${m.rtt} ms, freezes ${m.freezes}; states seen: ${[...states].join("/")}${firstDegraded != null ? ` (first poor state after ${(firstDegraded / 1000).toFixed(0)} s)` : ""}; sender plan: ${plan()}`;
        fs.appendFileSync(path.join(out, "impair.txt"), `${name}: ${note}${String.fromCharCode(10)}`);
        const problem = check?.(m, states);
        if (problem) throw new Error(`${problem}: ${note}`);
        return note;
      });
    }
    await phase("baseline through the relay, no limit", {}, 20, (m, st) => st.has("live") ? null : "not live");
    await phase("512 kbit/s cap (each hop, both directions)", { kbps: 512 }, 40, m => m.concealed > 10 ? "voice badly broken" : null);
    await phase("256 kbit/s cap", { kbps: 256 }, 40, m => m.concealed > 15 ? "voice badly broken" : null);
    await phase("128 kbit/s cap", { kbps: 128 }, 50, (m, st) => !st.has("degraded") && !st.has("reconnecting") ? "never said it was poor" : null);
    await phase("back to no limit: recovery", {}, 60, (m, st) => [...st].at(-1) === "ended" ? "ended" : null);
    await phase("150 ms delay, 30 ms jitter, 3% loss", { delayMs: 75, jitterMs: 30, loss: 0.03 }, 40, m => m.concealed > 15 ? "voice badly broken" : null);
    await step("10 s outage, then the line comes back", async () => {
      await shape({ down: true });
      const states = new Set();
      for (let i = 0; i < 5; i++) { await wait(2000); states.add((await sample()).state); }
      await shape({});
      const back = Date.now();
      let state = "";
      while (Date.now() - back < 60000) { state = (await sample()).state; if (state === "live" || state === "degraded") break; await wait(1000); }
      const note = `during: ${[...states].join("/")}; back to ${state} ${((Date.now() - back) / 1000).toFixed(1)} s after the line returned`;
      fs.appendFileSync(path.join(out, "impair.txt"), `outage: ${note}${String.fromCharCode(10)}`);
      if (state !== "live" && state !== "degraded") throw new Error(note);
      return note;
    });
    await step("Stop all after the matrix", async () => { ui(BAR, "StopAll", "click", 5, pid); await page.locator("[data-support-ended]").waitFor({ timeout: 15000 }); });
  }
  await step("Details shows the route that was actually chosen", async () => {
    await page.getByRole("button", { name: "Details" }).click();
    const route = page.locator("[data-route]");
    await route.waitFor({ timeout: 8000 });
    await wait(2500);
    const text = await route.innerText();
    if (RELAY && !/relay/.test(text)) throw new Error(text);
    fs.writeFileSync(path.join(out, "route.txt"), text);
    return text;
  });
  await step("the computer's sound reaches the manager (a tone played on this PC)", async () => {
    const tracks = await page.evaluate(() => (document.querySelector("audio[data-support-audio]")?.srcObject?.getTracks() ?? []).map(t => `${t.kind}:${t.readyState}:${t.muted ? "muted" : "unmuted"}`).join(","));
    const playing = tone(6000);
    await wait(1500);
    const level = await heardLevel(page);
    await playing;
    const sound = await page.evaluate(async () => {
      const pc = window.__pcs.at(-1);
      let line = "";
      (await pc.getStats()).forEach(s => { if (s.type === "inbound-rtp" && s.kind === "audio") line = `energy ${s.totalAudioEnergy?.toFixed(4)}, level ${s.audioLevel}, samples ${s.totalSamplesReceived}, concealed ${s.concealedSamples}, packets ${s.packetsReceived}, codec ${s.codecId}`; });
      return line;
    });
    if (!(level > 3)) throw new Error(`level ${level}; tracks ${tracks}; details: ${sound}`);
    return `peak ${level}/128; ${sound}`;
  });
  await step("each sound is switched on its own: microphone on, computer sound off, and the manager sees it", async () => {
    ui(BAR, "Microphone", "toggle", 5, pid);
    await waitSources(page, /microphone on/);
    ui(BAR, "SystemSound", "toggle", 5, pid);
    const text = await waitSources(page, /computer sound off.*microphone on/);
    ui(BAR, "Microphone", "toggle", 5, pid);
    ui(BAR, "SystemSound", "toggle", 5, pid);
    await waitSources(page, /computer sound on.*microphone off/);
    return text.replace(/\s+/g, " ");
  });
  await step("the manager talks: their voice reaches the app and is played", async () => {
    await page.getByRole("button", { name: /Talk/ }).click();
    const until = Date.now() + 25000;
    let packets = 0;
    while (Date.now() < until && packets === 0) { await wait(1000); packets = Math.max(0, ...[...log().matchAll(/voice packets (\d+)/g)].map(m => Number(m[1]))); }
    await page.getByRole("button", { name: /Mute my microphone/ }).click();
    if (!packets) throw new Error("no voice packets reached the app");
    return `${packets} voice packets by the last diagnostics line`;
  });
  await step("pausing the screen stops the picture and says so; sound stays on", async () => {
    ui(BAR, "PauseScreen", "toggle", 5, pid);
    await waitState(page, ["paused"], 10000);
    const a = await picture(page);
    await wait(2500);
    const b = await picture(page);
    const text = await sources(page);
    ui(BAR, "PauseScreen", "toggle", 5, pid);
    await waitState(page, ["live", "degraded"], 15000);
    if (b.frames - a.frames > 3) throw new Error(`${b.frames - a.frames} frames while paused`);
    if (!/computer sound on/.test(text)) throw new Error(text);
    return `${b.frames - a.frames} frames in 2.5 s while paused`;
  });
  await step("the manager's page closes and opens again: a new seat, the app reconnects", async () => {
    await page.goto(BASE + "/support");
    await wait(4000);
    const state = ui(BAR, "SharingState", "text", 5, pid);
    const again = await open(session.id);
    return `bar said "${state}" while away; live again in ${again} ms`;
  });
  await step("Stop all ends everything: capture released at once, the manager's view closes", async () => {
    const before = log().length;
    const clicked = Date.now();
    ui(BAR, "StopAll", "click", 5, pid);
    await page.locator("[data-support-ended]").waitFor({ timeout: 15000 });
    const closed = Date.now() - clicked;
    if (ui(BAR, "", "gone", 5, pid) !== "GONE") throw new Error("the bar is still there");
    const tail = log().slice(before);
    if (!/Support: stopping \(member_stopped\)/.test(tail)) throw new Error("no stop in the log");
    const { data } = await site.from("support_sessions").select("status, end_reason").eq("id", session.id).single();
    if (data.status !== "ended" || data.end_reason !== "member_stopped") throw new Error(JSON.stringify(data));
    return `manager's view closed ${closed} ms after Stop all; database: ${data.end_reason}`;
  });
  await step("after Stop, a late or replayed join cannot restart anything", async () => {
    const admin = createClient(env.url, env.publishable, { auth: { persistSession: false } });
    await admin.auth.signInWithPassword({ email: "chrislim@kiasa.tech", password: people["chrislim@kiasa.tech"].password });
    await admin.realtime.setAuth();
    const status = await new Promise(resolve => {
      const channel = admin.channel(`support:${session.id}`, { config: { private: true } });
      const timer = setTimeout(() => resolve("no answer"), 10000);
      channel.subscribe((s, e) => { if (s !== "CLOSED") { clearTimeout(timer); resolve(`${s}${e ? `: ${e.message}` : ""}`); } });
    });
    const join = await admin.rpc("support_join", { session: session.id });
    await wait(3000);
    if (status === "SUBSCRIBED" || !join.error) throw new Error(`channel ${status}, join ${join.error ? "refused" : "allowed"}`);
    if (ui(BAR, "", "exists", 2, pid) === "OK") throw new Error("sharing restarted");
    return `channel: ${status.slice(0, 40)}; join refused`;
  });

  if (GRACE) await step("the manager leaves without ending: the app waits 2 minutes, then ends (manager_gone)", async () => {
    session = await invite();
    accept(pid, { system: false });
    await open(session.id);
    await page.goto(BASE + "/support");
    const started = Date.now();
    const gone = ui(BAR, "", "gone", 150, pid);
    const { data } = await site.from("support_sessions").select("status, end_reason").eq("id", session.id).single();
    if (gone !== "GONE" || data.end_reason !== "manager_gone") throw new Error(`${gone} ${JSON.stringify(data)}`);
    return `ended ${Math.round((Date.now() - started) / 1000)} s after the manager left`;
  });

  await step("the app is killed while sharing, then started again: the session is ended, never resumed", async () => {
    session = await invite();
    accept(pid, { system: false });
    await open(session.id);
    killDesk();
    await wait(1000);
    pid = startDesk();
    const until = Date.now() + 30000;
    let row;
    while (Date.now() < until) { row = (await site.from("support_sessions").select("status, end_reason").eq("id", session.id).single()).data; if (row.status === "ended") break; await wait(1000); }
    if (row.status !== "ended" || row.end_reason !== "app_restart") throw new Error(JSON.stringify(row));
    await page.locator("[data-support-ended]").waitFor({ timeout: 20000 });
    if (ui(BAR, "", "exists", 3, pid) === "OK") throw new Error("a bar appeared after restart");
    return "ended as app_restart; the manager's view closed; no bar";
  });

  await step("Stop all with KIASA unreachable: capture stops at once; the end is written when KIASA is back", async () => {
    session = await invite();
    accept(pid, { system: true });
    await open(session.id);
    execSync("docker stop supabase_kong_web", { stdio: "ignore" });
    const before = log().length;
    const clicked = Date.now();
    ui(BAR, "StopAll", "click", 5, pid);
    const gone = ui(BAR, "", "gone", 5, pid);
    const tookMs = Date.now() - clicked;
    const tail = log().slice(before);
    if (gone !== "GONE" || !/Support: stopping/.test(tail)) { execSync("docker start supabase_kong_web", { stdio: "ignore" }); throw new Error(`${gone}, log: ${tail.slice(0, 200)}`); }
    await wait(15000); // the app's three tries fail, and it keeps the id
    const pending = fs.existsSync(path.join(data, "pending-end.txt"));
    execSync("docker start supabase_kong_web", { stdio: "ignore" });
    await wait(8000);
    killDesk();
    pid = startDesk();
    const until = Date.now() + 40000;
    let row;
    while (Date.now() < until) { row = (await site.from("support_sessions").select("status, end_reason").eq("id", session.id).single()).data; if (row?.status === "ended") break; await wait(1000); }
    if (row?.status !== "ended") throw new Error(`still ${row?.status}`);
    return `bar gone ${tookMs} ms after the click (incl. UI Automation), pending end kept: ${pending}, written later as ${row.end_reason}`;
  });

  killDesk();
  await browser.close();
  fs.copyFileSync(path.join(data, "log.txt"), path.join(out, "desk-log.txt"));
  console.log("\n" + results.join("\n"));
  if (errors.length) console.log("\nPage errors:\n" + [...new Set(errors)].slice(0, 15).join("\n"));
  const failed = results.filter(line => line.startsWith("FAIL")).length;
  console.log(failed ? `${failed} FAILED` : "ALL PASSED", `\nEvidence: ${out}`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); killDesk(); process.exit(1); });
