// End-to-end test of KIASA Jobs against the LOCAL Supabase copy: the admin, Ana
// and Ben in their own browsers at once. Prints PASS/FAIL per step and how fast
// changes reach the others. Usage, from apps/web: npx supabase start;
// npm run chat:local:seed; npm run jobs:local:seed; serve a build made with the
// local copy's keys on port 3002 (see docs/site.md); then npm run jobs:local:e2e.
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const { execSync } = require("child_process");
const os = require("os");
const path = require("path");
function localEnv() {
  const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]*)"?`, "m")) || [])[1] || "";
  const env = { url: get("API_URL"), secret: get("SECRET_KEY") || get("SERVICE_ROLE_KEY"), publishable: get("PUBLISHABLE_KEY") || get("ANON_KEY") };
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error("Refusing: this is only for the local Supabase copy");
  return env;
}
const env = localEnv();
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const out = path.join(os.tmpdir(), "kiasa-jobs-e2e");
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

async function signIn(browser, email, label, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...options });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  page.on("console", message => { if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) errors.push(`${label} console: ${message.text().slice(0, 160)}`); });
  await page.goto(BASE + "/sign-in");
  await hydrated(page, "form");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(people[email].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
  return { context, page };
}
async function openJobs(page, tab) {
  await page.goto(`${BASE}/jobs${tab ? `?tab=${tab}` : ""}`);
  await hydrated(page, ".jobs-app");
}
const tab = (page, name) => page.getByRole("navigation", { name: "KIASA Jobs" }).getByRole("button", { name });
const row = (page, title) => page.locator(".jobs-row", { has: page.locator(".jobs-row-title", { hasText: title }) });
const show = (page, name) => page.getByRole("group", { name: "Show" }).getByRole("button", { name });
// For timings: looks every 10 ms.
const appears = (page, selector, text, timeout = 10000) => page.waitForFunction(([selector, text]) =>
  [...document.querySelectorAll(selector)].some(node => node.textContent.includes(text)), [selector, text], { polling: 10, timeout });

