// End-to-end test of KIASA Chat's team rules against the LOCAL Supabase copy:
// who may message whom, asking the admin and the admin approving, a team
// manager's group (its people only, renamed, a photo), the admin reading every
// chat unseen, and leaving a team. Two teams: Sales, led by Ben, with Ana; and
// Platform, led by Eli, with Dia. Prints PASS/FAIL per step. Usage, from
// apps/web: npx supabase start; npm run chat:local:seed; serve a build made
// with the local copy's keys on port 3002 (see docs/site.md); then
// npm run teams:local:e2e.
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
const out = path.join(os.tmpdir(), "kiasa-teams-e2e");
const BASE = "http://127.0.0.1:3002";
fs.mkdirSync(out, { recursive: true });
const id = email => people[email].id;
const results = [];
const errors = [];
// Every open page, so a failed step leaves a picture of each.
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  await page.goto(BASE + "/sign-in");
  await hydrated(page, "form");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(people[email].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
  await page.goto(BASE + "/chat");
  await hydrated(page, ".chat");
  await page.locator(".chat-live[data-state='live']").waitFor({ state: "attached", timeout: 20000 });
  pages.push({ page, label });
  return { context, page, label };
}
/** Someone, signed in to the database as themselves, as their browser is. */
async function as(email) {
  const client = createClient(env.url, env.publishable, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: people[email].password });
  return client;
}
const row = (page, title) => page.locator(".chat-row", { has: page.locator(".chat-row-title", { hasText: title }) });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

