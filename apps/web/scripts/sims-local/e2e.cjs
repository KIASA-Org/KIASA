// End-to-end test of simulated members against the LOCAL Supabase copy: the
// admin adds some (each asks for an account), approves them, puts them in a
// team, renames one, gives one a photo, and sets their hours; a real member
// sees none of them anywhere; a tester sees them, online while at work, and
// cannot message them; then they are paused and deleted. Usage, from apps/web:
// npx supabase start; npm run chat:local:seed; serve a build made with the
// local copy's keys on port 3002 (see docs/site.md); npm run sims:local:e2e.
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
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
const out = path.join(os.tmpdir(), "kiasa-sims-e2e");
const BASE = "http://127.0.0.1:3002";
fs.mkdirSync(out, { recursive: true });
const id = email => people[email].id;
const results = [];
const errors = [];
const pages = [];
async function step(name, fn) {
  const started = Date.now();
  try { const note = await fn(); results.push(`PASS  ${name}${note ? ` (${note})` : ""} [${Date.now() - started} ms]`); }
  catch (error) {
    const lines = error.message.split("\n").map(line => line.replace(/\x1b\[[0-9;]*m/g, "").trim());
    const waited = lines.find(line => /^- waiting for/.test(line)) ?? "";
    results.push(`FAIL  ${name}: ${lines[0]}${waited ? ` | ${waited}` : ""}`);
    const at = results.length;
    await Promise.all(pages.map(({ page, label }) => page.screenshot({ path: path.join(out, `fail-${at}-${label}.png`) }).catch(() => {})));
  }
}
const hydrated = (page, selector) => page.waitForFunction(selector => {
  const node = document.querySelector(selector);
  return !!node && Object.keys(node).some(key => key.startsWith("__react"));
}, selector, { timeout: 20000 });
async function signIn(browser, email, label) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  await page.goto(BASE + "/sign-in");
  await hydrated(page, "form");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(people[email].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
  pages.push({ page, label });
  return { context, page, label };
}
async function as(email) {
  const client = createClient(env.url, env.publishable, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: people[email].password });
  return client;
}
async function openChat(page) {
  await page.goto(BASE + "/chat");
  await hydrated(page, ".chat");
  await page.locator(".chat-live[data-state='live']").waitFor({ state: "attached", timeout: 20000 });
}
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
/** Every job link posted today, in the team's time zone. */
async function todaysLinks() {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const { data: settings } = await site.from("job_settings").select("timezone").eq("id", 1).single();
  const zone = settings.timezone ?? "UTC";
  const day = at => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const { data } = await site.from("jobs").select("id, posted_at").gte("posted_at", new Date(Date.now() - 2 * 86_400_000).toISOString());
  const rows = data.filter(row => day(new Date(row.posted_at)) === day(new Date()));
  return { rows, ids: rows.map(row => row.id) };
}
/** The members beside the chat: each section's name and count, as its label says. */
const sections = page => page.getByRole("complementary", { name: "Members" }).locator("section").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));

