// End-to-end test of KIASA Chat against the LOCAL Supabase copy. Several
// browsers at once: an admin, two approved people, a waiting one, a new visitor.
// Prints PASS/FAIL per step and how fast messages arrive. Usage, from apps/web:
// npx supabase start; npm run chat:local:seed; then serve a build made with the
// local copy's keys on port 3002 (see docs/site.md), and npm run chat:local:e2e.
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
const fs = require("fs");
// Reads the LOCAL Supabase copy's address and keys (`npx supabase status`), and
// refuses anything that is not on this computer.
const { execSync } = require("child_process");
const os = require("os");
const path = require("path");
function localEnv() {
  const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]*)"?`, "m")) || [])[1] || "";
  const env = { SUPABASE_URL: get("API_URL"), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: get("PUBLISHABLE_KEY") || get("ANON_KEY"), SUPABASE_SECRET_KEY: get("SECRET_KEY") || get("SERVICE_ROLE_KEY") };
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.SUPABASE_URL)) throw new Error("Refusing: this is only for the local Supabase copy");
  return env;
}
const peopleFile = path.join(os.tmpdir(), "kiasa-chat-people.json");

const env = localEnv();
const people = JSON.parse(fs.readFileSync(peopleFile, "utf8"));
const out = path.join(os.tmpdir(), "kiasa-chat-e2e");
const BASE = "http://127.0.0.1:3002";
fs.mkdirSync(out, { recursive: true });
const results = [];
const errors = [];
async function step(name, fn) {
  const started = Date.now();
  try { const note = await fn(); results.push(`PASS  ${name}${note ? ` (${note})` : ""} [${Date.now() - started} ms]`); }
  catch (error) {
    // What it was waiting for, and the last thing Playwright saw (from the call log).
    const lines = error.message.split("\n").map(line => line.replace(/\x1b\[[0-9;]*m/g, "").trim());
    const waited = lines.find(line => /^- waiting for/.test(line)) ?? "";
    const last = [...lines].reverse().find(line => /^- /.test(line) && line !== waited) ?? "";
    results.push(`FAIL  ${name}: ${lines[0]}${waited ? ` | ${waited}` : ""}${last ? ` | ${last}` : ""}`);
  }
}
const hydrated = page => page.waitForFunction(() => {
  const node = document.querySelector("form, .chat, .masthead");
  return !!node && Object.keys(node).some(key => key.startsWith("__react"));
}, null, { timeout: 20000 });

async function signIn(browser, email, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  page.on("console", message => { if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) errors.push(`${label} console: ${message.text().slice(0, 160)}`); });
  await page.goto(BASE + "/sign-in");
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(people[email].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
  return { context, page };
}
async function openChat(page) {
  await page.goto(BASE + "/chat");
  await hydrated(page);
  // The connection is said only while it is not live, so its line is there, but hidden, once live.
  await page.locator(".chat-live[data-state='live']").waitFor({ state: "attached", timeout: 20000 });
}
// One's photo is in the menu under one's name in KIASA's bar: opened first, if it is not.
async function yourPhoto(page) {
  if (!(await page.locator(".app-menu").count())) await page.getByRole("button", { name: /^Signed in as / }).click();
  await page.locator(".app-menu").getByRole("button", { name: /^Your photo/ }).click();
}
const row = (page, title) => page.locator(".chat-row", { has: page.locator(".chat-row-title", { hasText: title }) });
// For timings: looks every 10 ms (a locator's own wait looks less and less often, up to every half second).
const appears = (page, selector, text) => page.waitForFunction(([selector, text]) =>
  [...document.querySelectorAll(selector)].some(node => node.textContent.includes(text)), [selector, text], { polling: 10, timeout: 10000 });

(async () => {
  const fresh = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  // "Last seen" starts empty, so the pages themselves must record it.
  await fresh.from("seen").delete().not("user_id", "is", null);
  // Each run starts from no chats, and without the visitors earlier runs made:
  // what a run leaves (a second group of the same name, Saved Messages) would
  // otherwise stand beside what the next one makes.
  await fresh.from("chats").delete().not("id", "is", null);
  // Ana and Ben are in one team, so they may message each other freely (the
  // rules between teams have their own test: npm run teams:local:e2e).
  await fresh.from("contact_requests").delete().not("id", "is", null);
  await fresh.from("teams").delete().not("id", "is", null);
  await fresh.from("top_managers").delete().not("user_id", "is", null);
  const { data: team } = await fresh.from("teams").insert({ name: "Chat test", color: "#30a46c" }).select("id").single();
  await fresh.from("team_members").insert(["ana@example.com", "ben@example.com"].map(email => ({ user_id: people[email].id, team_id: team.id, assigned_by: "chat test" })));
  const { data: listed } = await fresh.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const user of listed?.users ?? []) if (/^dan\.\d+@example\.com$/.test(user.email ?? "")) await fresh.auth.admin.deleteUser(user.id);
  // The local realtime server sleeps when no one is connected, and what the
  // database says in its first seconds awake can be lost: woken first.
  const wake = fresh.channel("wake").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {});
  await new Promise(resolve => wake.subscribe(status => { if (status !== "CLOSED") resolve(); }));
  await new Promise(done => setTimeout(done, 3000));
  await fresh.removeChannel(wake);
  const browser = await chromium.launch();
  const picture = path.join(out, "leaf.png");
  await sharp({ create: { width: 320, height: 200, channels: 3, background: "#b8ec93" } }).png().toFile(picture);

  let admin, ana, ben;
  await step("admin, Ana and Ben sign in", async () => {
    [admin, ana, ben] = await Promise.all([signIn(browser, "chrislim@kiasa.tech", "admin"), signIn(browser, "ana@example.com", "ana"), signIn(browser, "ben@example.com", "ben")]);
    return `admin → ${new URL(admin.page.url()).pathname}`;
  });
  await step("each opens KIASA Chat and goes live", async () => { await Promise.all([openChat(admin.page), openChat(ana.page), openChat(ben.page)]); });

  await step("Ana starts a direct message to Ben", async () => {
    await ana.page.getByRole("button", { name: "New message" }).click();
    await ana.page.locator(".chat-person", { hasText: "Ben Okoro" }).click();
    await ana.page.locator(".chat-head-title", { hasText: "Ben Okoro" }).waitFor({ timeout: 10000 });
  });
  await step("Ana's message reaches Ben's chat list live, unread", async () => {
    const started = Date.now();
    await ana.page.getByRole("textbox", { name: "Message" }).fill("Hello Ben");
    await ana.page.getByRole("textbox", { name: "Message" }).press("Enter");
    await ben.page.waitForFunction(() => [...document.querySelectorAll(".chat-row")].some(node =>
      node.querySelector(".chat-row-title")?.textContent.includes("Ana Silva") && node.querySelector(".chat-unread")), null, { polling: 10, timeout: 10000 });
    return `arrived in ${Date.now() - started} ms; preview “${await row(ben.page, "Ana Silva").locator(".chat-row-preview").innerText()}”`;
  });
  await step("Ben opens it, and Ana sees it read (✓✓)", async () => {
    await row(ben.page, "Ana Silva").click();
    await ben.page.locator(".chat-text", { hasText: "Hello Ben" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".chat-message[data-mine] .chat-tick[data-read]").first().waitFor({ timeout: 10000 });
  });
  await step("Ana sees Ben online and “typing…”", async () => {
    await ana.page.locator(".chat-head-status[data-online]").waitFor({ timeout: 10000 });
    await ben.page.getByRole("textbox", { name: "Message" }).pressSequentially("Hi An", { delay: 30 });
    await ana.page.locator(".chat-head-status", { hasText: "Ben is typing" }).waitFor({ timeout: 10000 });
  });
  await step("Ben's reply arrives in Ana's open conversation live", async () => {
    const started = Date.now();
    await ben.page.getByRole("textbox", { name: "Message" }).fill("Hi Ana");
    await ben.page.getByRole("textbox", { name: "Message" }).press("Enter");
    await appears(ana.page, ".chat-message:not([data-mine]) .chat-text", "Hi Ana");
    return `arrived in ${Date.now() - started} ms`;
  });
  await step("Ana replies to it; Ben sees the quote", async () => {
    const theirs = ana.page.locator(".chat-message:not([data-mine])", { hasText: "Hi Ana" });
    await theirs.hover();
    await theirs.getByRole("button", { name: "Reply" }).click();
    await ana.page.getByRole("textbox", { name: "Message" }).fill("Answering you");
    await ana.page.getByRole("textbox", { name: "Message" }).press("Enter");
    await ben.page.locator(".chat-message", { hasText: "Answering you" }).locator(".chat-quote", { hasText: "Hi Ana" }).waitFor({ timeout: 10000 });
  });
  await step("Ana edits, then deletes for both, a message (from its ⋯ menu); Ben sees both", async () => {
    const mine = ana.page.locator(".chat-message[data-mine]", { hasText: "Hello Ben" });
    await mine.hover();
    await mine.getByRole("button", { name: "More" }).click();
    await ana.page.getByRole("menuitem", { name: "Edit" }).click();
    await ana.page.getByRole("textbox", { name: "Message" }).fill("Hello Ben, edited");
    await ana.page.getByRole("button", { name: "Save" }).click();
    await ben.page.locator(".chat-message", { hasText: "Hello Ben, edited" }).locator(".chat-meta", { hasText: "edited" }).waitFor({ timeout: 10000 });
    const edited = ana.page.locator(".chat-message[data-mine]", { hasText: "Hello Ben, edited" });
    await edited.hover();
    await edited.getByRole("button", { name: "More" }).click();
    await ana.page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = ana.page.getByRole("dialog");
    if (!(await dialog.getByLabel("Also delete for Ben").isChecked())) throw new Error("for one's own message, 'also for Ben' should start ticked");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await ben.page.locator(".chat-message", { hasText: "Hello Ben, edited" }).waitFor({ state: "detached", timeout: 10000 });
  });
  await step("Ana sends a picture; Ben sees it", async () => {
    await ana.page.locator(".chat-attach input[type=file]").setInputFiles(picture);
    await ana.page.getByRole("dialog", { name: "Send Photo" }).getByRole("button", { name: "Send" }).click();
    await ben.page.locator(".chat-picture img").first().waitFor({ timeout: 15000 });
    await ben.page.waitForFunction(() => { const img = document.querySelector(".chat-picture img"); return img && img.complete && img.naturalWidth > 0; }, null, { timeout: 15000 });
  });
  await step("Ana's file shows at once, going up, and can be stopped; sent again, it reaches Ben with its caption", async () => {
    // Uploads are held here, so the file is seen while it goes.
    const uploads = "**/storage/v1/object/chat-files/**";
    const held = [];
    await ana.page.route(uploads, route => { if (route.request().method() === "POST") held.push(route); else void route.continue(); });
    const sendPlan = async () => {
      await ana.page.locator(".chat-attach input[type=file]").setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(300 * 1024, 7) });
      const dialog = ana.page.getByRole("dialog", { name: "Send File" });
      await dialog.getByLabel("Caption").fill("The plan");
      await dialog.getByRole("button", { name: "Send" }).click();
    };
    await sendPlan();
    const going = ana.page.locator(".chat-file[data-uploading]", { hasText: "plan.pdf" });
    await going.locator(".chat-ring").waitFor({ timeout: 5000 });
    await going.getByText(/\/ 300 KB$/).waitFor({ timeout: 5000 });
    await going.getByRole("button", { name: "Stop sending plan.pdf" }).click();
    await going.waitFor({ state: "detached", timeout: 5000 });
    for (const route of held.splice(0)) await route.abort().catch(() => {});
    await ana.page.unroute(uploads);
    await sendPlan();
    await ben.page.locator(".chat-text", { hasText: "The plan" }).waitFor({ timeout: 15000 });
    const copies = await ben.page.locator(".chat-file", { hasText: "plan.pdf" }).count();
    if (copies !== 1) throw new Error(`Ben has ${copies} copies of plan.pdf; the stopped one must not reach him`);
    // A file dropped on the conversation opens the same step.
    const dataTransfer = await ana.page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["notes"], "notes.txt", { type: "text/plain" }));
      return transfer;
    });
    await ana.page.dispatchEvent(".chat-messages", "dragenter", { dataTransfer });
    await ana.page.locator(".chat-drop").waitFor({ timeout: 5000 });
    await ana.page.dispatchEvent(".chat-messages", "drop", { dataTransfer });
    await ana.page.getByRole("dialog", { name: "Send File" }).getByRole("button", { name: "Cancel" }).click();
    await ana.page.getByRole("dialog", { name: "Send File" }).waitFor({ state: "detached", timeout: 5000 });
  });
  await step("Ben downloads Ana's file (from its card) and her picture (from its menu), under their own names", async () => {
    const [file] = await Promise.all([ben.page.waitForEvent("download"), ben.page.getByRole("button", { name: "Download plan.pdf" }).click()]);
    if (file.suggestedFilename() !== "plan.pdf") throw new Error(`the file was saved as ${file.suggestedFilename()}`);
    const size = fs.statSync(await file.path()).size;
    if (size !== 300 * 1024) throw new Error(`plan.pdf came down as ${size} bytes`);
    await ben.page.locator(".chat-picture").first().click({ button: "right" });
    const [photo] = await Promise.all([ben.page.waitForEvent("download"), ben.page.getByRole("menuitem", { name: "Download" }).click()]);
    if (photo.suggestedFilename() !== "leaf.png") throw new Error(`the picture was saved as ${photo.suggestedFilename()}`);
    return `plan.pdf, ${size} bytes; ${photo.suggestedFilename()}`;
  });
  await ben.page.screenshot({ path: path.join(out, "ben-direct.png") });
  await step("a message sent only straight, never saved, is taken away; one from outside the chat never shows", async () => {
    // As Ana, outside the site: on her chat's live channel, a message the database never gets.
    const asAna = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    await asAna.auth.signInWithPassword({ email: "ana@example.com", password: people["ana@example.com"].password });
    const site = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const ids = [people["ana@example.com"].id, people["ben@example.com"].id];
    const { data: rows } = await site.from("chat_members").select("chat_id, chats!inner(kind)").eq("chats.kind", "direct").in("user_id", ids);
    const counts = {};
    for (const entry of rows) counts[entry.chat_id] = (counts[entry.chat_id] || 0) + 1;
    const chatId = Object.keys(counts).find(id => counts[id] === 2);
    await asAna.realtime.setAuth();
    const channel = asAna.channel(`chat:${chatId}`, { config: { private: true } });
    await new Promise((resolve, reject) => channel.subscribe(status => status === "SUBSCRIBED" ? resolve() : ["CHANNEL_ERROR", "TIMED_OUT"].includes(status) && reject(new Error(status))));
    const fake = (sender, body) => channel.send({ type: "broadcast", event: "message", payload: { message: {
      id: crypto.randomUUID(), chat_id: chatId, sender_id: sender, kind: "text", body, reply_to: null, attachment: null,
      created_at: new Date().toISOString(), edited_at: null, deleted_at: null } } });
    await fake(people["ana@example.com"].id, "Never saved");
    await fake(people["cara@example.com"].id, "Not in this chat");
    const shown = ben.page.locator(".chat-text", { hasText: "Never saved" });
    await shown.waitFor({ timeout: 5000 });
    const started = Date.now();
    await shown.waitFor({ state: "detached", timeout: 15000 });
    await asAna.removeChannel(channel);
    if (await ben.page.locator(".chat-text", { hasText: "Not in this chat" }).count()) throw new Error("a message from outside the chat was shown");
    return `shown, then taken away after ${Date.now() - started} ms`;
  });

  // ── More of Telegram, in Ana and Ben's chat: menus, deleting, reactions, pins,
  // forwarding, choosing, the chat's own menu, clearing, deleting, profile, search.
  const say = async (who, text) => {
    await who.page.getByRole("textbox", { name: "Message" }).fill(text);
    await who.page.getByRole("textbox", { name: "Message" }).press("Enter");
  };
  const bubble = (page, text) => page.locator(".chat-message", { has: page.locator(".chat-text", { hasText: text }) });
  // A right-click on a message, once the database has it (until then it has no menu).
  const menuOn = async (page, text) => {
    await bubble(page, text).locator(".chat-actions").waitFor({ state: "attached", timeout: 10000 });
    await bubble(page, text).locator(".chat-bubble").click({ button: "right" });
  };
  await step("Ben deletes Ana's message for both of them (right-click), as Telegram allows in a one-to-one chat", async () => {
    await say(ana, "Delete me, Ben");
    await menuOn(ben.page, "Delete me, Ben");
    await ben.page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = ben.page.getByRole("dialog");
    await dialog.getByLabel("Also delete for Ana").check();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await bubble(ana.page, "Delete me, Ben").waitFor({ state: "detached", timeout: 10000 });
  });
  await step("Ana reacts to Ben's message from its menu; he sees it live", async () => {
    await say(ben, "React to this");
    await menuOn(ana.page, "React to this");
    await ana.page.getByRole("button", { name: "React 🔥" }).click();
    await bubble(ben.page, "React to this").locator(".chat-reaction", { hasText: "🔥" }).waitFor({ timeout: 10000 });
  });
  await step("Ana pins it; the pinned bar shows it to Ben, live", async () => {
    await menuOn(ana.page, "React to this");
    await ana.page.getByRole("menuitem", { name: "Pin" }).click();
    await ben.page.locator(".chat-pinned-text", { hasText: "React to this" }).waitFor({ timeout: 10000 });
  });
  await step("Ana forwards it to Saved Messages, which says whose it was", async () => {
    await menuOn(ana.page, "React to this");
    await ana.page.getByRole("menuitem", { name: "Forward" }).click();
    await ana.page.getByRole("dialog").getByRole("button", { name: /Saved Messages/ }).click();
    await ana.page.locator(".chat-head-title", { hasText: "Saved Messages" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".chat-forwarded", { hasText: "Ben Okoro" }).waitFor({ timeout: 10000 });
    await row(ana.page, "Ben Okoro").click();
    await bubble(ana.page, "React to this").waitFor({ timeout: 10000 });
  });
  await step("Ben chooses two of Ana's messages and deletes them for himself only", async () => {
    await say(ana, "First of two");
    await say(ana, "Second of two");
    await bubble(ben.page, "Second of two").locator(".chat-actions").waitFor({ state: "attached", timeout: 10000 });
    await menuOn(ben.page, "First of two");
    await ben.page.getByRole("menuitem", { name: "Select" }).click();
    await bubble(ben.page, "Second of two").click();
    const bar = ben.page.getByRole("toolbar", { name: "Chosen messages" });
    await bar.getByText("2 selected").waitFor({ timeout: 5000 });
    await bar.getByRole("button", { name: "Delete" }).click();
    const dialog = ben.page.getByRole("dialog");
    if (await dialog.getByLabel("Also delete for Ana").isChecked()) throw new Error("for someone else's messages, 'also for Ana' should start unticked");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await bubble(ben.page, "Second of two").waitFor({ state: "detached", timeout: 10000 });
    await ana.page.waitForTimeout(800);
    if (!(await bubble(ana.page, "Second of two").count())) throw new Error("Ana lost them too");
  });
  await step("Ana pins, mutes and archives her chat with Ben from its menu, and brings it back", async () => {
    const theirs = () => row(ana.page, "Ben Okoro");
    await theirs().click({ button: "right" });
    await ana.page.getByRole("menuitem", { name: "Pin" }).click();
    await theirs().getByRole("img", { name: "Pinned" }).waitFor({ timeout: 10000 });
    await theirs().click({ button: "right" });
    await ana.page.getByRole("menuitem", { name: "Mute" }).click();
    await theirs().getByRole("img", { name: "Muted" }).waitFor({ timeout: 10000 });
    await theirs().click({ button: "right" });
    await ana.page.getByRole("menuitem", { name: "Archive" }).click();
    await row(ana.page, "Archived chats").click();
    await theirs().click({ button: "right" });
    await ana.page.getByRole("menuitem", { name: "Unarchive" }).click();
    await ana.page.locator(".chat-list-top").getByRole("button", { name: "Back to chats" }).click();
    await theirs().waitFor({ timeout: 10000 });
  });
  await step("Ana clears the history for both; Ben's conversation empties live", async () => {
    await row(ana.page, "Ben Okoro").click({ button: "right" });
    await ana.page.getByRole("menuitem", { name: "Clear history" }).click();
    const dialog = ana.page.getByRole("dialog");
    await dialog.getByLabel("Also clear for Ben").check();
    await dialog.getByRole("button", { name: "Clear history" }).click();
    await ben.page.locator(".chat-note", { hasText: "Say hello to Ana" }).waitFor({ timeout: 10000 });
  });
  await step("Ana deletes the chat for herself; Ben's next message brings it back", async () => {
    await row(ana.page, "Ben Okoro").click({ button: "right" });
    await ana.page.getByRole("menuitem", { name: "Delete chat" }).click();
    await ana.page.getByRole("dialog").getByRole("button", { name: "Delete chat" }).click();
    await row(ana.page, "Ben Okoro").waitFor({ state: "detached", timeout: 10000 });
    await say(ben, "Still there?");
    await row(ana.page, "Ben Okoro").locator(".chat-row-preview", { hasText: "Still there?" }).waitFor({ timeout: 10000 });
  });
  await step("Ana sets her bio and username in Settings; Ben sees them in her info", async () => {
    await ana.page.getByRole("button", { name: "Menu" }).click();
    await ana.page.getByRole("menuitem", { name: "Settings" }).click();
    await ana.page.getByRole("button", { name: "Edit profile" }).click();
    await ana.page.getByLabel("Bio (optional)").fill("Platform lead at Halden");
    await ana.page.getByLabel("Username (optional)").fill("ana_silva");
    await ana.page.getByRole("button", { name: "Save" }).click();
    await ana.page.locator(".chat-facts", { hasText: "@ana_silva" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".chat-facts", { hasText: "Platform lead at Halden" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".chat-panel-head").getByRole("button", { name: "Back to chats" }).click();
    await ben.page.getByRole("button", { name: "About Ana Silva" }).click();
    await ben.page.locator(".chat-info", { hasText: "Platform lead at Halden" }).waitFor({ timeout: 10000 });
    await ben.page.locator(".chat-info", { hasText: "@ana_silva" }).waitFor({ timeout: 10000 });
    await ben.page.locator(".chat-info").getByRole("button", { name: "Close" }).click();
  });
  await step("Ana searches her chat with Ben and jumps to the match", async () => {
    await row(ana.page, "Ben Okoro").click();
    await ana.page.getByRole("button", { name: "Search in this chat" }).click();
    await ana.page.getByRole("searchbox", { name: "Search in this chat" }).fill("Still");
    await ana.page.getByRole("searchbox", { name: "Search in this chat" }).press("Enter");
    await ana.page.locator(".chat-searchbar-count", { hasText: "1 of 1" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".chat-message[data-lit]").waitFor({ timeout: 5000 });
    await ana.page.getByRole("button", { name: "Close search" }).click();
  });
  await step("Ana deletes the chat again, finds Ben by searching, and opens it: it is back in her list", async () => {
    await row(ana.page, "Ben Okoro").click({ button: "right" });
    await ana.page.getByRole("menuitem", { name: "Delete chat" }).click();
    await ana.page.getByRole("dialog").getByRole("button", { name: "Delete chat" }).click();
    await row(ana.page, "Ben Okoro").waitFor({ state: "detached", timeout: 10000 });
    await ana.page.getByRole("searchbox", { name: "Search chats" }).fill("Ben");
    await ana.page.getByRole("list", { name: "People" }).getByRole("button", { name: /Ben Okoro/ }).click();
    await ana.page.locator(".chat-head-title", { hasText: "Ben Okoro" }).waitFor({ timeout: 10000 });
    await row(ana.page, "Ben Okoro").waitFor({ timeout: 10000 });
    // Not only on this page: the database has it back in her list.
    await openChat(ana.page);
    await row(ana.page, "Ben Okoro").waitFor({ timeout: 10000 });
  });

  await step("the admin makes a group with Ana and Ben; it appears for both live", async () => {
    await admin.page.getByRole("button", { name: "New chat" }).click();
    await admin.page.getByRole("menuitem", { name: "New group" }).click();
    await admin.page.getByLabel("Group name").fill("Platform team");
    for (const name of ["Ana Silva", "Ben Okoro"]) await admin.page.locator(".chat-person", { hasText: name }).locator("input").check();
    await admin.page.locator(".chat-picker-go").click();
    await Promise.all([row(ana.page, "Platform team").waitFor({ timeout: 10000 }), row(ben.page, "Platform team").waitFor({ timeout: 10000 })]);
  });
  await step("a group message shows its writer to the others", async () => {
    await row(admin.page, "Platform team").click();
    await admin.page.getByRole("textbox", { name: "Message" }).fill("Welcome to the platform team");
    await admin.page.getByRole("textbox", { name: "Message" }).press("Enter");
    await row(ana.page, "Platform team").click();
    await ana.page.locator(".chat-message", { hasText: "Welcome to the platform team" }).waitFor({ timeout: 10000 });
    await ana.page.locator(".chat-author", { hasText: "Chris Lim" }).waitFor({ timeout: 10000 });
  });
  await ana.page.screenshot({ path: path.join(out, "ana-group.png") });

  await step("Ana sets a photo from her square in the chat's bar; Ben sees it live, and her header shows it", async () => {
    await yourPhoto(ana.page);
    await ana.page.locator(".photo-choose input[type=file]").setInputFiles(picture);
    await ana.page.locator(".photo-frame img").waitFor({ timeout: 10000 });
    await ana.page.screenshot({ path: path.join(out, "ana-placing-photo.png") });
    const started = Date.now();
    await ana.page.getByRole("button", { name: "Save photo" }).click();
    await ben.page.waitForFunction(() => [...document.querySelectorAll(".chat-row")].some(node =>
      node.querySelector(".chat-row-title")?.textContent.includes("Ana Silva") && node.querySelector(".chat-avatar img.avatar-photo")), null, { polling: 10, timeout: 10000 });
    const shownToBen = Date.now() - started;
    await ana.page.locator(".photo-button img.avatar-photo").waitFor({ timeout: 10000 });
    const size = await ben.page.locator(".chat-row", { hasText: "Ana Silva" }).locator("img.avatar-photo").evaluate(img => `${img.naturalWidth}×${img.naturalHeight}`);
    const site = await ana.context.newPage();
    try {
      await site.goto(BASE + "/what-we-do");
      await site.locator(".masthead-account-initials img.avatar-photo").waitFor({ timeout: 10000 });
    } finally {
      await site.close();
    }
    return `Ben saw it ${shownToBen} ms after Save; saved as a ${size} square`;
  });
  await step("Ana removes her photo; Ben sees her initials again", async () => {
    await yourPhoto(ana.page);
    await ana.page.locator(".photo-panel").getByRole("button", { name: "Remove" }).click();
    await ben.page.locator(".chat-row", { hasText: "Ana Silva" }).locator("img.avatar-photo").waitFor({ state: "detached", timeout: 10000 });
    await ana.page.keyboard.press("Escape");
  });

  let dan;
  await step("a new visitor asks for an account; the admins' chat gets the card live", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(`dan: ${error.message}`));
    await page.goto(BASE + "/sign-up");
    await hydrated(page);
    const form = page.locator("form.b-form");
    await form.getByLabel("First name").fill("Dan");
    await form.getByLabel("Last name").fill("Reyes");
    await form.getByLabel("Work email").fill(`dan.${Date.now()}@example.com`);
    await form.getByLabel("Choose a password").fill("a-local-test-password");
    await form.getByRole("checkbox", { name: /^I agree/ }).check();
    await form.getByRole("button", { name: "Send request" }).click();
    await page.waitForURL(/\/account/, { timeout: 20000 });
    dan = { context, page };
    await row(admin.page, "Account requests").waitFor({ timeout: 15000 });
    await row(admin.page, "Account requests").click();
    await admin.page.locator(".chat-request", { hasText: "Dan Reyes" }).waitFor({ timeout: 10000 });
  });
  await admin.page.screenshot({ path: path.join(out, "admin-requests.png") });
  await step("the admin approves Dan in the chat; the card says so and Dan's page turns into his account", async () => {
    const card = admin.page.locator(".chat-request", { hasText: "Dan Reyes" });
    await card.getByRole("button", { name: "Approve" }).click();
    await card.locator(".chat-request-status", { hasText: "Approved by Chris Lim" }).waitFor({ timeout: 15000 });
    await dan.page.waitForURL(/welcome=1/, { timeout: 15000 });
  });
  await step("Dan finds KIASA's welcome in his chat", async () => {
    await openChat(dan.page);
    await row(dan.page, "KIASA").click();
    await dan.page.locator(".chat-notice", { hasText: "approved" }).waitFor({ timeout: 10000 });
  });

  await step("the database keeps chats private: Ben cannot read the admins' chat", async () => {
    const asBen = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    await asBen.auth.signInWithPassword({ email: "ben@example.com", password: people["ben@example.com"].password });
    const site = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: requests } = await site.from("chats").select("id").eq("title", "Account requests").single();
    const peek = await asBen.from("messages").select("id").eq("chat_id", requests.id);
    const sneak = await asBen.from("messages").insert({ chat_id: requests.id, sender_id: people["ben@example.com"].id, body: "sneaking in" });
    const notice = await asBen.from("messages").insert({ chat_id: requests.id, sender_id: people["ben@example.com"].id, body: "x", kind: "notice" });
    if (peek.data?.length) throw new Error(`Ben read ${peek.data.length} messages`);
    if (!sneak.error) throw new Error("Ben could write into the admins' chat");
    return `read 0, write refused, notice refused: ${!!notice.error}`;
  });
  await step("someone still waiting cannot open the chat", async () => {
    const cara = await signIn(browser, "cara@example.com", "cara");
    await cara.page.goto(BASE + "/chat");
    await cara.page.waitForURL(/\/(account|sign-in)/, { timeout: 15000 });
    return `sent to ${new URL(cara.page.url()).pathname}`;
  });

  await step("on a phone: the list, then one conversation with a way back", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ana.context.storageState() });
    const page = await phone.newPage();
    await openChat(page);
    await page.screenshot({ path: path.join(out, "phone-list.png") });
    await row(page, "Platform team").click();
    await page.getByRole("button", { name: "Back to chats" }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(out, "phone-conversation.png") });
  });

  // Alerts need a browser as the real one is: only the window in front has focus,
  // and the computer's notifications show. (Playwright's default build makes every
  // page focused and refuses notifications; its "chromium" channel does not.)
  const realBen = async browserForAlerts => {
    const context = await browserForAlerts.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(`ben (alerts): ${error.message}`));
    await page.goto(BASE + "/sign-in");
    await hydrated(page);
    await page.getByLabel("Email").fill("ben@example.com");
    await page.getByLabel("Password").fill(people["ben@example.com"].password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/account/, { timeout: 20000 });
    return { context, page };
  };

  await step("Ben, at the jobs desk with the chat in another tab, gets one alert on his computer and the count on both tabs; opening it clears them", async () => {
    const real = await chromium.launch({ channel: "chromium" });
    try {
      const { context, page: chat } = await realBen(real);
      await context.grantPermissions(["notifications"], { origin: BASE });
      await openChat(chat);
      if (await chat.locator(".chat-alerts-ask").count()) throw new Error("asked to turn alerts on, though they are on");
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15000 });
      // Each time the worker shows an alert, counted.
      await worker.evaluate(() => {
        self.__alerts = 0;
        const show = self.registration.showNotification.bind(self.registration);
        self.registration.showNotification = (...args) => { self.__alerts += 1; return show(...args); };
      });
      // Ben's other window looks at the group, so Ana's chat is read nowhere meanwhile.
      await row(ben.page, "Platform team").click();
      const jobs = await context.newPage();
      jobs.on("pageerror", error => errors.push(`ben jobs (alerts): ${error.message}`));
      await jobs.goto(BASE + "/jobs");
      await jobs.locator(".jobs-app").waitFor({ timeout: 20000 });
      await jobs.bringToFront();
      await jobs.waitForTimeout(2500);
      // What each tab says: the count before its title, and whether the leaf has the badge.
      const tab = page => page.evaluate(() => ({
        title: document.title, count: Number((/^\((\d+)\+?\) /.exec(document.title) ?? [0, 0])[1]),
        badge: [...document.querySelectorAll('link[rel~="icon"]')].every(icon => icon.getAttribute("href").startsWith("data:image/png")),
      }));
      const tabSays = async (page, count, what) => {
        let now;
        for (const until = Date.now() + 10000; Date.now() < until; await page.waitForTimeout(50)) {
          now = await tab(page);
          if (now.count === count && now.badge === count > 0) return;
        }
        throw new Error(`${what} says “${now.title}”, ${now.badge ? "with" : "without"} the badge, not ${count}`);
      };
      // Whatever Ben had not read yet, from earlier steps, both tabs count alike.
      const before = (await tab(chat)).count;
      await tabSays(jobs, before, "the jobs tab, before");

      const started = Date.now();
      await row(ana.page, "Ben Okoro").click();
      await ana.page.getByRole("textbox", { name: "Message" }).fill("Are you free at three?");
      await ana.page.getByRole("textbox", { name: "Message" }).press("Enter");
      const shownFor = words => worker.evaluate(text => self.registration.getNotifications().then(list => list
        .filter(alert => alert.body.includes(text)).map(alert => ({ title: alert.title, body: alert.body, chat: alert.data && alert.data.chat }))), words);
      let shown = [];
      while (!shown.length && Date.now() - started < 10000) {
        shown = await shownFor("Are you free at three?");
        if (!shown.length) await jobs.waitForTimeout(50);
      }
      const after = Date.now() - started;
      if (shown.length !== 1 || shown[0].title !== "Ana Silva") throw new Error(`alerts: ${JSON.stringify(shown)}`);
      // Both tabs count it, once: on the leaf, and before the title.
      await tabSays(jobs, before + 1, "the jobs tab");
      await tabSays(chat, before + 1, "the chat tab");
      await jobs.waitForTimeout(1000);
      const times = await worker.evaluate(() => self.__alerts);
      if (times !== 1) throw new Error(`the alert was shown ${times} times`);

      // The alert clicked, as the worker answers a click: Ben's chat tab opens Ana's chat in place, and reads it.
      await chat.bringToFront();
      await worker.evaluate(chatId => self.clients.matchAll({ type: "window" })
        .then(pages => pages.forEach(page => page.postMessage({ type: "open-chat", chat: chatId }))), shown[0].chat);
      await chat.locator(".chat-text", { hasText: "Are you free at three?" }).waitFor({ timeout: 10000 });
      await tabSays(chat, before, "the chat tab, once read");
      await tabSays(jobs, before, "the jobs tab, once read");

      // With the chat in front, the next message shows there, not as an alert.
      await ana.page.getByRole("textbox", { name: "Message" }).fill("Or at four");
      await ana.page.getByRole("textbox", { name: "Message" }).press("Enter");
      await chat.locator(".chat-text", { hasText: "Or at four" }).waitFor({ timeout: 10000 });
      await chat.waitForTimeout(1000);
      if ((await shownFor("Or at four")).length) throw new Error("an alert showed while the chat was in front");
      return `the alert ${after} ms after sending, shown once though two tabs heard it`;
    } finally {
      await real.close();
    }
  });

  await step("someone who has not answered is asked above the chat list; “Not now” puts it away, and it stays away", async () => {
    const real = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await realBen(real);
      await openChat(page);
      const ask = page.locator(".chat-alerts-ask");
      await ask.waitFor({ timeout: 10000 });
      await ask.getByRole("button", { name: "Not now" }).click();
      await ask.waitFor({ state: "detached", timeout: 5000 });
      await openChat(page);
      await page.waitForTimeout(1000);
      if (await ask.count()) throw new Error("asked again after Not now");
    } finally {
      await real.close();
    }
  });

  // Last: Ben goes, so this comes after everything he takes part in.
  await step("when Ben leaves, Ana sees “last seen just now”", async () => {
    await row(ana.page, "Ben Okoro").click();
    await ana.page.locator(".chat-head-status", { hasText: "online" }).waitFor({ timeout: 10000 });
    await ben.context.close();
    await ana.page.locator(".chat-head-status", { hasText: "last seen just now" }).waitFor({ timeout: 30000 });
    const site = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: seen } = await site.from("seen").select("at").eq("user_id", people["ben@example.com"].id).maybeSingle();
    if (!seen) throw new Error("Ben's page did not record when he was here");
    return `his page recorded ${Math.round((Date.now() - new Date(seen.at).getTime()) / 1000)} s ago`;
  });

  await fresh.from("teams").delete().not("id", "is", null);
  console.log(results.join("\n"));
  console.log("page errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  // Done: nothing left open (a realtime connection, a browser's child) keeps the run waiting.
  process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
})().catch(error => { console.log(results.join("\n")); console.error("stopped:", error.message); process.exit(1); });
