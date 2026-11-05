// End-to-end test of a member sharing their computer's sound with KIASA's admins, against
// the LOCAL Supabase copy: real browsers, a real connection between them, and a steady tone
// standing in for the computer's sound, so what arrives can be measured. Prints PASS/FAIL
// per step. Usage, from apps/web: npx supabase start; npm run chat:local:seed; serve a build
// made with the local copy's keys on port 3002 (see docs/site.md); npm run sound:local:e2e.
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const { execSync } = require("child_process");
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
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const out = path.join(os.tmpdir(), "kiasa-sound-e2e");
const BASE = "http://127.0.0.1:3002";
fs.mkdirSync(out, { recursive: true });
const results = [];
const errors = [];
async function step(name, fn) {
  const started = Date.now();
  try { const note = await fn(); results.push(`PASS  ${name}${note ? ` (${note})` : ""} [${Date.now() - started} ms]`); }
  catch (error) { results.push(`FAIL  ${name}: ${error.message.split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "")}`); }
}
const hydrated = (page, selector) => page.waitForFunction(selector => {
  const node = document.querySelector(selector);
  return !!node && Object.keys(node).some(key => key.startsWith("__react"));
}, selector, { timeout: 20000 });
const watch = (page, label) => {
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  page.on("console", message => { if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) errors.push(`${label} console: ${message.text().slice(0, 200)}`); });
};
async function signIn(browser, email, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  // The browser's share answered with a moving picture and a steady tone (or, with
  // window.__noSound, no sound: the member left the box unticked).
  await context.addInitScript(() => {
    if (window.__realShare) return;
    window.__asked = [];
    navigator.mediaDevices.getDisplayMedia = async options => {
      window.__asked.push(JSON.parse(JSON.stringify(options)));
      const canvas = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
      const draw = canvas.getContext("2d");
      setInterval(() => { draw.fillStyle = `hsl(${(Date.now() / 10) % 360} 70% 50%)`; draw.fillRect(0, 0, 640, 360); }, 50);
      const shared = canvas.captureStream(15);
      if (!window.__noSound) {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const sink = audio.createMediaStreamDestination();
        tone.connect(sink);
        tone.start();
        shared.addTrack(sink.stream.getAudioTracks()[0]);
      }
      window.__shared = shared;
      return shared;
    };
  });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(BASE + "/sign-in");
  await hydrated(page, "form");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(people[email].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
  return { context, page, label };
}
/** How loud what this admin hears is, over three seconds. */
const heardLevel = page => page.evaluate(async () => {
  const element = document.querySelector("audio[data-sound-heard]");
  if (!element?.srcObject?.getAudioTracks().length) return null;
  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 2048;
  audio.createMediaStreamSource(new MediaStream(element.srcObject.getAudioTracks())).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let peak = 0;
  for (let look = 0; look < 30; look++) {
    await new Promise(done => setTimeout(done, 100));
    analyser.getByteTimeDomainData(data);
    for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
  }
  await audio.close();
  return peak;
});
const hears = async (page, who) => {
  let peak = null;
  for (let look = 0; look < 6 && !(peak > 5); look++) peak = await heardLevel(page);
  if (!(peak > 5)) throw new Error(`${who} does not hear the sound (${peak})`);
  return peak;
};
const row = (page, name) => page.locator(".live-now-person", { hasText: name });
const notice = page => page.locator(".sound-bar", { hasText: "Your computer's sound is shared" });
const listenBar = page => page.locator(".sound-bar[data-listening]");
const shareButton = page => page.getByRole("button", { name: "Share sound", exact: true });
const stopButton = page => page.getByRole("button", { name: "Stop sharing", exact: true });
/** A member's own connection to the database, for what a page would never offer. */
async function asPerson(email) {
  const client = createClient(env.url, env.publishable, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: people[email].password });
  await client.realtime.setAuth();
  return client;
}
const joinStatus = (client, topic) => new Promise(resolve => {
  const channel = client.channel(topic, { config: { private: true } });
  channel.subscribe((state, error) => { if (state !== "CLOSED") resolve(`${state}${error ? `: ${error.message}` : ""}`); });
  setTimeout(() => resolve("no answer"), 10000);
});