(async () => {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const clearSims = async () => {
    const { data } = await site.from("sim_members").select("user_id");
    for (const row of data ?? []) await site.auth.admin.deleteUser(row.user_id);
  };
  await clearSims();
  await site.from("testers").delete().not("user_id", "is", null);
  await site.from("teams").delete().not("id", "is", null);
  await site.from("top_managers").delete().not("user_id", "is", null);
  const { data: sales } = await site.from("teams").insert({ name: "Sales", color: "#e5484d" }).select("id").single();
  await site.from("top_managers").insert({ user_id: id("ben@example.com"), granted_by: "sims test" });
  await site.from("team_members").insert([{ user_id: id("ben@example.com"), team_id: sales.id }, { user_id: id("ana@example.com"), team_id: sales.id }]);
  const picture = path.join(out, "face.png");
  await sharp({ create: { width: 300, height: 300, channels: 3, background: "#7aa2c8" } }).png().toFile(picture);

  const browser = await chromium.launch();
  let admin, ana, ben, simIds = [];
  try {
    await step("the admin, Ana and Ben sign in; the admin opens Simulated", async () => {
      [admin, ana, ben] = await Promise.all([signIn(browser, "chrislim@kiasa.tech", "admin"), signIn(browser, "ana@example.com", "ana"), signIn(browser, "ben@example.com", "ben")]);
      await admin.page.goto(BASE + "/admin/simulated");
      await hydrated(admin.page, ".sims-add");
    });
    await step("the admin adds three: each asks for an account, and its request reaches the admins' chat", async () => {
      await admin.page.getByLabel("How many to add").fill("3");
      await admin.page.getByRole("button", { name: "Add them" }).click();
      await admin.page.locator(".admin-notice", { hasText: "3 people ask for an account now." }).waitFor({ timeout: 30000 });
      await admin.page.locator(".sims-table tbody tr").nth(2).waitFor({ timeout: 10000 });
      const { data } = await site.from("sim_members").select("user_id");
      simIds = data.map(row => row.user_id);
      const { data: cards } = await site.from("messages").select("attachment").eq("attachment->>type", "request").in("attachment->>id", simIds);
      if (cards.length !== 3) throw new Error(`${cards.length} request cards`);
      return `${simIds.length} made`;
    });
    await step("all three approved and put in Sales at once", async () => {
      await admin.page.getByLabel("Choose everyone").check();
      await admin.page.locator(".sims-bulk").getByRole("button", { name: "Approve" }).click();
      await admin.page.locator(".admin-notice", { hasText: "3 approved." }).waitFor({ timeout: 10000 });
      await admin.page.getByLabel("Put everyone chosen in a team").selectOption({ label: "Sales" });
      await admin.page.locator(".admin-notice", { hasText: "3 put in the team." }).waitFor({ timeout: 10000 });
      const { count } = await site.from("team_members").select("user_id", { count: "exact", head: true }).in("user_id", simIds).eq("team_id", sales.id);
      if (count !== 3) throw new Error(`${count} in Sales`);
    });
    await step("their hours set to all day, every day: all three at work now", async () => {
      await admin.page.getByLabel("Choose everyone").check();
      await admin.page.getByLabel("From", { exact: true }).fill("00:00");
      await admin.page.getByLabel("To", { exact: true }).fill("23:59");
      for (const day of ["Sat", "Sun"]) await admin.page.locator(".sims-days label", { hasText: day }).locator("input").check();
      await admin.page.getByRole("button", { name: "Set hours" }).click();
      await admin.page.locator(".admin-notice", { hasText: "Saved for 3." }).waitFor({ timeout: 10000 });
      await admin.page.locator(".sims-now", { hasText: "At work" }).nth(2).waitFor({ timeout: 10000 });
    });
    await step("one renamed and given a photo", async () => {
      const first = admin.page.locator(".sims-name input").first();
      await first.fill("Maya Chen");
      await first.press("Enter");
      await admin.page.getByRole("textbox", { name: "Name of Maya Chen" }).waitFor({ timeout: 10000 });
      await admin.page.getByRole("button", { name: "Photo of Maya Chen" }).click();
      const dialog = admin.page.getByRole("dialog", { name: "Photo of Maya Chen" });
      await dialog.locator("input[type=file]").setInputFiles(picture);
      await dialog.getByRole("button", { name: "Save photo" }).click();
      await admin.page.getByRole("button", { name: "Photo of Maya Chen" }).locator(".avatar-photo").waitFor({ timeout: 10000 });
      await shot(admin.page, "1-admin-simulated");
    });
    await step("a name already someone's is refused (case aside); the three made have three different names", async () => {
      const first = admin.page.getByRole("textbox", { name: "Name of Maya Chen" });
      await first.fill("ana silva");
      await first.press("Enter");
      await admin.page.locator(".admin-notice[data-failed]", { hasText: "is already someone's name" }).waitFor({ timeout: 10000 });
      await admin.page.getByRole("textbox", { name: "Name of Maya Chen" }).waitFor({ timeout: 10000 });
      const { data } = await site.from("profiles").select("name").in("id", simIds);
      if (new Set(data.map(row => row.name.toLowerCase())).size !== 3) throw new Error(`names: ${data.map(row => row.name).join(", ")}`);
    });
    await step("Ana, a real member, sees none of them: not beside the chat, not in Jobs, not in the database", async () => {
      await openChat(ana.page);
      const listed = await sections(ana.page);
      if (!listed.includes("Sales, 2")) throw new Error(`Ana sees: ${listed.join(" / ")}`);
      const asAna = await as("ana@example.com");
      const [members, photos, board] = await Promise.all([
        asAna.from("team_members").select("user_id").in("user_id", simIds),
        asAna.from("avatars").select("user_id").in("user_id", simIds),
        asAna.rpc("team_board"),
      ]);
      if (members.data.length || photos.data.length) throw new Error("Ana can read their team or photo");
      if (board.data.some(row => simIds.includes(row.user_id))) throw new Error("they are on Ana's leaderboard");
      const direct = await asAna.rpc("open_direct", { other: simIds[0] });
      if (!direct.error) throw new Error("Ana opened a chat with one");
      await ana.page.goto(BASE + "/jobs");
      await hydrated(ana.page, "main");
      if (await ana.page.getByText("Maya Chen").count()) throw new Error("Ana sees Maya Chen in Jobs");
      return listed.join(" / ");
    });
    await step("Ben, named a tester, sees them in Sales, online at work, with their photo; they take no messages", async () => {
      await admin.page.locator(".sims-tester", { hasText: "Ben Okoro" }).locator("input").check();
      for (let tries = 0; tries < 50; tries++) {
        if ((await site.from("testers").select("user_id").eq("user_id", id("ben@example.com")).maybeSingle()).data) break;
        await new Promise(done => setTimeout(done, 200));
      }
      await openChat(ben.page);
      const listed = await sections(ben.page);
      if (!listed.includes("Sales, 5")) throw new Error(`Ben sees: ${listed.join(" / ")}`);
      const maya = ben.page.locator(".chat-member", { hasText: "Maya Chen" });
      await maya.locator(".chat-online").waitFor({ timeout: 10000 });
      await maya.locator(".avatar-photo").waitFor({ timeout: 10000 });
      await shot(ben.page, "2-ben-tester-members");
      await maya.click();
      await ben.page.locator(".chat-notice-bar", { hasText: "Maya is not taking messages." }).waitFor({ timeout: 10000 });
      return listed.join(" / ");
    });
    await step("Ben makes a Sales group with Maya and Ana: Ben sees three; Ana sees two, and no notice names Maya", async () => {
      await ben.page.getByRole("button", { name: "New chat" }).click();
      await ben.page.getByRole("menuitem", { name: "New group" }).click();
      const picker = ben.page.getByRole("dialog", { name: "New group" });
      await picker.getByLabel("Group name").fill("Sales floor");
      for (const name of ["Maya Chen", "Ana Silva"]) await picker.locator(".chat-person", { hasText: name }).locator("input").check();
      await picker.getByRole("button", { name: /^Make the group/ }).click();
      await ben.page.locator(".chat-head-title", { hasText: "Sales floor" }).waitFor({ timeout: 10000 });
      await ben.page.locator(".chat-head-status", { hasText: /^3 members/ }).waitFor({ timeout: 10000 });
      await ana.page.goto(BASE + "/chat");
      await hydrated(ana.page, ".chat");
      await ana.page.locator(".chat-row", { hasText: "Sales floor" }).click();
      await ana.page.locator(".chat-head-status", { hasText: /^2 members/ }).waitFor({ timeout: 10000 });
      const notices = await ana.page.locator(".chat-notice").allTextContents();
      if (notices.some(text => text.includes("Maya"))) throw new Error(`a notice names Maya: ${notices.join(" | ")}`);
      const panel = await ana.page.getByRole("complementary", { name: "In this group" }).locator(".chat-member-name").allTextContents();
      if (panel.some(name => name.includes("Maya"))) throw new Error("Maya is listed for Ana");
      // Ben still cannot write to her alone.
      const asBen = await as("ben@example.com");
      const direct = await asBen.rpc("open_direct", { other: simIds.find(Boolean) });
      if (!direct.error) throw new Error("Ben opened a chat with a simulated member");
      await shot(ben.page, "2b-ben-group");
      return panel.join(", ");
    });
    await step("paused, Maya shows offline for Ben", async () => {
      await admin.page.locator(".sims-table tr", { has: admin.page.getByRole("textbox", { name: "Name of Maya Chen" }) }).getByRole("button", { name: "Pause" }).click();
      await admin.page.locator(".sims-now", { hasText: "Paused" }).waitFor({ timeout: 10000 });
      await openChat(ben.page);
      await ben.page.locator(".chat-member[data-offline]", { hasText: "Maya Chen" }).waitFor({ timeout: 10000 });
    });
    await step("their daily plan set to 20 for all three; a round of work applies only to today's real links, never past them", async () => {
      // Ten real links, posted today; the paused one does nothing.
      const links = Array.from({ length: 10 }, (_, n) => ({ url: `https://jobs.example.com/sims-test/${Date.now()}-${n}`, title: `Role ${n + 1}`, company: "Example" }));
      const { error: posted } = await site.from("jobs").insert(links);
      if (posted) throw new Error(posted.message);
      await admin.page.goto(BASE + "/admin/simulated");
      await hydrated(admin.page, ".sims-add");
      await admin.page.getByLabel("Choose everyone").check();
      await admin.page.getByLabel("Applications a day").fill("20");
      await admin.page.getByRole("button", { name: "Set plan" }).click();
      await admin.page.locator(".admin-notice", { hasText: "20 applications a day, from today, for 3." }).waitFor({ timeout: 10000 });
      await admin.page.getByRole("button", { name: "Work a round now" }).click();
      await admin.page.locator(".admin-notice", { hasText: /applications? made|Nothing to do now/ }).waitFor({ timeout: 20000 });
      const today = await todaysLinks();
      const { data: made } = await site.from("applications").select("user_id, job_id").in("user_id", simIds);
      const { data: maya } = await site.from("profiles").select("id").in("id", simIds).eq("name", "Maya Chen").single();
      const per = Object.fromEntries(simIds.map(id => [id, made.filter(row => row.user_id === id).length]));
      if (per[maya.id]) throw new Error("the paused one applied");
      if (made.some(row => !today.ids.includes(row.job_id))) throw new Error("an application is not on one of today's links");
      if (Object.values(per).some(count => count > today.ids.length)) throw new Error("more applications than links");
      // Again at once: no one is behind any more, so nothing more.
      await site.rpc("sims_work");
      const { count: again } = await site.from("applications").select("job_id", { count: "exact", head: true }).in("user_id", simIds);
      if (again !== made.length) throw new Error(`a second round made ${again - made.length} more`);
      await admin.page.locator(".sims-table td", { hasText: /\d+ of \d+applications/ }).first().waitFor({ timeout: 10000 });
      await shot(admin.page, "3-admin-at-work");
      return `today: ${Object.values(per).join(", ")} (the paused one 0), on ${today.ids.length} links`;
    });
    await step("no links left today: a round makes nothing; Ana's leaderboard still has none of them", async () => {
      await site.from("jobs").delete().like("url", "%/sims-test/%");
      const today = await todaysLinks();
      await Promise.all(today.rows.map(row => site.from("jobs").update({ posted_at: new Date(Date.parse(row.posted_at) - 86_400_000).toISOString() }).eq("id", row.id)));
      // Behind for sure: everything they did today taken back.
      await site.from("applications").delete().in("user_id", simIds);
      const { data: made } = await site.rpc("sims_work");
      await Promise.all(today.rows.map(row => site.from("jobs").update({ posted_at: row.posted_at }).eq("id", row.id)));
      if (made) throw new Error(`${made} made with no links`);
      const asAna = await as("ana@example.com");
      const { data: board } = await asAna.rpc("team_board");
      if (board.some(row => simIds.includes(row.user_id))) throw new Error("they are on Ana's leaderboard");
    });
    await step("the database: only an admin manages them, and no one real is touched", async () => {
      const asBen = await as("ben@example.com");
      const write = await asBen.from("sim_members").update({ paused: false }).in("user_id", simIds).select("user_id");
      if (write.data?.length) throw new Error("Ben changed a simulated member");
    });
    await step("all deleted at once: gone from the admin's page and the database", async () => {
      await admin.page.getByLabel("Choose everyone").check();
      await admin.page.locator(".sims-bulk").getByRole("button", { name: "Delete" }).click();
      await admin.page.locator(".sims-bulk .admin-confirm").getByRole("button", { name: "Delete" }).click();
      await admin.page.locator(".admin-notice", { hasText: "3 deleted." }).waitFor({ timeout: 20000 });
      const { count } = await site.from("profiles").select("id", { count: "exact", head: true }).in("id", simIds);
      if (count) throw new Error(`${count} still there`);
    });
  } finally {
    console.log(results.join("\n"));
    console.log("page errors:", errors.length ? errors.join(" | ") : "none");
    await clearSims();
    await site.from("jobs").delete().like("url", "%/sims-test/%");
    await site.from("testers").delete().not("user_id", "is", null);
    await site.from("teams").delete().not("id", "is", null);
    await site.from("top_managers").delete().not("user_id", "is", null);
    await browser.close();
  }
  process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
})().catch(error => { console.log(results.join("\n")); console.error("stopped:", error.message); process.exit(1); });