(async () => {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const zone = (await site.from("job_settings").select("timezone").eq("id", 1).single()).data?.timezone ?? "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
  const token = Date.now().toString(36);
  const titles = [`E2E Frontend Engineer ${token}`, `E2E Platform Engineer ${token}`, `E2E Data Engineer ${token}`];
  // Each with its title and a company the address does not say, so the bot has nothing to read (no request leaves this computer).
  const links = [
    `${titles[0]} | Testco Group | https://boards.greenhouse.io/testco/jobs/${token}1`,
    `${titles[1]}\tPlatformco Ltd\thttps://jobs.lever.co/platformco/${token}2?utm_source=newsletter`,
    `${titles[2]} | Dataco Labs | https://jobs.ashbyhq.com/dataco/${token}3`,
  ].join("\n");
  // Pasting, as the admin does: the bot saves what is pasted, with no button.
  const paste = (page, text) => page.evaluate(text => {
    const box = document.querySelector(".jobs-bot-input textarea");
    box.focus();
    const data = new DataTransfer();
    data.setData("text/plain", text);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  // Ben starts with no résumé, so the one he adds becomes his default (as a member's first does).
  const benId = people["ben@example.com"].id;
  // Everyone a member again, as a run cut short may have left Ben a top manager.
  await site.from("top_managers").delete().not("user_id", "is", null);
  const { data: kept } = await site.from("resumes").select("path").eq("user_id", benId);
  if (kept?.length) {
    await site.storage.from("resumes").remove(kept.map(resume => resume.path));
    await site.from("resumes").delete().eq("user_id", benId);
  }
  // The local realtime server sleeps when no one is connected, and what the
  // database says in its first seconds awake can be lost: woken first.
  const wake = site.channel("wake").on("postgres_changes", { event: "INSERT", schema: "public", table: "jobs" }, () => {});
  await new Promise(resolve => wake.subscribe(status => { if (status !== "CLOSED") resolve(); }));
  await new Promise(done => setTimeout(done, 3000));
  await site.removeChannel(wake);
  const browser = await chromium.launch();
  let admin, ana, ben;

  await step("the admin, Ana and Ben open KIASA Jobs: the admin on Live, members on Today", async () => {
    [admin, ana, ben] = await Promise.all([signIn(browser, "chrislim@kiasa.tech", "admin"), signIn(browser, "ana@example.com", "ana"), signIn(browser, "ben@example.com", "ben")]);
    await Promise.all([openJobs(admin.page), openJobs(ana.page), openJobs(ben.page)]);
    await admin.page.getByRole("heading", { name: "Today, member by member" }).waitFor();
    await ana.page.getByRole("heading", { name: "Today's jobs" }).waitFor();
    await ben.page.getByRole("heading", { name: "Today's jobs" }).waitFor();
    // Members' photos stay in their circles (one once filled the screen).
    await admin.page.locator(".jobs-avatar .avatar-photo").first().waitFor({ timeout: 10000 });
    const sizes = await admin.page.evaluate(() => [...document.querySelectorAll(".jobs-avatar .avatar-photo")].map(photo => Math.round(photo.getBoundingClientRect().width)));
    if (sizes.some(width => width > 40)) throw new Error(`photos ${sizes.join(", ")} px wide; their circles are 30`);
    // The live channels join a moment after the page.
    await ana.page.waitForTimeout(2500);
  });

  await step("each member has a card on the admin's Live, with the day's goal on it (100, as planned or by default); the team's goal on its chart", async () => {
    await admin.page.locator(".jobs-member").first().waitFor({ timeout: 10000 });
    const cards = await admin.page.locator(".jobs-member").count();
    const members = await admin.page.locator(".jobs-table tbody tr").count();
    if (cards !== members) throw new Error(`${cards} cards for ${members} members`);
    await admin.page.locator(".jobs-member .jobs-chart-goal text").first().waitFor({ timeout: 10000 });
    const goals = (await admin.page.locator(".jobs-member .jobs-chart-goal text").allTextContents()).map(goal => Number(/^Goal (\d+)$/.exec(goal)?.[1]));
    // (A run before this one may have left Ben's day at five: each card says its member's own.)
    if (goals.length !== cards || goals.some(goal => !goal) || !goals.includes(100)) throw new Error(`the cards' goals: ${goals.join(", ")}`);
    const team = await admin.page.locator("#jobs-days-title ~ .jobs-chart .jobs-chart-goal text").textContent();
    const sum = goals.reduce((total, goal) => total + goal, 0);
    if (team !== `Goal ${sum}`) throw new Error(`the team's chart says “${team}”, not Goal ${sum}`);
    // Ana sees hers above her list.
    const hers = await ana.page.locator(".jobs-plan .jobs-goal").first().locator(".jobs-meter-text").textContent();
    if (!/\/\s*100/.test(hers ?? "")) throw new Error(`Ana's day reads “${hers}”`);
    return `${cards} cards (goals ${goals.join(", ")}); the team's Goal ${sum}`;
  });

  await step("the admin makes Ben a top manager: the leaf shows on his own photo, Live drops his card at once; made a member again, all comes back", async () => {
    // The admin wears the crown and the leaf.
    const own = admin.page.locator(".jobs-bar .account-initials").first();
    if (await own.locator(".rank-crown").count() !== 1 || await own.locator(".rank-leaf").count() !== 1) throw new Error("the admin's photo has no crown and leaf");
    const desk = await admin.context.newPage();
    await desk.goto(BASE + "/admin");
    await hydrated(desk, ".admin-table");
    const cards = () => admin.page.locator(".jobs-member-name").allTextContents();
    if (!(await cards()).includes("Ben Okoro")) throw new Error("Ben has no card to begin with");
    const role = desk.getByLabel("Role of Ben Okoro");
    await role.selectOption("top");
    const at = Date.now();
    await admin.page.waitForFunction(() => ![...document.querySelectorAll(".jobs-member-name")].some(name => name.textContent === "Ben Okoro"), null, { polling: 10, timeout: 10000 });
    const gone = Date.now() - at;
    await ben.page.locator(".jobs-bar .account-initials .rank-leaf").waitFor({ timeout: 10000 });
    const seen = Date.now() - at;
    await desk.reload();
    await hydrated(desk, ".admin-table");
    if (await desk.getByLabel("Role of Ben Okoro").inputValue() !== "top") throw new Error("the admin table forgot it");
    await desk.getByLabel("Role of Ben Okoro").selectOption("member");
    await admin.page.locator(".jobs-member-name", { hasText: "Ben Okoro" }).waitFor({ timeout: 10000 });
    await ben.page.locator(".jobs-bar .account-initials .rank-leaf").waitFor({ state: "detached", timeout: 10000 });
    await desk.close();
    return `his card gone ${gone} ms after the choice, his own leaf ${seen} ms`;
  });

  await step("Ben, made Sales' manager with Ana in it, gets My team: Ana's day as the admin sees it, and no one else's", async () => {
    await site.from("teams").delete().not("id", "is", null);
    const { data: sales } = await site.from("teams").insert({ name: "Sales", color: "#e5484d" }).select("id").single();
    await site.from("top_managers").insert({ user_id: benId, granted_by: "jobs test" });
    await site.from("team_members").insert([{ user_id: benId, team_id: sales.id }, { user_id: people["ana@example.com"].id, team_id: sales.id }]);
    try {
      // Live: the tab comes the moment he leads a team.
      await ben.page.getByRole("button", { name: "My team" }).click({ timeout: 10000 });
      await ben.page.getByRole("heading", { name: "Sales today, member by member" }).waitFor({ timeout: 10000 });
      const names = (await ben.page.locator(".jobs-table tbody th").allTextContents()).map(name => name.trim());
      // (Each row starts with the photo's initials and badge letter.)
      if (names.length !== 1 || !names[0].endsWith("Ana Silva")) throw new Error(`My team lists: ${names.join(", ")}`);
      const cards = await ben.page.locator(".jobs-member-name").allTextContents();
      if (cards.join() !== "Ana Silva") throw new Error(`cards: ${cards.join(", ")}`);
      if (await ben.page.getByText("Waiting to confirm").count()) throw new Error("a manager has things to confirm");
      if (await ben.page.locator(".jobs-tab", { hasText: "Résumés" }).count()) throw new Error("a manager has a Résumés tab");
      // The database gives him his team's days and plans, and no one else's.
      const asBen = createClient(env.url, env.publishable, { auth: { persistSession: false } });
      await asBen.auth.signInWithPassword({ email: "ben@example.com", password: people["ben@example.com"].password });
      const [trend, plans] = await Promise.all([asBen.rpc("team_trend", { days: 30 }), asBen.from("plans").select("user_id")]);
      const allowed = [benId, people["ana@example.com"].id];
      if ((trend.data ?? []).some(row => !allowed.includes(row.user_id))) throw new Error("Ben reads someone else's days");
      if (!(trend.data ?? []).some(row => row.user_id === people["ana@example.com"].id)) throw new Error("Ben cannot read Ana's days");
      if ((plans.data ?? []).some(row => !allowed.includes(row.user_id))) throw new Error("Ben reads someone else's plan");
      await ben.page.screenshot({ path: path.join(out, "manager-my-team.png"), fullPage: true });
      return `${(trend.data ?? []).length} days of Ana's`;
    } finally {
      await site.from("teams").delete().eq("id", sales.id);
      await site.from("top_managers").delete().eq("user_id", benId);
      await ben.page.goto(BASE + "/jobs");
      await hydrated(ben.page, ".jobs-app");
    }
  });

  await step("the admin pastes three links into the jobs bot: saved at once, on Ana's and Ben's lists live", async () => {
    await tab(admin.page, "Jobs").click();
    await admin.page.getByRole("heading", { name: "Jobs bot" }).waitFor();
    const started = Date.now();
    await paste(admin.page, links);
    await admin.page.locator(".jobs-bot-says", { hasText: "Saved 3 jobs for today" }).waitFor({ timeout: 10000 });
    const saved = Date.now() - started;
    await Promise.all([appears(ana.page, ".jobs-row-title", titles[0]), appears(ben.page, ".jobs-row-title", titles[0])]);
    await admin.page.locator(".jobs-bot-says", { hasText: "Done: 3 jobs named" }).waitFor({ timeout: 15000 });
    return `saved ${saved} ms after pasting, on their lists ${Date.now() - started} ms`;
  });

  await step("the same links again: nothing saved twice (tracking taken off the link)", async () => {
    await paste(admin.page, links.replace("?utm_source=newsletter", "?utm_source=other"));
    await admin.page.locator(".jobs-bot-says", { hasText: "All 3 are already on the list" }).waitFor({ timeout: 10000 });
    const { count } = await site.from("jobs").select("id", { count: "exact", head: true }).like("url", `%${token}%`);
    if (count !== 3) throw new Error(`${count} jobs with this run's links`);
  });

  await step("a paste taken back with Undo leaves everyone's list", async () => {
    const spare = `E2E Spare Job ${token}`;
    await paste(admin.page, `${spare} | Spare Holdings | https://jobs.example.com/spare/${token}`);
    await admin.page.locator(".jobs-bot-says", { hasText: "Saved 1 job for today" }).waitFor({ timeout: 10000 });
    await appears(ana.page, ".jobs-row-title", spare);
    await admin.page.locator(".jobs-bot-says", { hasText: "Saved 1 job for today" }).getByRole("button", { name: "Undo" }).click();
    await admin.page.getByRole("dialog").getByRole("button", { name: "Take them back" }).click();
    await admin.page.locator(".jobs-bot-says", { hasText: "Taken back" }).waitFor({ timeout: 10000 });
    await ana.page.waitForFunction(title => ![...document.querySelectorAll(".jobs-row-title")].some(node => node.textContent.includes(title)), spare, { timeout: 10000 });
  });

  await step("Ana marks one Applied: the admin's desk and Ben's list count her at once", async () => {
    const started = Date.now();
    await row(ana.page, titles[0]).getByRole("button", { name: `Applied: ${titles[0]}` }).click();
    await show(ana.page, /^Applied/).click();
    await row(ana.page, titles[0]).locator(".jobs-status").waitFor();
    const value = await row(ana.page, titles[0]).locator(".jobs-status").getAttribute("data-status");
    if (value !== "applied") throw new Error(`her status reads ${value}`);
    await admin.page.waitForFunction(title => [...document.querySelectorAll(".jobs-desk-row")].some(node =>
      node.textContent.includes(title) && /^1\s*\//.test(node.querySelector(".jobs-meter-text")?.textContent ?? "")), titles[0], { polling: 10, timeout: 10000 });
    const desk = Date.now() - started;
    await appears(ben.page, ".jobs-row", "1 on the team applied");
    return `the admin's desk ${desk} ms, Ben's list ${Date.now() - started} ms`;
  });

  await step("the résumé she used is kept with it", async () => {
    const { data } = await site.from("applications").select("resume_id, resumes(title, is_default)").eq("user_id", people["ana@example.com"].id).eq("job_id",
      (await site.from("jobs").select("id").eq("title", titles[0]).single()).data.id).single();
    if (!data?.resume_id || !data.resumes?.is_default) throw new Error(`résumé: ${JSON.stringify(data)}`);
    return data.resumes.title;
  });

  await step("Ana schedules an interview for it; it shows on the admin's calendar live", async () => {
    await tab(admin.page, "Calendars").click();
    await admin.page.getByRole("heading", { name: "This week" }).waitFor();
    await row(ana.page, titles[0]).locator(".jobs-status").click();
    await ana.page.getByRole("menuitemradio", { name: "Interview…" }).click();
    const dialog = ana.page.getByRole("dialog", { name: `Interview: ${titles[0]}` });
    await dialog.getByLabel("Date").fill(today);
    await dialog.getByLabel(/^Time/).fill("23:00");
    await dialog.getByLabel("Stage (optional)").fill("First call");
    await dialog.getByRole("button", { name: "Save interview" }).click();
    const started = Date.now();
    await dialog.waitFor({ state: "detached", timeout: 10000 });
    await appears(admin.page, ".jobs-event, .jobs-agenda-item", titles[0]);
    const status = await row(ana.page, titles[0]).locator(".jobs-status").getAttribute("data-status");
    if (status !== "interview") throw new Error(`her status reads ${status}`);
    return `on the admin's calendar ${Date.now() - started} ms after saving`;
  });

  await step("Ana got the job: it waits for the admin, who confirms it; her earnings and the leaderboard follow", async () => {
    await tab(admin.page, /^Confirm/).click();
    await row(ana.page, titles[0]).getByRole("button", { name: `More for ${titles[0]}` }).click();
    await ana.page.getByRole("menuitem", { name: "I got the job…" }).click();
    const dialog = ana.page.getByRole("dialog", { name: "You got the job" });
    await dialog.getByLabel(/^Monthly salary/).fill("7000");
    await dialog.getByRole("button", { name: "Send for confirming" }).click();
    await ana.page.getByText("counts on the leaderboard once an admin confirms it").waitFor({ timeout: 10000 });
    const waiting = admin.page.locator("tr", { hasText: titles[0] });
    await waiting.waitFor({ timeout: 10000 });
    await waiting.getByRole("button", { name: "Confirm" }).click();
    await waiting.waitFor({ state: "detached", timeout: 10000 });
    await tab(ana.page, "Earnings").click();
    await ana.page.locator(".jobs-ledger li", { hasText: titles[0] }).locator(".jobs-chip", { hasText: "Confirmed" }).waitFor({ timeout: 10000 });
    const board = (await createClient(env.url, env.secret, { auth: { persistSession: false } }).from("positions").select("monthly_salary, status").eq("title", titles[0]).single()).data;
    if (board?.status !== "confirmed" || Number(board.monthly_salary) !== 7000) throw new Error(JSON.stringify(board));
    await tab(ben.page, "Leaderboard").click();
    await ben.page.locator(".jobs-board tr", { hasText: "Ana Silva" }).waitFor();
    await tab(ana.page, "Today").click();
  });

  await step("the admin sets Ben's day: five applications and a note; Ben sees both live", async () => {
    await tab(admin.page, "Plans").click();
    await admin.page.getByLabel("applications for Ben Okoro").fill("5");
    await admin.page.getByLabel("Note for Ben Okoro").fill(`Try the platform roles ${token}`);
    await admin.page.getByRole("button", { name: "Save plans" }).click();
    await admin.page.getByText("Saved for 1 member.").waitFor({ timeout: 10000 });
    const started = Date.now();
    await tab(ben.page, "Today").click();
    await appears(ben.page, ".jobs-plan-notes", `Try the platform roles ${token}`);
    await appears(ben.page, ".jobs-goal", "/ 5");
    return `${Date.now() - started} ms`;
  });

  await step("Ben adds a résumé; it becomes his default and is offered above the list", async () => {
    await tab(ben.page, "Résumés").click();
    await ben.page.getByLabel("Title").fill(`Platform ${token}`);
    await ben.page.getByLabel(/^File/).setInputFiles({ name: "ben-okoro.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
    await ben.page.getByRole("button", { name: "Add résumé" }).click();
    await ben.page.locator(".jobs-ledger li", { hasText: `Platform ${token}` }).locator(".jobs-you", { hasText: "Default" }).waitFor({ timeout: 10000 });
    await tab(ben.page, "Today").click();
    const chosen = await ben.page.locator(".jobs-resume-pick select option:checked").textContent();
    if (!chosen?.includes(`Platform ${token}`)) throw new Error(`applying with ${chosen}`);
  });

  await step("Ben clicks Applied by mistake: the job stays in his To do list, and its dropdown takes it back; he skips another from the dropdown", async () => {
    await show(ben.page, /^To do/).click();
    await row(ben.page, titles[1]).getByRole("button", { name: `Applied: ${titles[1]}` }).click();
    const status = row(ben.page, titles[1]).locator(".jobs-status");
    await status.waitFor({ timeout: 10000 });
    if (await status.getAttribute("data-status") !== "applied") throw new Error(`it reads ${await status.getAttribute("data-status")}`);
    await status.click();
    const options = await ben.page.getByRole("menu", { name: `Status of ${titles[1]}` }).getByRole("menuitemradio").allTextContents();
    if (!options.join("|").includes("Applied")) throw new Error(`the dropdown offers ${options.join(", ")}`);
    await ben.page.getByRole("menuitem", { name: "Not applied: back to To do" }).click();
    await row(ben.page, titles[1]).getByRole("button", { name: `Applied: ${titles[1]}` }).waitFor({ timeout: 10000 });
    await row(ben.page, titles[2]).getByRole("button", { name: `Other status for ${titles[2]}` }).click();
    await ben.page.getByRole("menuitemradio", { name: "Skipped (not a fit)" }).click();
    await show(ben.page, /^Skipped/).click();
    await row(ben.page, titles[2]).waitFor({ timeout: 10000 });
    const { data } = await site.from("applications").select("job_id, status, applied_at").eq("user_id", people["ben@example.com"].id).in("job_id",
      ((await site.from("jobs").select("id").in("title", [titles[1], titles[2]])).data ?? []).map(job => job.id));
    if (data.length !== 1 || data[0].status !== "skipped" || data[0].applied_at !== null) throw new Error(JSON.stringify(data));
  });
  await ben.page.screenshot({ path: path.join(out, "ben-today.png"), fullPage: false });
  await admin.page.screenshot({ path: path.join(out, "admin-plans.png"), fullPage: false });

  await step("on a phone: Ana's day fits the screen, and Applied works with a tap", async () => {
    const phone = await signIn(browser, "ana@example.com", "ana-phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await openJobs(phone.page);
    await row(phone.page, titles[1]).getByRole("button", { name: `Applied: ${titles[1]}` }).tap();
    await show(phone.page, /^Applied/).tap();
    await row(phone.page, titles[1]).locator(".jobs-status[data-status='applied']").waitFor({ timeout: 10000 });
    const wide = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await phone.page.screenshot({ path: path.join(out, "phone-today.png") });
    if (wide > 0) throw new Error(`the page is ${wide}px wider than the phone`);
  });

  await step("Ana edits her details: the new name reaches her chats; then her password, a wrong current one refused (both put back)", async () => {
    const anaId = people["ana@example.com"].id;
    const editName = async name => {
      await ana.page.getByRole("button", { name: "Edit details" }).click();
      await ana.page.getByLabel("Name", { exact: true }).fill(name);
      await ana.page.getByRole("button", { name: "Save details" }).click();
      await ana.page.getByText("Your details are saved.").waitFor({ timeout: 10000 });
    };
    // Her name has to show in a chat to be seen changing there: one with Ben, if she has none yet.
    const { data: had } = await site.from("chat_members").select("chat_id").eq("user_id", anaId).limit(1);
    if (!had?.length) {
      const { data: made, error } = await site.from("chats").insert({ kind: "direct", created_by: anaId }).select("id").single();
      if (error) throw new Error(`no chat for Ana: ${error.message}`);
      await site.from("chat_members").insert([{ chat_id: made.id, user_id: anaId, name: "Ana Silva" }, { chat_id: made.id, user_id: people["ben@example.com"].id, name: "Ben Okoro" }]);
    }
    await ana.page.goto(BASE + "/account");
    await editName("Ana Silva-Moreno");
    await ana.page.locator(".account-details dd", { hasText: "Ana Silva-Moreno" }).waitFor({ timeout: 10000 });
    const { data: names } = await site.from("chat_members").select("name").eq("user_id", anaId);
    if (!names?.length || names.some(row => row.name !== "Ana Silva-Moreno")) throw new Error(`her chats show ${JSON.stringify(names)}`);
    await editName("Ana Silva");
    const password = people["ana@example.com"].password;
    const changeTo = async (current, next) => {
      await ana.page.getByRole("button", { name: "Change password" }).click();
      await ana.page.getByLabel("Current password").fill(current);
      await ana.page.getByLabel(/^New password \(/).fill(next);
      await ana.page.getByLabel("New password again").fill(next);
      await ana.page.locator("form[aria-label='Change your password']").getByRole("button", { name: "Change password" }).click();
    };
    await changeTo("not her password at all", "a brand new password 1");
    await ana.page.getByText("That is not your current password.").waitFor({ timeout: 10000 });
    await ana.page.getByRole("button", { name: "Cancel" }).click();
    await changeTo(password, "a brand new password 1");
    await ana.page.getByText("Your password is changed").waitFor({ timeout: 10000 });
    await changeTo("a brand new password 1", password);
    await ana.page.getByText("Your password is changed").waitFor({ timeout: 10000 });
  });

  console.log(results.join("\n"));
  console.log("page errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  // Done: nothing left open (a realtime connection, a browser's child) keeps the run waiting.
  process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