(async () => {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const ids = { admin: people["chrislim@kiasa.tech"].id, ana: people["ana@example.com"].id, ben: people["ben@example.com"].id };
  await site.from("sound_shares").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");
  const wake = site.channel("wake").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {});
  await new Promise(resolve => wake.subscribe(status => { if (status !== "CLOSED") resolve(); }));
  await new Promise(done => setTimeout(done, 3000));
  await site.removeChannel(wake);

  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  let admin, ana, ben;

  await step("members have the Share sound button on their pages; the admin has the Live sounds tab, and no button", async () => {
    [admin, ana, ben] = await Promise.all([signIn(browser, "chrislim@kiasa.tech", "admin"), signIn(browser, "ana@example.com", "ana"), signIn(browser, "ben@example.com", "ben")]);
    await Promise.all([ana.page.goto(BASE + "/jobs"), ben.page.goto(BASE + "/chat"), admin.page.goto(BASE + "/admin/sounds")]);
    await Promise.all([hydrated(ana.page, ".app-bar"), hydrated(admin.page, ".app-bar")]);
    await shareButton(ana.page).waitFor({ timeout: 10000 });
    await admin.page.getByRole("heading", { name: "Live sounds" }).waitFor({ timeout: 10000 });
    if (await shareButton(admin.page).count()) throw new Error("the admin has the button");
    if (await ana.page.getByRole("link", { name: "Live sounds" }).count()) throw new Error("Ana has the Live sounds tab");
    await admin.page.getByText("No one is sharing their sound.").waitFor({ timeout: 10000 });
    await ana.page.screenshot({ path: path.join(out, "member-button.png") });
    await admin.page.screenshot({ path: path.join(out, "admin-empty.png") });
  });

  await step("a member with no sound chosen in the picker: nothing is shared, and they are told what to turn on", async () => {
    await ana.page.evaluate(() => { window.__noSound = true; });
    await shareButton(ana.page).click();
    await ana.page.locator(".sound-bar[data-problem]", { hasText: "No sound was shared" }).waitFor({ timeout: 5000 });
    if (await notice(ana.page).count()) throw new Error("it says it is shared");
    if (await ana.page.evaluate(() => window.__shared.getTracks().some(track => track.readyState === "live"))) throw new Error("the picture was left running");
    const { data } = await site.from("sound_shares").select("user_id");
    if (data.length) throw new Error("a row says it is shared");
    await ana.page.evaluate(() => { window.__noSound = false; });
    await ana.page.locator(".sound-bar[data-problem]").getByRole("button", { name: "Close" }).click();
  });

  await step("Ana clicks Share sound: she is told on the page, and she shows on the admin's list at once", async () => {
    const at = Date.now();
    await shareButton(ana.page).click();
    await notice(ana.page).waitFor({ timeout: 10000 });
    await stopButton(ana.page).waitFor({ timeout: 5000 });
    await row(admin.page, "Ana Silva").waitFor({ timeout: 10000 });
    const asked = await ana.page.evaluate(() => window.__asked.at(-1));
    if (asked.audio?.restrictOwnAudio !== true || asked.systemAudio !== "include") throw new Error(`asked the browser for ${JSON.stringify(asked)}`);
    await ana.page.screenshot({ path: path.join(out, "member-sharing.png") });
    return `on the admin's list ${Date.now() - at} ms after the click`;
  });

  await step("the admin clicks Listen: the sound arrives, measured; no picture travels", async () => {
    const at = Date.now();
    await row(admin.page, "Ana Silva").click();
    await listenBar(admin.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 20000 });
    const connected = Date.now() - at;
    const peak = await hears(admin.page, "the admin");
    await listenBar(admin.page).filter({ hasText: "sound arriving" }).waitFor({ timeout: 8000 });
    const pictures = await admin.page.evaluate(() => document.querySelector("audio[data-sound-heard]").srcObject.getVideoTracks().length);
    if (pictures) throw new Error(`${pictures} pictures arrived`);
    await admin.page.screenshot({ path: path.join(out, "admin-listening.png") });
    return `connected in ${connected} ms; level ${peak}`;
  });

  await step("only admins: another member cannot join the channel, read who shares, or say it for someone else; nor can someone signed out", async () => {
    const asBen = await asPerson("ben@example.com");
    const topic = `sound:${ids.ana}`;
    const joined = await joinStatus(asBen, topic);
    if (joined.startsWith("SUBSCRIBED")) throw new Error("Ben joined the channel of Ana's sound");
    const seen = await asBen.from("sound_shares").select("user_id");
    if (seen.data?.length) throw new Error("Ben can read who shares sound");
    const faked = await asBen.from("sound_shares").upsert({ user_id: ids.ana });
    if (!faked.error) throw new Error("Ben said it for Ana");
    const anonymous = createClient(env.url, env.publishable, { auth: { persistSession: false } });
    const stranger = await joinStatus(anonymous, topic);
    if (stranger.startsWith("SUBSCRIBED")) throw new Error("someone signed out joined the channel");
    const peek = await anonymous.from("sound_shares").select("user_id");
    if (peek.data?.length) throw new Error("someone signed out can read who shares sound");
    // The page itself refuses him too.
    await ben.page.goto(BASE + "/admin/sounds");
    await ben.page.waitForLoadState("networkidle").catch(() => {});
    if (await ben.page.getByRole("heading", { name: "Live sounds" }).count()) throw new Error("Ben opened Live sounds");
    return `Ben: ${joined.slice(0, 60)}; signed out: ${stranger.slice(0, 40)}`;
  });

  await step("Ana moves around KIASA: her sound keeps going, and the notice follows her; the admin moves too, and keeps hearing", async () => {
    await ana.page.getByRole("link", { name: "Chat", exact: true }).click();
    await ana.page.waitForURL(/\/chat/, { timeout: 15000 });
    await notice(ana.page).waitFor({ timeout: 5000 });
    await ana.page.getByRole("link", { name: "Interview", exact: true }).click();
    await ana.page.waitForURL(/\/interview/, { timeout: 15000 });
    await notice(ana.page).waitFor({ timeout: 5000 });
    await admin.page.getByRole("link", { name: "Teams", exact: true }).click();
    await admin.page.waitForURL(/\/admin\/teams/, { timeout: 15000 });
    await listenBar(admin.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 5000 });
    const peak = await hears(admin.page, "the admin, on another page");
    await admin.page.getByRole("link", { name: "Live sounds", exact: true }).click();
    await admin.page.waitForURL(/\/admin\/sounds/, { timeout: 15000 });
    return `level ${peak}`;
  });

  await step("a second admin window listens at the same time: both hear", async () => {
    const second = await signIn(browser, "chrislim@kiasa.tech", "admin 2");
    await second.page.goto(BASE + "/admin/sounds");
    await hydrated(second.page, ".app-bar");
    await row(second.page, "Ana Silva").click();
    await listenBar(second.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 20000 });
    const [one, two] = await Promise.all([hears(admin.page, "the first"), hears(second.page, "the second")]);
    // One stops; the other carries on.
    await listenBar(second.page).getByRole("button", { name: "Stop" }).click();
    await listenBar(second.page).waitFor({ state: "detached", timeout: 5000 });
    const still = await hears(admin.page, "the first, after the second stopped");
    await second.context.close();
    return `levels ${one} and ${two}, then ${still}`;
  });

  await step("the admin stops listening and listens again; a reload of the admin's page and they can listen again", async () => {
    await listenBar(admin.page).getByRole("button", { name: "Stop" }).click();
    await listenBar(admin.page).waitFor({ state: "detached", timeout: 5000 });
    await row(admin.page, "Ana Silva").click();
    await listenBar(admin.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 20000 });
    const again = await hears(admin.page, "the admin, listening again");
    await admin.page.reload();
    await hydrated(admin.page, ".app-bar");
    await row(admin.page, "Ana Silva").click();
    await listenBar(admin.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 20000 });
    return `level ${again}, then ${await hears(admin.page, "the admin, after reloading")}`;
  });

  await step("Ana clicks Stop: the admin is told at once, she goes from the list, and the channel no longer lets the admin in", async () => {
    const at = Date.now();
    await notice(ana.page).getByRole("button", { name: "Stop" }).click();
    await notice(ana.page).waitFor({ state: "detached", timeout: 5000 });
    await shareButton(ana.page).waitFor({ timeout: 5000 });
    await listenBar(admin.page).filter({ hasText: "Ana Silva stopped sharing" }).waitFor({ timeout: 10000 });
    const told = Date.now() - at;
    await row(admin.page, "Ana Silva").waitFor({ state: "detached", timeout: 10000 });
    await admin.page.screenshot({ path: path.join(out, "admin-stopped.png") });
    await listenBar(admin.page).getByRole("button", { name: "Close" }).click();
    if (await ana.page.evaluate(() => window.__shared.getTracks().some(track => track.readyState === "live"))) throw new Error("her share was left running");
    const asAdmin = await asPerson("chrislim@kiasa.tech");
    const joined = await joinStatus(asAdmin, `sound:${ids.ana}`);
    if (joined.startsWith("SUBSCRIBED")) throw new Error("the admin can still join her channel");
    return `told in ${told} ms`;
  });

  await step("the browser's own Stop bar ends it just the same", async () => {
    await shareButton(ana.page).click();
    await notice(ana.page).waitFor({ timeout: 10000 });
    await row(admin.page, "Ana Silva").click();
    await listenBar(admin.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 20000 });
    await ana.page.evaluate(() => { const [video] = window.__shared.getVideoTracks(); video.stop(); video.dispatchEvent(new Event("ended")); });
    await notice(ana.page).waitFor({ state: "detached", timeout: 5000 });
    await listenBar(admin.page).filter({ hasText: "stopped sharing" }).waitFor({ timeout: 10000 });
    await listenBar(admin.page).getByRole("button", { name: "Close" }).click();
    await row(admin.page, "Ana Silva").waitFor({ state: "detached", timeout: 10000 });
  });

  await step("Ana reloads while sharing: it stops (only a click can start it), she is told, and the admin is told", async () => {
    await shareButton(ana.page).click();
    await notice(ana.page).waitFor({ timeout: 10000 });
    await row(admin.page, "Ana Silva").click();
    await listenBar(admin.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 20000 });
    const at = Date.now();
    await ana.page.reload();
    await hydrated(ana.page, ".app-bar");
    await ana.page.locator(".sound-bar[data-problem]", { hasText: "stopped, because this page was reloaded" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".sound-bar[data-problem]").getByRole("button", { name: "Close" }).click();
    await listenBar(admin.page).filter({ hasText: "stopped sharing" }).waitFor({ timeout: 40000 });
    const told = Date.now() - at;
    await listenBar(admin.page).getByRole("button", { name: "Close" }).click();
    await row(admin.page, "Ana Silva").waitFor({ state: "detached", timeout: 15000 });
    return `the admin told in ${told} ms`;
  });

  await step("Ana closes her tab while sharing: she goes from the list by herself, and the admin is told", async () => {
    await shareButton(ana.page).click();
    await notice(ana.page).waitFor({ timeout: 10000 });
    await row(admin.page, "Ana Silva").click();
    await listenBar(admin.page).filter({ hasText: "Listening to Ana Silva" }).waitFor({ timeout: 20000 });
    const at = Date.now();
    await ana.page.close();
    await listenBar(admin.page).filter({ hasText: "stopped sharing" }).waitFor({ timeout: 120000 });
    const told = Date.now() - at;
    await listenBar(admin.page).getByRole("button", { name: "Close" }).click();
    await row(admin.page, "Ana Silva").waitFor({ state: "detached", timeout: 110000 });
    return `told in ${told} ms, gone from the list ${Date.now() - at} ms after closing`;
  });

  await step("Ana signs out while sharing: it stops by itself", async () => {
    ana.page = await ana.context.newPage();
    watch(ana.page, "ana again");
    await ana.page.goto(BASE + "/jobs");
    await hydrated(ana.page, ".app-bar");
    await shareButton(ana.page).click();
    await notice(ana.page).waitFor({ timeout: 10000 });
    await ana.page.getByRole("button", { name: /^Signed in as/ }).click();
    await ana.page.getByRole("menuitem", { name: "Sign out" }).click();
    await ana.page.getByRole("button", { name: "Sign out", exact: true }).click();
    await notice(ana.page).waitFor({ state: "detached", timeout: 30000 });
    if (await ana.page.evaluate(() => window.__shared.getTracks().some(track => track.readyState === "live"))) throw new Error("her share was left running");
    await row(admin.page, "Ana Silva").waitFor({ state: "detached", timeout: 100000 });
  });

  await step("the browser's real share call takes what KIASA asks for (with Chrome's automatic picker)", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    watch(page, "real share");
    await page.goto(BASE + "/sign-in");
    await hydrated(page, "form");
    await page.getByLabel("Email").fill("ben@example.com");
    await page.getByLabel("Password").fill(people["ben@example.com"].password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
    await page.goto(BASE + "/jobs");
    await hydrated(page, ".app-bar");
    await shareButton(page).click();
    // Whether this test browser offers sound depends on the computer: either it shares, or it says no sound was chosen. Never "this browser cannot".
    const said = await Promise.race([
      notice(page).waitFor({ timeout: 20000 }).then(() => "shared"),
      page.locator(".sound-bar[data-problem]").waitFor({ timeout: 20000 }).then(() => page.locator(".sound-bar[data-problem]").innerText()),
    ]);
    if (/cannot share/.test(said)) throw new Error(said);
    if (said === "shared") await notice(page).getByRole("button", { name: "Stop" }).click();
    await context.close();
    return said === "shared" ? "shared, with real system sound offered" : "no sound offered to this test browser, and it says so";
  });

  console.log(results.join("\n"));
  console.log("page errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  await site.from("sound_shares").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");
  process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
})().catch(error => { console.log(results.join("\n")); console.error("stopped:", error.message); process.exit(1); });