(async () => {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  // From nothing: no chats, requests, teams or top managers from earlier runs.
  await site.from("chats").delete().not("id", "is", null);
  await site.from("contact_requests").delete().not("id", "is", null);
  await site.from("teams").delete().not("id", "is", null);
  await site.from("top_managers").delete().not("user_id", "is", null);
  const { data: made } = await site.from("teams").insert([{ name: "Sales", color: "#e5484d" }, { name: "Platform", color: "#0090ff" }]).select("id, name");
  const team = Object.fromEntries(made.map(row => [row.name, row.id]));
  await site.from("top_managers").insert([{ user_id: id("ben@example.com"), granted_by: "teams test" }, { user_id: id("eli@example.com"), granted_by: "teams test" }]);
  await site.from("team_members").insert([
    { user_id: id("ben@example.com"), team_id: team.Sales }, { user_id: id("ana@example.com"), team_id: team.Sales },
    { user_id: id("eli@example.com"), team_id: team.Platform }, { user_id: id("dia@example.com"), team_id: team.Platform },
  ]);
  // The local realtime server sleeps when no one is connected: woken first.
  const wake = site.channel("wake").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {});
  await new Promise(resolve => wake.subscribe(status => { if (status !== "CLOSED") resolve(); }));
  await new Promise(done => setTimeout(done, 3000));
  await site.removeChannel(wake);
  const picture = path.join(out, "sales.png");
  await sharp({ create: { width: 400, height: 300, channels: 3, background: "#e5484d" } }).png().toFile(picture);

  const browser = await chromium.launch();
  let admin, ana, ben, dia;
  try {
    await step("the admin, Ana, Ben (Sales' manager) and Dia (Platform) open KIASA Chat", async () => {
      [admin, ana, ben, dia] = await Promise.all([signIn(browser, "chrislim@kiasa.tech", "admin"), signIn(browser, "ana@example.com", "ana"),
        signIn(browser, "ben@example.com", "ben"), signIn(browser, "dia@example.com", "dia")]);
    });

    // ── The database's rules, asked as each person.
    await step("the database: Ana may message her manager and the admin, but not Dia; one manager not another", async () => {
      const [asAna, asBen, asDia] = await Promise.all([as("ana@example.com"), as("ben@example.com"), as("dia@example.com")]);
      const tried = async (client, other) => (await client.rpc("open_direct", { other: id(other) })).error;
      const free = await Promise.all([tried(asAna, "ben@example.com"), tried(asAna, "chrislim@kiasa.tech"), tried(asDia, "eli@example.com")]);
      if (free.some(Boolean)) throw new Error(`a free chat was refused: ${free.find(Boolean).message}`);
      const refused = await Promise.all([tried(asAna, "dia@example.com"), tried(asBen, "eli@example.com"), tried(asBen, "dia@example.com")]);
      if (refused.some(error => error?.hint !== "ask")) throw new Error("a chat across teams, or between managers, was allowed");
      // An old chat across teams (made before the rules): it can be opened, but no one may write in it.
      const { data: old } = await site.from("chats").insert({ kind: "direct" }).select("id").single();
      await site.from("chat_members").insert([{ chat_id: old.id, user_id: id("ana@example.com"), name: "Ana Silva" }, { chat_id: old.id, user_id: id("dia@example.com"), name: "Dia Rahman" }]);
      const sneak = await asAna.from("messages").insert({ chat_id: old.id, sender_id: id("ana@example.com"), body: "across teams" });
      await site.from("chats").delete().eq("id", old.id);
      if (!sneak.error) throw new Error("Ana wrote to Dia across teams");
      return refused.map(error => error.message).join(" / ");
    });

    // ── Asking the admin, from the chat.
    await step("Ana chooses Dia in New message: a warning says why, and she asks the admin", async () => {
      await ana.page.getByRole("button", { name: "New message" }).click();
      const dia = ana.page.locator(".chat-person", { hasText: "Dia Rahman" });
      await dia.getByText("Needs the admin's approval").waitFor({ timeout: 10000 });
      await dia.click();
      const dialog = ana.page.getByRole("dialog", { name: "Message Dia Rahman" });
      const warning = await dialog.locator(".chat-ask-warning").textContent();
      if (!/in Platform, not in your team/.test(warning)) throw new Error(`warning: ${warning}`);
      await dialog.getByLabel(/Why you want to message Dia/).fill("To plan the launch with Platform");
      await shot(ana.page, "1-ana-asks");
      await dialog.getByRole("button", { name: "Ask the admin" }).click();
      await ana.page.locator(".chat-notice-bar", { hasText: "is with the admin" }).waitFor({ timeout: 10000 });
      return warning.trim();
    });
    await step("Ben, a manager, gets a manager's warning for Eli, another manager", async () => {
      await ben.page.getByRole("searchbox", { name: "Search chats" }).fill("Eli");
      await ben.page.getByRole("list", { name: "People" }).getByRole("button", { name: /Eli Novak/ }).click();
      const dialog = ben.page.getByRole("dialog", { name: "Message Eli Novak" });
      const warning = await dialog.locator(".chat-ask-warning").textContent();
      if (!/manager too/.test(warning)) throw new Error(`warning: ${warning}`);
      await shot(ben.page, "2-ben-manager-warning");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await ben.page.getByRole("searchbox", { name: "Search chats" }).fill("");
      return warning.trim();
    });
    await step("the admin's Contact requests chat gets the card live; the admin approves it", async () => {
      await row(admin.page, "Contact requests").click({ timeout: 15000 });
      const card = admin.page.locator(".chat-request", { hasText: "Ana Silva → Dia Rahman" });
      await card.getByText("To plan the launch with Platform").waitFor({ timeout: 10000 });
      await shot(admin.page, "3-admin-card");
      await card.getByRole("button", { name: "Approve" }).click();
      await card.locator(".chat-request-status", { hasText: "Approved by Chris Lim" }).waitFor({ timeout: 10000 });
    });
    await step("Ana hears of it from KIASA, opens Dia and writes; Dia gets it", async () => {
      await row(ana.page, "KIASA").locator(".chat-row-preview", { hasText: "You can message Dia Rahman now" }).waitFor({ timeout: 10000 });
      await ana.page.getByRole("button", { name: "New message" }).click();
      await ana.page.locator(".chat-person", { hasText: "Dia Rahman" }).click();
      await ana.page.locator(".chat-head-title", { hasText: "Dia Rahman" }).waitFor({ timeout: 10000 });
      await ana.page.getByRole("textbox", { name: "Message" }).fill("Hi Dia, about the launch");
      await ana.page.getByRole("button", { name: "Send" }).click();
      await row(dia.page, "Ana Silva").locator(".chat-row-preview", { hasText: "Hi Dia, about the launch" }).waitFor({ timeout: 10000 });
    });

    // ── A team manager's group.
    await step("Ben makes a group for Sales: the picker offers only Sales' people; Ana sees it live", async () => {
      await ben.page.getByRole("button", { name: "New chat" }).click();
      await ben.page.getByRole("menuitem", { name: "New group" }).click();
      const picker = ben.page.getByRole("dialog", { name: "New group" });
      const names = await picker.locator(".chat-person-text > span:first-child").allTextContents();
      if (names.join() !== "Ana Silva") throw new Error(`offered: ${names.join(", ")}`);
      await picker.getByLabel("Group name").fill("Sales huddle");
      await picker.locator(".chat-person", { hasText: "Ana Silva" }).locator("input").check();
      await picker.getByRole("button", { name: /^Make the group/ }).click();
      await row(ana.page, "Sales huddle").waitFor({ timeout: 10000 });
      const { data } = await site.from("chats").select("team_id").eq("title", "Sales huddle").single();
      if (data.team_id !== team.Sales) throw new Error("the group is not Sales' group");
    });
    await step("Dia (Platform) sees Sales' group by its name and size only, and everyone beside the chat by team", async () => {
      // Live: no reload; the group shows by name and size the moment it is made.
      const listed = dia.page.getByRole("list", { name: "Other groups" }).locator(".chat-row", { hasText: "Sales huddle" });
      await listed.locator(".chat-row-preview", { hasText: "2 members · Sales" }).waitFor({ timeout: 10000 });
      const panel = dia.page.getByRole("complementary", { name: "Members" });
      // Each team by its name and how many are in it (the shield beside the name is a picture).
      const sections = await panel.locator("section").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
      const wanted = ["KIASA admins, 1", "Platform, 2", "Sales, 2"];
      if (wanted.some(entry => !sections.includes(entry))) throw new Error(`sections: ${sections.join(", ")}`);
      const sales = panel.getByRole("region", { name: "Sales, 2" });
      const first = await sales.locator(".chat-member-name").first().textContent();
      if (!/Ben Okoro/.test(first)) throw new Error(`Sales' manager is not on top: ${first}`);
      const asDia = await as("dia@example.com");
      const { data: huddle } = await site.from("chats").select("id").eq("title", "Sales huddle").single();
      const read = await asDia.from("messages").select("id").eq("chat_id", huddle.id);
      if (read.data?.length) throw new Error("Dia can read Sales' group");
      await shot(dia.page, "6-dia-members");
      // The admin has it in the list too, live, to open and read unseen.
      await admin.page.getByRole("list", { name: /Every group/ }).locator(".chat-row", { hasText: "Sales huddle" }).waitFor({ timeout: 10000 });
      await shot(admin.page, "7-admin-every-group");
      return sections.join(", ");
    });
    await step("the database: a manager cannot put another team's person in their group", async () => {
      const asBen = await as("ben@example.com");
      const { error } = await asBen.rpc("create_group", { group_title: "Sneaky", member_ids: [id("dia@example.com")] });
      if (!error) throw new Error("Ben made a group with Dia");
      return error.message;
    });
    await step("Ben renames it and gives it a photo; Ana sees both, live", async () => {
      await row(ben.page, "Sales huddle").click();
      await ben.page.getByRole("button", { name: "About Sales huddle" }).click();
      await ben.page.getByRole("button", { name: "Edit the group" }).click();
      await ben.page.locator(".chat-group-edit input[type=file]").setInputFiles(picture);
      await ben.page.getByRole("button", { name: "Save photo" }).click();
      await ben.page.locator(".chat-group-edit .avatar-photo").waitFor({ timeout: 10000 });
      await ben.page.locator(".chat-group-edit").getByLabel("Group name").fill("Sales room");
      await ben.page.locator(".chat-group-edit").getByRole("button", { name: "Save" }).click();
      await row(ana.page, "Sales room").locator(".avatar-photo").waitFor({ timeout: 10000 });
      await row(ana.page, "Sales room").click();
      await ana.page.locator(".chat-notice", { hasText: "Ben Okoro renamed the group to \"Sales room\"." }).waitFor({ timeout: 10000 });
      await ana.page.locator(".chat-notice", { hasText: "Ben Okoro changed the group photo." }).waitFor({ timeout: 10000 });
      await shot(ana.page, "4-ana-sales-room");
    });
    await step("the database: Ana (not a manager) cannot rename it; Platform's manager cannot even see it", async () => {
      const [asAna, asEli] = await Promise.all([as("ana@example.com"), as("eli@example.com")]);
      const { data: room } = await site.from("chats").select("id").eq("title", "Sales room").single();
      const renamed = await asAna.rpc("edit_group", { chat: room.id, new_title: "Ana's room" });
      const seen = await asEli.from("chats").select("id").eq("id", room.id);
      const read = await asEli.from("messages").select("id").eq("chat_id", room.id);
      if (!renamed.error) throw new Error("Ana renamed the group");
      if (seen.data?.length || read.data?.length) throw new Error("Eli can see Sales' group");
    });

    // ── The admin, reading unseen.
    await step("the admin opens All chats, and reads Sales room unseen, live, with no way to write", async () => {
      await admin.page.getByRole("button", { name: "Menu" }).click();
      await admin.page.getByRole("menuitem", { name: "All chats" }).click();
      await row(admin.page, "Ana Silva & Dia Rahman").waitFor({ timeout: 10000 });
      await row(admin.page, "Sales room").click();
      await admin.page.locator(".chat-unseen", { hasText: "You are reading unseen" }).waitFor({ timeout: 10000 });
      if (await admin.page.getByRole("textbox", { name: "Message" }).count()) throw new Error("the admin has a box to write in");
      await ana.page.getByRole("textbox", { name: "Message" }).fill("Numbers for Friday");
      await ana.page.getByRole("button", { name: "Send" }).click();
      await admin.page.locator(".chat-message", { hasText: "Numbers for Friday" }).waitFor({ timeout: 10000 });
      await shot(admin.page, "5-admin-unseen");
    });
    await step("no one can tell: the admin is not among its members, and marked nothing read", async () => {
      const { data: room } = await site.from("chats").select("id").eq("title", "Sales room").single();
      const { data: members } = await site.from("chat_members").select("user_id, last_read_at").eq("chat_id", room.id);
      if (members.some(member => member.user_id === id("chrislim@kiasa.tech"))) throw new Error("the admin is in the group");
      const status = await ana.page.locator(".chat-head-status").textContent();
      if (!/^2 members/.test(status)) throw new Error(`Ana's header says ${status}`);
      const asAdmin = await as("chrislim@kiasa.tech");
      const react = await asAdmin.rpc("react", { message: (await site.from("messages").select("id").eq("chat_id", room.id).eq("body", "Numbers for Friday").single()).data.id, emoji: "👍" });
      if (!react.error) throw new Error("the admin reacted in a chat they read unseen");
      return status;
    });
    await step("the admin renames it: its members are told, without the admin's name", async () => {
      const asAdmin = await as("chrislim@kiasa.tech");
      const { data: room } = await site.from("chats").select("id").eq("title", "Sales room").single();
      const { error } = await asAdmin.rpc("edit_group", { chat: room.id, new_title: "Sales" });
      if (error) throw new Error(error.message);
      await ana.page.locator(".chat-notice", { hasText: "The group is now called \"Sales\"." }).waitFor({ timeout: 10000 });
      await admin.page.locator(".chat-head-title", { hasText: /^Sales$/ }).waitFor({ timeout: 10000 });
    });

    // ── Leaving a team.
    await step("Ana moves out of Sales: she leaves its group, and Ben is told", async () => {
      await site.from("team_members").delete().eq("user_id", id("ana@example.com"));
      // Out of her chats; still among the other groups, by its name and size only.
      await ana.page.getByRole("list", { name: "Chats" }).locator(".chat-row", { has: ana.page.locator(".chat-row-title", { hasText: /^Sales$/ }) }).waitFor({ state: "detached", timeout: 10000 });
      await ana.page.getByRole("list", { name: "Other groups" }).locator(".chat-row", { hasText: "1 member" }).waitFor({ timeout: 10000 });
      await row(ben.page, /^Sales$/).click();
      await ben.page.locator(".chat-notice", { hasText: "Ana Silva is no longer in the team, and left the group." }).waitFor({ timeout: 10000 });
    });

    // ── Names, live.
    await step("Ben changes his name on his account page: Dia's open chat shows it at once, beside the chat and on his photo", async () => {
      const account = await ben.context.newPage();
      await account.goto(BASE + "/account");
      await hydrated(account, ".account-button");
      await account.getByRole("button", { name: "Edit details" }).click();
      await account.getByLabel("Name").fill("Benjamin Okoro");
      const at = Date.now();
      await account.getByRole("button", { name: "Save details" }).click();
      const panel = dia.page.getByRole("complementary", { name: "Members" });
      await panel.locator(".chat-member-name", { hasText: "Benjamin Okoro" }).waitFor({ timeout: 10000 });
      const seen = Date.now() - at;
      const row = panel.locator(".chat-member", { hasText: "Benjamin Okoro" }).first();
      const initials = (await row.locator(".chat-avatar").first().evaluate(node => node.firstChild?.textContent ?? "")).trim();
      if (initials !== "BO") throw new Error(`his photo reads "${initials}"`);
      // Back as he was, for the next run.
      await account.getByRole("button", { name: "Edit details" }).click();
      await account.getByLabel("Name").fill("Ben Okoro");
      await account.getByRole("button", { name: "Save details" }).click();
      await panel.locator(".chat-member-name", { hasText: /^Ben Okoro/ }).first().waitFor({ timeout: 10000 });
      await account.close();
      return `on Dia's page ${seen} ms after he saved`;
    });

    // ── The admin's teams, at a glance.
    await step("the admin's Teams page: every team in one list with its size; one chosen shows its manager and members, found by name", async () => {
      const desk = await admin.context.newPage();
      await desk.setViewportSize({ width: 1440, height: 900 });
      await desk.goto(BASE + "/admin/teams");
      await hydrated(desk, ".teams-list");
      const rows = await desk.getByRole("navigation", { name: "Teams" }).locator(".teams-row-name").allTextContents();
      if (rows.join() !== "Platform,Sales,Not in a team") throw new Error(`the list reads ${rows.join(", ")}`);
      await desk.getByRole("navigation", { name: "Teams" }).getByRole("button", { name: /^Sales/ }).click();
      const panel = desk.getByRole("article", { name: "Sales" });
      await panel.getByText("led by Ben Okoro").waitFor({ timeout: 5000 });
      await desk.screenshot({ path: path.join(out, "8-admin-teams.png"), fullPage: true });
      await desk.getByRole("navigation", { name: "Teams" }).getByRole("button", { name: /^Not in a team/ }).click();
      await desk.getByRole("article", { name: "Not in a team" }).getByLabel("Team of Ana Silva").waitFor({ timeout: 5000 });
      await desk.getByRole("navigation", { name: "Teams" }).getByRole("button", { name: "New team" }).click();
      await desk.getByRole("article", { name: "New team" }).getByRole("button", { name: "Make the team" }).waitFor();
      await desk.close();
      return rows.join(", ");
    });

    await step("the Users page: whoever waits for an answer comes first; Show by team narrows the list to a team, to those in one, or to those in none", async () => {
      // Eli asks again, for a moment: he waits.
      await site.from("profiles").update({ status: "waiting" }).eq("id", id("eli@example.com"));
      const desk = await admin.context.newPage();
      try {
        await desk.goto(BASE + "/admin");
        await hydrated(desk, ".admin-table");
        const firstRow = async () => (await desk.locator(".admin-table tbody tr").first().locator("td, th").first().textContent()).trim();
        const first = await firstRow();
        if (!first.startsWith("Eli")) throw new Error(`the first row is ${first}`);
        const names = async () => (await desk.locator(".admin-table tbody tr").evaluateAll(rows => rows.map(row => row.querySelector("td, th")?.textContent ?? ""))).map(name => name.trim());
        await desk.getByLabel("Show by team").selectOption({ label: "Sales (1)" });
        const sales = await names();
        if (sales.length !== 1 || !sales[0].startsWith("Ben Okoro")) throw new Error(`Sales lists ${sales.join(", ")}`);
        await desk.getByLabel("Show by team").selectOption("unteamed");
        const none = await names();
        if (!none.some(name => name.startsWith("Ana Silva")) || none.some(name => name.startsWith("Ben Okoro") || name.startsWith("Dia"))) throw new Error(`in no team: ${none.join(", ")}`);
        await desk.getByLabel("Show by team").selectOption("teamed");
        const teamed = await names();
        if (teamed.some(name => name.startsWith("Ana Silva")) || !teamed.some(name => name.startsWith("Dia"))) throw new Error(`in a team: ${teamed.join(", ")}`);
        await desk.screenshot({ path: path.join(out, "9-admin-users-teamed.png") });
        return `first: ${first.split("@")[0]}; Sales ${sales.length}, in no team ${none.length}, in a team ${teamed.length}`;
      } finally {
        await site.from("profiles").update({ status: "approved" }).eq("id", id("eli@example.com"));
        await desk.close();
      }
    });
  } finally {
    console.log(results.join("\n"));
    console.log("page errors:", errors.length ? errors.join(" | ") : "none");
    await site.from("chats").delete().not("id", "is", null);
    await site.from("contact_requests").delete().not("id", "is", null);
    await site.from("teams").delete().not("id", "is", null);
    await site.from("top_managers").delete().not("user_id", "is", null);
    await browser.close();
  }
  process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
})().catch(error => { console.log(results.join("\n")); console.error("stopped:", error.message); process.exit(1); });
