// End-to-end test of KIASA meetings against the LOCAL Supabase copy: the admin,
// Ana and Ben in their own browsers, with Chrome's made-up camera and
// microphone (a moving picture and a beep), really calling each other. Prints
// PASS/FAIL per step and how long each connection took. Usage, from apps/web:
// npx supabase start; npm run chat:local:seed; serve a build made with the
// local copy's keys on port 3002 (see docs/site.md); then npm run meet:local:e2e.
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
const out = path.join(os.tmpdir(), "kiasa-meet-e2e");
const BASE = "http://127.0.0.1:3002";
fs.mkdirSync(out, { recursive: true });
const results = [];
const errors = [];
async function step(name, fn) {
  const started = Date.now();
  try { const note = await fn(); results.push(`PASS  ${name}${note ? ` (${note})` : ""} [${Date.now() - started} ms]`); }
  catch (error) {
    const lines = error.message.split("\n").map(line => line.replace(/\x1b\[[0-9;]*m/g, "").trim());
    const waited = lines.find(line => /^- waiting for/.test(line)) ?? "";
    results.push(`FAIL  ${name}: ${lines[0]}${waited ? ` | ${waited}` : ""}`);
  }
}
const hydrated = (page, selector) => page.waitForFunction(selector => {
  const node = document.querySelector(selector);
  return !!node && Object.keys(node).some(key => key.startsWith("__react"));
}, selector, { timeout: 20000 });
const watch = (page, label) => {
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  page.on("console", message => { if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) errors.push(`${label} console: ${message.text().slice(0, 160)}`); });
};
async function signIn(browser, email, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
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
/** On a meeting's page: the waiting screen, then in. */
async function join(page, shot) {
  await hydrated(page, ".meet");
  const button = page.getByRole("button", { name: /^(Join now|Start the meeting)$/ });
  await button.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll(".meet-lobby-actions button")][0]; return b && !b.disabled; }, null, { timeout: 20000 });
  if (shot) await page.screenshot({ path: path.join(out, shot) });
  await button.click();
  await page.locator(".meet-controls").waitFor({ timeout: 10000 });
}
/** A member on a meeting's waiting screen asks to join; the admin's page shows
 * them asking, and lets them in (or, with `deny`, turns them away). */
async function askIn(page, admin, name, { shot, deny } = {}) {
  await hydrated(page, ".meet");
  await page.waitForFunction(() => { const b = [...document.querySelectorAll(".meet-lobby-actions button")][0]; return b && !b.disabled; }, null, { timeout: 20000 });
  if (shot) await page.screenshot({ path: path.join(out, shot) });
  await page.getByRole("button", { name: /^(Ask to join|Ask again)$/ }).click();
  await page.locator(".meet-lobby-wait", { hasText: "Waiting to be let in" }).waitFor({ timeout: 10000 });
  const knock = admin.locator(".meet-knock", { hasText: name });
  await knock.waitFor({ timeout: 10000 });
  if (shot) await admin.screenshot({ path: path.join(out, "asking.png") });
  if (deny) {
    await knock.getByRole("button", { name: "Deny" }).click();
    await page.getByText("You were not let in, or were taken out of this meeting.").waitFor({ timeout: 10000 });
    return;
  }
  await knock.getByRole("button", { name: "Admit" }).click();
  await page.locator(".meet-controls").waitFor({ timeout: 10000 });
  await knock.waitFor({ state: "detached", timeout: 10000 });
}
// Waits until this many faces on the page show a moving picture; if they never
// do, says what each face shows instead.
const waitMoving = (page, count) => page.waitForFunction(count =>
  [...document.querySelectorAll(".meet-faces [data-tile] video")].filter(video => video.videoWidth > 0 && !video.paused).length >= count, count, { polling: 50, timeout: 30000 })
  .catch(async () => {
    const seen = await page.evaluate(() => [...document.querySelectorAll(".meet-faces [data-tile]")].map(tile => {
      const video = tile.querySelector("video");
      const tracks = video?.srcObject?.getTracks().map(track => `${track.kind}:${track.readyState}${track.muted ? ":muted" : ""}`).join("+");
      return `${tile.dataset.name} [${tile.dataset.link ?? "own"}, camera ${tile.dataset.camera}${tile.querySelector(".meet-link") ? `, ${tile.querySelector(".meet-link").textContent}` : ""}]`
        + (video ? ` video ${video.videoWidth}x${video.videoHeight} ${video.paused ? "paused" : "playing"} ready ${video.readyState} (${tracks})` : " no video");
    }).join("; "));
    throw new Error(`${count} moving pictures never showed: ${seen}`);
  });
const tile = (page, name) => page.locator(".meet-faces [data-tile]", { has: page.locator(".meet-name", { hasText: name }) });

(async () => {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const ids = { admin: people["chrislim@kiasa.tech"].id, ana: people["ana@example.com"].id, ben: people["ben@example.com"].id };
  // A group of the three for this test, and one without Ben (to show the database keeps him out of it).
  await site.from("chats").delete().in("title", ["Meeting test", "Without Ben"]);
  const { data: group } = await site.from("chats").insert({ kind: "group", title: "Meeting test", created_by: ids.admin }).select("id").single();
  const { data: apart } = await site.from("chats").insert({ kind: "group", title: "Without Ben", created_by: ids.admin }).select("id").single();
  const { error: unjoined } = await site.from("chat_members").insert([
    { chat_id: group.id, user_id: ids.admin, name: "Chris Lim", role: "owner" }, { chat_id: group.id, user_id: ids.ana, name: "Ana Silva", role: "member" },
    { chat_id: group.id, user_id: ids.ben, name: "Ben Okoro", role: "member" },
    { chat_id: apart.id, user_id: ids.admin, name: "Chris Lim", role: "owner" }, { chat_id: apart.id, user_id: ids.ana, name: "Ana Silva", role: "member" },
  ]);
  if (unjoined) throw new Error(`the test groups: ${unjoined.message}`);
  // The local realtime server sleeps when no one is connected: woken first.
  const wake = site.channel("wake").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {});
  await new Promise(resolve => wake.subscribe(status => { if (status !== "CLOSED") resolve(); }));
  await new Promise(done => setTimeout(done, 3000));
  await site.removeChannel(wake);

  // Chrome's made-up camera and microphone, allowed without asking; the same for sharing a screen.
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--autoplay-policy=no-user-gesture-required",
      // Test browsers on one computer: their own addresses, not .local names they cannot resolve for each other.
      "--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  let admin, ana, ben, adminMeet, anaMeet, benMeet, meetingId;

  await step("the admin starts a meeting from the group's bar; it opens in its own tab", async () => {
    [admin, ana, ben] = await Promise.all([signIn(browser, "chrislim@kiasa.tech", "admin"), signIn(browser, "ana@example.com", "ana"), signIn(browser, "ben@example.com", "ben")]);
    await Promise.all([admin.page.goto(BASE + "/chat"), ana.page.goto(BASE + "/chat")]);
    await Promise.all([hydrated(admin.page, ".chat"), hydrated(ana.page, ".chat")]);
    await ana.page.waitForTimeout(2500);
    await admin.page.locator(".chat-row", { hasText: "Meeting test" }).first().click();
    await admin.page.getByRole("button", { name: "Start or schedule a meeting" }).click();
    await admin.page.getByLabel("Title").fill("Weekly team meeting");
    const opened = admin.context.waitForEvent("page");
    await admin.page.getByRole("button", { name: "Start meeting" }).click();
    adminMeet = await opened;
    watch(adminMeet, "admin meet");
    await adminMeet.waitForURL(/\/meet\/[0-9a-f-]{36}$/, { timeout: 15000 });
    meetingId = adminMeet.url().split("/").pop();
    await join(adminMeet);
  });

  await step("Ana's chat rings; she asks to join from it, the admin lets her in, and they see and hear each other", async () => {
    await ana.page.locator(".chat-ringing").waitFor({ timeout: 10000 });
    const opened = ana.context.waitForEvent("page");
    await ana.page.locator(".chat-ringing").getByRole("link", { name: "Join" }).click();
    anaMeet = await opened;
    watch(anaMeet, "ana meet");
    await askIn(anaMeet, adminMeet, "Ana Silva", { shot: "waiting.png" });
    const at = Date.now();
    await Promise.all([waitMoving(adminMeet, 2), waitMoving(anaMeet, 2)]);
    const voices = await anaMeet.evaluate(() => [...document.querySelectorAll("audio[data-voice]")].filter(audio => !audio.muted && audio.srcObject?.getAudioTracks().some(track => track.readyState === "live")).length);
    if (voices !== 1) throw new Error(`Ana hears ${voices} voices`);
    return `both pictures moving ${Date.now() - at} ms after she was in`;
  });

  await step("Ben opens the meeting's address and asks: turned away once, he asks again and is let in; all three see the other two", async () => {
    benMeet = await ben.context.newPage();
    watch(benMeet, "ben meet");
    await benMeet.goto(BASE + `/meet/${meetingId}`);
    await askIn(benMeet, adminMeet, "Ben Okoro", { deny: true });
    // Turned away, he is in no one's meeting.
    if (await anaMeet.locator(".meet-faces [data-tile]").count() !== 2) throw new Error("Ben shows in Ana's meeting while turned away");
    await askIn(benMeet, adminMeet, "Ben Okoro");
    const at = Date.now();
    await Promise.all([waitMoving(adminMeet, 3), waitMoving(anaMeet, 3), waitMoving(benMeet, 3)]);
    await benMeet.screenshot({ path: path.join(out, "three.png") });
    return `every picture moving ${Date.now() - at} ms after he was in`;
  });

  await step("Details on Ana's tile: the route, her sound arriving and played, the admin's voice going to her", async () => {
    const face = tile(adminMeet, "Ana Silva");
    await face.getByRole("button", { name: "Details" }).click();
    const details = face.locator(".meet-details");
    await details.locator("div", { hasText: "Route" }).locator("dd", { hasText: /direct|relay/ }).waitFor({ timeout: 10000 });
    await details.locator("div", { hasText: "Played here" }).locator("dd", { hasText: "yes" }).waitFor({ timeout: 10000 });
    await adminMeet.waitForFunction(() => {
      const rows = Object.fromEntries([...document.querySelectorAll(".meet-details div")].map(row => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]));
      return /B|KB|MB/.test(rows["Ana's sound arriving"] ?? "") && /B|KB|MB/.test(rows["Your voice going to Ana"] ?? "");
    }, null, { timeout: 10000 });
    const text = (await details.innerText()).replace(/s+/g, " ");
    await face.screenshot({ path: path.join(out, "details.png") });
    await face.getByRole("button", { name: "Close details" }).click();
    return text;
  });

  await step("the admin chooses another microphone from the list: Ana keeps hearing, and Details names it, working", async () => {
    await adminMeet.getByRole("button", { name: "Choose microphone" }).click();
    const list = adminMeet.getByRole("menu", { name: "Microphones" });
    await list.getByRole("menuitemradio").first().waitFor({ timeout: 10000 });
    const names = await list.getByRole("menuitemradio").allInnerTexts();
    const now = await list.getByRole("menuitemradio", { checked: true }).innerText().catch(() => "");
    const other = names.find(name => name.trim() !== now.trim()) ?? names[0];
    await list.getByRole("menuitemradio", { name: other.trim() }).click();
    const face = tile(adminMeet, "Ana Silva");
    await face.getByRole("button", { name: "Details" }).click();
    const sentNow = () => adminMeet.evaluate(() => Object.fromEntries([...document.querySelectorAll(".meet-details div")].map(row => [row.querySelector("dt").textContent, row.querySelector("dd").textContent])));
    await adminMeet.waitForFunction(name => [...document.querySelectorAll(".meet-details div")].some(row => row.querySelector("dt").textContent === "Your microphone" && row.querySelector("dd").textContent.includes(name) && row.querySelector("dd").textContent.includes("working")), other.trim(), { timeout: 10000 });
    const first = (await sentNow())["Your voice going to Ana"];
    await adminMeet.waitForTimeout(4500);
    const later = (await sentNow())["Your voice going to Ana"];
    await face.getByRole("button", { name: "Close details" }).click();
    if (first === later) throw new Error(`the voice stopped going to Ana after the change (${first})`);
    return `${names.length} microphones listed; now ${other.trim()}; voice to Ana ${first} → ${later}`;
  });

  await step("who is speaking shows (the made-up microphone beeps)", async () => {
    await adminMeet.waitForFunction(() => document.querySelectorAll('.meet-faces [data-speaking="true"]').length > 0, null, { timeout: 15000 });
  });

  await step("the microphone's ring and each tile's bars move with the voice (the made-up microphone beeps)", async () => {
    const highest = (page, selector) => page.evaluate(selector => Math.max(0, ...[...document.querySelectorAll(selector)].map(element => Number(element.style.getPropertyValue("--level") || 0))), selector);
    let ring = 0, bars = 0;
    for (let look = 0; look < 40 && (ring < 0.05 || bars < 0.05); look++) {
      ring = Math.max(ring, await highest(adminMeet, '.meet-controls [data-level="me"]'));
      bars = Math.max(bars, await highest(adminMeet, ".meet-faces .meet-bars"));
      await adminMeet.waitForTimeout(100);
    }
    if (ring < 0.05) throw new Error(`the microphone's ring did not move (${ring})`);
    if (bars < 0.05) throw new Error(`no tile's bars moved (${bars})`);
    return `ring up to ${ring.toFixed(2)}, bars up to ${bars.toFixed(2)}`;
  });

  await step("the meeting's chat: Ana writes to everyone; the admin sees it counted, opens it and answers; Ben, coming back, reads both", async () => {
    await anaMeet.getByRole("button", { name: /^Chat with everyone/ }).click();
    const anaChat = anaMeet.getByRole("complementary", { name: "Chat with everyone" });
    await anaChat.getByRole("textbox", { name: "Message to everyone" }).fill("Hello everyone, can you hear me?");
    await anaChat.getByRole("textbox", { name: "Message to everyone" }).press("Enter");
    // Closed on the admin's side: a count on Chat, and the message shown for a moment.
    await adminMeet.getByRole("button", { name: /^Chat with everyone, 1 new/ }).waitFor({ timeout: 10000 });
    await adminMeet.locator(".meet-toast-message", { hasText: "Hello everyone, can you hear me?" }).waitFor({ timeout: 10000 });
    await adminMeet.getByRole("button", { name: /^Chat with everyone/ }).click();
    const adminChat = adminMeet.getByRole("complementary", { name: "Chat with everyone" });
    await adminChat.locator(".chat-text", { hasText: "Hello everyone, can you hear me?" }).waitFor({ timeout: 10000 });
    await adminChat.getByRole("textbox", { name: "Message to everyone" }).fill("Loud and clear, Ana.");
    await adminChat.getByRole("button", { name: "Send" }).click();
    await anaChat.locator(".chat-text", { hasText: "Loud and clear, Ana." }).waitFor({ timeout: 10000 });
    await adminMeet.screenshot({ path: path.join(out, "meeting-chat.png") });
    // Ben reloads the meeting: in again, he reads what was said before.
    await benMeet.reload();
    await join(benMeet);
    await benMeet.getByRole("button", { name: /^Chat with everyone/ }).click();
    const benChat = benMeet.getByRole("complementary", { name: "Chat with everyone" });
    await benChat.locator(".chat-text", { hasText: "Hello everyone, can you hear me?" }).waitFor({ timeout: 10000 });
    await benChat.locator(".chat-text", { hasText: "Loud and clear, Ana." }).waitFor({ timeout: 10000 });
    await benMeet.getByRole("button", { name: /^Chat with everyone/ }).click();
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 3, null, { timeout: 15000 });
    // Someone not in the meeting reads and writes nothing.
    const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
    const outsider = createClient(env.url, env.publishable, { auth: { persistSession: false } });
    await outsider.auth.signInWithPassword({ email: "cara@example.com", password: people["cara@example.com"].password });
    const [peek, sneak] = await Promise.all([
      outsider.from("meeting_messages").select("id").eq("meeting_id", meetingId),
      outsider.from("meeting_messages").insert({ meeting_id: meetingId, body: "sneaking in" }),
    ]);
    if (peek.data?.length) throw new Error("someone outside the meeting reads its chat");
    if (!sneak.error) throw new Error("someone outside the meeting wrote in its chat");
    const { data: names } = await site.from("meeting_messages").select("name").eq("meeting_id", meetingId).order("created_at");
    return `by ${names.map(row => row.name).join(", ")}`;
  });

  await step("in the chat, as in KIASA Chat: Ana answers the admin's message, reacts to it, and deletes a message of her own", async () => {
    const anaChat = anaMeet.getByRole("complementary", { name: "Chat with everyone" });
    if (!(await anaChat.count())) await anaMeet.getByRole("button", { name: /^Chat with everyone/ }).click();
    const adminChat = adminMeet.getByRole("complementary", { name: "Chat with everyone" });
    if (!(await adminChat.count())) await adminMeet.getByRole("button", { name: /^Chat with everyone/ }).click();
    // The message itself (its own words), not an answer quoting it.
    const theirs = anaChat.locator(".chat-message", { has: anaMeet.locator(".chat-text", { hasText: "Loud and clear, Ana." }) });
    // Reply: the quote shows above her answer, for the admin too.
    await theirs.hover();
    await theirs.getByRole("button", { name: "Reply" }).click();
    await anaChat.getByRole("textbox", { name: "Message to everyone" }).fill("Great, thanks!");
    await anaChat.getByRole("textbox", { name: "Message to everyone" }).press("Enter");
    await adminChat.locator(".chat-message", { hasText: "Great, thanks!" }).locator(".chat-quote", { hasText: "Loud and clear, Ana." }).waitFor({ timeout: 10000 });
    // React: the admin sees it on their message, live.
    await theirs.hover();
    await theirs.getByRole("button", { name: "React" }).click();
    await anaChat.getByRole("group", { name: "Reactions" }).getByRole("button", { name: "🎉" }).click();
    await adminChat.locator(".chat-message", { has: adminMeet.locator(".chat-text", { hasText: "Loud and clear, Ana." }) }).locator(".chat-reaction", { hasText: "🎉" }).waitFor({ timeout: 10000 });
    // Delete her own: gone for everyone.
    await anaChat.getByRole("textbox", { name: "Message to everyone" }).fill("Oops, wrong chat");
    await anaChat.getByRole("textbox", { name: "Message to everyone" }).press("Enter");
    await adminChat.locator(".chat-text", { hasText: "Oops, wrong chat" }).waitFor({ timeout: 10000 });
    const oops = anaChat.locator(".chat-message", { hasText: "Oops, wrong chat" });
    await oops.hover();
    await oops.getByRole("button", { name: "Delete" }).click();
    await adminChat.locator(".chat-text", { hasText: "Oops, wrong chat" }).waitFor({ state: "detached", timeout: 10000 });
    // She cannot delete the admin's.
    if (await theirs.getByRole("button", { name: "Delete" }).count()) throw new Error("Ana may delete the admin's message");
    await adminMeet.screenshot({ path: path.join(out, "meeting-chat-more.png") });
  });

  await step("the admin's Leave menu closes with a click anywhere else, and with Escape", async () => {
    await adminMeet.getByRole("button", { name: "Leave the meeting" }).click();
    await adminMeet.getByRole("menu", { name: "Leave" }).waitFor();
    await adminMeet.mouse.click(40, 300);
    await adminMeet.getByRole("menu", { name: "Leave" }).waitFor({ state: "detached", timeout: 5000 });
    await adminMeet.getByRole("button", { name: "Leave the meeting" }).click();
    await adminMeet.keyboard.press("Escape");
    await adminMeet.getByRole("menu", { name: "Leave" }).waitFor({ state: "detached", timeout: 5000 });
  });

  await step("Ana mutes and raises her hand; Ben turns his camera off: the others see each", async () => {
    await anaMeet.getByRole("button", { name: "Turn off microphone" }).last().click();
    await anaMeet.getByRole("button", { name: "Raise your hand" }).click();
    await benMeet.getByRole("button", { name: "Turn off camera" }).last().click();
    await tile(adminMeet, "Ana Silva").getByRole("img", { name: "Microphone off" }).waitFor({ timeout: 10000 });
    await tile(adminMeet, "Ana Silva").locator(".meet-hand").waitFor({ timeout: 10000 });
    await tile(anaMeet, "Ben Okoro").and(anaMeet.locator('[data-camera="off"]')).waitFor({ timeout: 10000 });
    await benMeet.getByRole("button", { name: "Turn on camera" }).last().click();
    await tile(anaMeet, "Ben Okoro").and(anaMeet.locator('[data-camera="on"]')).waitFor({ timeout: 10000 });
    await waitMoving(anaMeet, 3);
    await anaMeet.getByRole("button", { name: "Turn on microphone" }).last().click();
    await anaMeet.getByRole("button", { name: "Lower your hand" }).click();
  });

  await step("the admin shares the screen: it shows large for Ana and Ben", async () => {
    await adminMeet.getByRole("button", { name: "Share your screen" }).click();
    await Promise.all([anaMeet, benMeet].map(page => page.waitForFunction(() => {
      const video = document.querySelector(".meet-screen video");
      return !!video && video.videoWidth > 0;
    }, null, { timeout: 20000 })));
    await anaMeet.screenshot({ path: path.join(out, "sharing.png") });
    // The admin is not shown their own screen back (it would repeat itself without end).
    await adminMeet.locator(".meet-presenting", { hasText: "You are sharing your screen" }).waitFor({ timeout: 5000 });
    const shown = await adminMeet.evaluate(() => getComputedStyle(document.querySelector(".meet-screen video")).opacity);
    if (shown !== "0") throw new Error(`the admin sees their own screen (opacity ${shown})`);
    await adminMeet.screenshot({ path: path.join(out, "presenting.png") });
    await adminMeet.getByRole("button", { name: "Stop sharing your screen" }).click();
    await anaMeet.locator(".meet-screen").waitFor({ state: "detached", timeout: 15000 });
  });

  await step("the admin records to a file of their choosing; everyone sees it is being recorded; the file is a video", async () => {
    // The save dialog cannot be clicked by a test: it is answered here, keeping what is written.
    await adminMeet.evaluate(() => {
      window.__written = [];
      window.showSaveFilePicker = async options => ({
        name: options.suggestedName,
        createWritable: async () => ({ write: async blob => { window.__written.push(new Uint8Array(await blob.arrayBuffer())); }, close: async () => { window.__closed = true; } }),
      });
    });
    await adminMeet.getByRole("button", { name: "Record to this computer" }).click();
    await anaMeet.locator(".meet-recording", { hasText: "Chris Lim is recording" }).waitFor({ timeout: 10000 });
    await adminMeet.waitForTimeout(4000);
    await adminMeet.getByRole("button", { name: "Stop recording" }).click();
    await adminMeet.waitForFunction(() => window.__closed === true, null, { timeout: 15000 });
    const { bytes, head, name } = await adminMeet.evaluate(() => {
      const all = window.__written.reduce((total, part) => total + part.length, 0);
      // The file's first bytes, however the browser split its pieces (the first can be a single byte).
      const head = window.__written.flatMap(part => [...part]).slice(0, 4);
      return { bytes: all, head, name: document.querySelector(".meet-toast")?.textContent ?? "" };
    });
    // A WebM file starts with EBML's mark, 1A 45 DF A3.
    if (head.join(",") !== "26,69,223,163") throw new Error(`the file starts ${head}`);
    if (bytes < 50_000) throw new Error(`only ${bytes} bytes for four seconds`);
    await anaMeet.locator(".meet-recording").waitFor({ state: "detached", timeout: 10000 });
    return `${Math.round(bytes / 1024)} KB in four seconds; ${name.slice(0, 60)}`;
  });

  await step("Ben leaves: the others see two people; he rejoins without asking again", async () => {
    await benMeet.getByRole("button", { name: "Leave the meeting" }).click();
    await benMeet.getByRole("heading", { name: "You left the meeting" }).waitFor();
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 2, null, { timeout: 15000 });
    // Let in once, he comes back without asking again; then goes.
    await benMeet.getByRole("button", { name: "Rejoin" }).click();
    await benMeet.locator(".meet-controls").waitFor({ timeout: 10000 });
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 3, null, { timeout: 15000 });
    await benMeet.getByRole("button", { name: "Leave the meeting" }).click();
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 2, null, { timeout: 15000 });
  });

  await step("Ben comes back with neither microphone nor camera (both refused): he still connects, and sees the others", async () => {
    const bare = await ben.context.newPage();
    watch(bare, "ben, no devices");
    // As on a computer whose microphone and camera are blocked or missing.
    await bare.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await bare.goto(`${BASE}/meet/${meetingId}`);
    await join(bare);
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 3, null, { timeout: 15000 });
    // Connected to the admin, and the admin's and Ana's pictures moving on his page.
    await adminMeet.waitForFunction(() => [...document.querySelectorAll(".meet-faces [data-tile]")].some(tile => tile.dataset.name === "Ben Okoro" && (tile.dataset.link ?? "").startsWith("connected")), null, { timeout: 20000 });
    await waitMoving(bare, 2);
    await bare.screenshot({ path: path.join(out, "no-devices.png") });
    await bare.getByRole("button", { name: "Leave the meeting" }).click();
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 2, null, { timeout: 15000 });
  });

  await step("Ben comes back with his camera but no microphone: seen, and told why; with one plugged in, the mic button sends his voice", async () => {
    const page = await ben.context.newPage();
    watch(page, "ben, no microphone");
    // No microphone on this computer, until one is "plugged in" (window.micBack).
    await page.addInitScript(() => {
      const ask = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => constraints?.audio && !window.micBack
        ? Promise.reject(new DOMException("Requested device not found", "NotFoundError")) : ask(constraints);
    });
    await page.goto(`${BASE}/meet/${meetingId}`);
    await join(page);
    await page.getByText("No microphone was found on this computer").waitFor({ timeout: 10000 });
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 3, null, { timeout: 15000 });
    await waitMoving(adminMeet, 2);
    const voices = () => adminMeet.evaluate(() => [...document.querySelectorAll("audio[data-voice]")].reduce((sum, audio) => sum + (audio.srcObject?.getAudioTracks().filter(track => track.readyState === "live").length ?? 0), 0));
    const before = await voices();
    await page.evaluate(() => { window.micBack = true; });
    await page.getByRole("button", { name: "Turn on microphone" }).click();
    await page.getByRole("button", { name: "Turn off microphone" }).waitFor({ timeout: 10000 });
    await adminMeet.waitForFunction(count => [...document.querySelectorAll("audio[data-voice]")].reduce((sum, audio) => sum + (audio.srcObject?.getAudioTracks().filter(track => track.readyState === "live").length ?? 0), 0) > count, before, { timeout: 20000 });
    await tile(adminMeet, "Ben Okoro").locator(".meet-name svg").waitFor({ state: "detached", timeout: 10000 });
    await page.getByRole("button", { name: "Leave the meeting" }).click();
    await adminMeet.waitForFunction(() => document.querySelectorAll(".meet-faces [data-tile]").length === 2, null, { timeout: 15000 });
    return `voices on the admin's page: ${before} before, one more after`;
  });

  await step("the admin ends it for everyone: Ana's window says so, and the card in the chat reads Ended", async () => {
    await adminMeet.getByRole("button", { name: "Leave the meeting" }).click();
    await adminMeet.getByRole("menuitem", { name: /^End for everyone/ }).click();
    await anaMeet.getByRole("heading", { name: "This meeting has ended" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".chat-row", { hasText: "Meeting test" }).first().click();
    await ana.page.locator(".chat-meeting[data-status='ended']").first().waitFor({ timeout: 10000 });
    await ana.page.screenshot({ path: path.join(out, "cards.png") });
  });

  await step("the admin schedules one for tomorrow: Ana sees its card; it is called off, live", async () => {
    await admin.page.getByRole("button", { name: "Start or schedule a meeting" }).click();
    await admin.page.getByLabel("Title").fill("Planning");
    await admin.page.getByRole("radio", { name: "Later" }).click();
    const tomorrow = new Date(Date.now() + 86400_000);
    const two = value => String(value).padStart(2, "0");
    await admin.page.getByLabel(/Day and time/).fill(`${tomorrow.getFullYear()}-${two(tomorrow.getMonth() + 1)}-${two(tomorrow.getDate())}T10:00`);
    await admin.page.getByRole("button", { name: "Schedule", exact: true }).click();
    const card = ana.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Planning" });
    await card.waitFor({ timeout: 10000 });
    if (await card.getByRole("button", { name: "Call off" }).count()) throw new Error("Ana may call it off");
    await admin.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Planning" }).getByRole("button", { name: "Call off" }).click();
    await ana.page.locator(".chat-meeting[data-status='cancelled']", { hasText: "Planning" }).waitFor({ timeout: 10000 });
  });

  await step("members cannot organize or let themselves in: no meeting button for Ana; the database refuses her a meeting and an admission, and Ben a meeting not his", async () => {
    await ana.page.locator(".chat-row", { hasText: "Meeting test" }).first().click();
    await ana.page.locator(".chat-head").waitFor();
    if (await ana.page.getByRole("button", { name: "Start or schedule a meeting" }).count()) throw new Error("Ana has the meeting button");
    const asAna = createClient(env.url, env.publishable, { auth: { persistSession: false } });
    await asAna.auth.signInWithPassword({ email: "ana@example.com", password: people["ana@example.com"].password });
    const made = await asAna.from("meetings").insert({ chat_id: group.id, title: "Mine" }).select("id");
    if (!made.error) throw new Error("Ana made a meeting");
    // Nor can she let herself (or anyone) into a meeting.
    const { data: last } = await site.from("meetings").select("id").eq("chat_id", group.id).order("created_at", { ascending: false }).limit(1).single();
    const self = await asAna.from("meeting_admissions").upsert({ meeting_id: last.id, user_id: ids.ana, name: "Ana Silva", status: "admitted" }).select("user_id");
    if (!self.error) throw new Error("Ana let herself in");
    const { data: hidden } = await site.from("meetings").insert({ chat_id: apart.id, title: "Not for Ben", started_at: new Date().toISOString() }).select("id").single();
    const asBen = createClient(env.url, env.publishable, { auth: { persistSession: false } });
    await asBen.auth.signInWithPassword({ email: "ben@example.com", password: people["ben@example.com"].password });
    const seen = await asBen.from("meetings").select("id").eq("id", hidden.id);
    if (seen.data?.length) throw new Error("Ben can read a meeting not his");
    await asBen.realtime.setAuth();
    const status = await new Promise(resolve => {
      const channel = asBen.channel(`meet:${hidden.id}`, { config: { private: true } });
      channel.subscribe(state => { if (state !== "CLOSED") resolve(state); });
      setTimeout(() => resolve("no answer"), 8000);
    });
    if (status === "SUBSCRIBED") throw new Error("Ben joined the channel of a meeting not his");
    const page = await ben.context.newPage();
    await page.goto(BASE + `/meet/${hidden.id}`);
    await page.getByText("This meeting is not one you are in").waitFor({ timeout: 10000 });
    await page.close();
    return `insert refused (${made.error.code}); Ben's channel: ${status}`;
  });

  console.log(results.join("\n"));
  console.log("page errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  await site.from("chats").delete().in("title", ["Meeting test", "Without Ben"]);
  process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
})().catch(error => { console.log(results.join("\n")); console.error("stopped:", error.message); process.exit(1); });
