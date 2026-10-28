// End-to-end test of who is in a KIASA meeting, against the LOCAL Supabase
// copy: the admin calls a meeting for people they choose and changes them
// later; a team's manager calls their own team freely, and anyone else only
// with an admin's OK. Two teams: Sales, led by Ben, with Ana; Platform, led by
// Eli, with Dia. Prints PASS/FAIL per step. Usage, from apps/web: npx supabase
// start; npm run chat:local:seed; serve a build made with the local copy's
// keys on port 3002 (see docs/site.md); then npm run meet:people:e2e.
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
const id = email => people[email].id;
const out = path.join(os.tmpdir(), "kiasa-meet-people-e2e");
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(BASE + "/sign-in");
  await hydrated(page, "form");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(people[email].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|account)/, { timeout: 20000 });
  await page.goto(BASE + "/chat");
  await hydrated(page, ".chat");
  return { context, page, label };
}
const row = (page, title) => page.locator(".chat-row", { has: page.locator(".chat-row-title", { hasText: new RegExp(`^${title}$`) }) });
const tomorrowAt = hour => {
  const at = new Date(Date.now() + 86400_000);
  const two = value => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(hour)}:00`;
};
/** The meeting box: a title, when, and the people ticked. */
async function newMeeting(page, { title, later, tick = [], untick = [], button }) {
  const dialog = page.getByRole("dialog", { name: "New meeting" });
  await dialog.getByRole("group", { name: "Who is in it" }).waitFor({ timeout: 15000 });
  await dialog.getByLabel("Title").fill(title);
  if (later) {
    await dialog.getByRole("radio", { name: "Later" }).click();
    await dialog.getByLabel(/Day and time/).fill(tomorrowAt(later));
  }
  for (const name of tick) await dialog.getByLabel(name).check();
  for (const name of untick) await dialog.getByLabel(name).uncheck();
  await dialog.getByRole("button", { name: button, exact: true }).click();
  return dialog;
}
const peopleOf = async (site, meeting) => (await site.from("meeting_people").select("user_id, status").eq("meeting_id", meeting)).data ?? [];
const latest = async (site, title) => (await site.from("meetings").select("id, approval, started_at, ended_at").eq("title", title).order("created_at", { ascending: false }).limit(1).single()).data;
const whoIs = list => list.map(entry => Object.keys(people).find(email => people[email].id === entry.user_id)?.split("@")[0] + (entry.status === "asked" ? "?" : "")).sort().join(", ");

(async () => {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const titles = ["Chosen people", "Sales standup", "Sales with others", "Sales with Eli", "Sales group meeting"];
  // Two teams, as in the teams test; the meetings of this test, and its group, start afresh.
  await site.from("messages").delete().in("attachment->>title", titles);
  await site.from("meetings").delete().in("title", titles);
  await site.from("chats").delete().eq("title", "Sales corner");
  await site.from("team_members").delete().not("user_id", "is", null);
  await site.from("teams").delete().not("id", "is", null);
  await site.from("top_managers").delete().not("user_id", "is", null);
  await site.from("profiles").update({ name: "Ben Okoro" }).eq("id", id("ben@example.com"));
  const { data: made } = await site.from("teams").insert([{ name: "Sales", color: "#e5484d" }, { name: "Platform", color: "#0090ff" }]).select("id, name");
  const team = Object.fromEntries(made.map(entry => [entry.name, entry.id]));
  await site.from("top_managers").insert([{ user_id: id("ben@example.com"), granted_by: "meeting people test" }, { user_id: id("eli@example.com"), granted_by: "meeting people test" }]);
  await site.from("team_members").insert([
    { user_id: id("ben@example.com"), team_id: team.Sales }, { user_id: id("ana@example.com"), team_id: team.Sales },
    { user_id: id("eli@example.com"), team_id: team.Platform }, { user_id: id("dia@example.com"), team_id: team.Platform },
  ]);
  // Sales' own group, made by its manager.
  const { data: corner } = await site.from("chats").insert({ kind: "group", title: "Sales corner", created_by: id("ben@example.com"), team_id: team.Sales }).select("id").single();
  await site.from("chat_members").insert([
    { chat_id: corner.id, user_id: id("ben@example.com"), name: "Ben Okoro", role: "owner" }, { chat_id: corner.id, user_id: id("ana@example.com"), name: "Ana Silva", role: "member" },
  ]);
  const wake = site.channel("wake").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {});
  await new Promise(resolve => wake.subscribe(status => { if (status !== "CLOSED") resolve(); }));
  await new Promise(done => setTimeout(done, 3000));
  await site.removeChannel(wake);

  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  let admin, ana, ben, dia, chosen;
  try {
    await step("the admin, Ana, Ben (Sales' manager) and Dia (Platform) open KIASA Chat; members have no New meeting button", async () => {
      [admin, ana, ben, dia] = await Promise.all([
        signIn(browser, "chrislim@kiasa.tech", "admin"), signIn(browser, "ana@example.com", "ana"),
        signIn(browser, "ben@example.com", "ben"), signIn(browser, "dia@example.com", "dia"),
      ]);
      await ana.page.waitForTimeout(2500);
      if (await ana.page.getByRole("button", { name: "New meeting" }).count()) throw new Error("Ana has a New meeting button");
      await admin.page.getByRole("button", { name: "New meeting" }).waitFor();
      await ben.page.getByRole("button", { name: "New meeting" }).waitFor();
    });

    await step("the admin's New meeting: Ana and Dia chosen, planned for tomorrow; each gets its card from KIASA, and Ben nothing", async () => {
      await admin.page.getByRole("button", { name: "New meeting" }).click();
      const dialog = admin.page.getByRole("dialog", { name: "New meeting" });
      await dialog.getByRole("group", { name: "Who is in it" }).waitFor({ timeout: 15000 });
      await admin.page.screenshot({ path: path.join(out, "1-admin-new-meeting.png") });
      await newMeeting(admin.page, { title: "Chosen people", later: 10, tick: ["Ana Silva", "Dia Rahman"], button: "Schedule" });
      await dialog.waitFor({ state: "detached", timeout: 10000 });
      chosen = (await latest(site, "Chosen people")).id;
      for (const who of [ana, dia, admin]) {
        await row(who.page, "KIASA").click();
        await who.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Chosen people" }).waitFor({ timeout: 10000 });
      }
      const { data: cards } = await site.from("messages").select("chat_id").eq("attachment->>id", chosen).eq("attachment->>type", "meeting");
      const { data: bens } = await site.from("chat_members").select("chat_id").eq("user_id", id("ben@example.com")).in("chat_id", (cards ?? []).map(card => card.chat_id));
      if (bens?.length) throw new Error("Ben got the card");
      return whoIs(await peopleOf(site, chosen));
    });

    await step("after it is planned the admin adds Ben and takes Dia out: Ben gets the card, Dia's goes, and the meeting is no longer hers", async () => {
      await admin.page.locator(".chat-meeting", { hasText: "Chosen people" }).last().getByRole("button", { name: "People" }).click();
      const dialog = admin.page.getByRole("dialog", { name: "People in the meeting" });
      await dialog.getByRole("list", { name: "In the meeting" }).waitFor({ timeout: 10000 });
      await dialog.getByRole("button", { name: "Take Dia Rahman out" }).click();
      await dialog.getByRole("button", { name: "Take Dia Rahman out" }).waitFor({ state: "detached", timeout: 10000 });
      await dialog.getByRole("group", { name: "Add people" }).getByLabel("Ben Okoro").check();
      await admin.page.screenshot({ path: path.join(out, "2-admin-people.png") });
      await dialog.getByRole("button", { name: "Add 1" }).click();
      await dialog.getByRole("list", { name: "In the meeting" }).getByText("Ben Okoro").waitFor({ timeout: 10000 });
      await dialog.getByRole("button", { name: "Done" }).click();
      // Ben's first word from KIASA: the chat comes into his list.
      await row(ben.page, "KIASA").click({ timeout: 10000 });
      await ben.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Chosen people" }).waitFor({ timeout: 10000 });
      await dia.page.locator(".chat-meeting", { hasText: "Chosen people" }).waitFor({ state: "detached", timeout: 10000 });
      const page = await dia.context.newPage();
      await page.goto(BASE + `/meet/${chosen}`);
      await page.getByText("This meeting is not one you are in").waitFor({ timeout: 10000 });
      await page.close();
      return whoIs(await peopleOf(site, chosen));
    });

    let standup, benMeet, anaMeet;
    await step("Ben's New meeting offers his team apart from everyone else; for Ana alone it starts at once and rings her", async () => {
      await ben.page.getByRole("button", { name: "New meeting" }).click();
      const dialog = ben.page.getByRole("dialog", { name: "New meeting" });
      await dialog.getByRole("group", { name: "Who is in it" }).waitFor({ timeout: 15000 });
      const groups = await dialog.locator(".meet-choose-group").allTextContents();
      if (groups[0] !== "Your team" || !/Outside your team/.test(groups[1] ?? "")) throw new Error(`groups: ${groups.join(" | ")}`);
      await dialog.getByLabel("Dia Rahman").check();
      await dialog.locator(".meet-outside-note", { hasText: "Dia Rahman is outside your team" }).waitFor();
      await dialog.getByRole("button", { name: "Ask the admin" }).waitFor();
      await ben.page.screenshot({ path: path.join(out, "3-manager-new-meeting.png") });
      await dialog.getByLabel("Dia Rahman").uncheck();
      const opened = ben.context.waitForEvent("page");
      await newMeeting(ben.page, { title: "Sales standup", tick: ["Ana Silva"], button: "Start meeting" });
      benMeet = await opened;
      watch(benMeet, "ben meet");
      await benMeet.waitForURL(/\/meet\/[0-9a-f-]{36}$/, { timeout: 15000 });
      standup = benMeet.url().split("/").pop();
      const ringing = ana.page.locator(".chat-ringing", { hasText: "Sales standup" });
      await ringing.waitFor({ timeout: 10000 });
      if (await dia.page.locator(".chat-ringing").count()) throw new Error("Dia was rung");
      const anaOpened = ana.context.waitForEvent("page");
      await ringing.getByRole("link", { name: "Join" }).click();
      anaMeet = await anaOpened;
      watch(anaMeet, "ana meet");
      return whoIs(await peopleOf(site, standup));
    });

    await step("Ben runs his meeting: he goes in without asking, and lets Ana in himself", async () => {
      await hydrated(benMeet, ".meet");
      const start = benMeet.getByRole("button", { name: "Join now" });
      await benMeet.waitForFunction(() => { const b = [...document.querySelectorAll(".meet-lobby-actions button")][0]; return b && !b.disabled; }, null, { timeout: 20000 });
      await start.click();
      await benMeet.locator(".meet-controls").waitFor({ timeout: 10000 });
      await hydrated(anaMeet, ".meet");
      await anaMeet.waitForFunction(() => { const b = [...document.querySelectorAll(".meet-lobby-actions button")][0]; return b && !b.disabled; }, null, { timeout: 20000 });
      await anaMeet.getByRole("button", { name: "Ask to join" }).click();
      const knock = benMeet.locator(".meet-knock", { hasText: "Ana Silva" });
      await knock.waitFor({ timeout: 10000 });
      await knock.getByRole("button", { name: "Admit" }).click();
      await anaMeet.locator(".meet-controls").waitFor({ timeout: 10000 });
      await benMeet.locator(".meet-faces [data-tile]").nth(1).waitFor({ timeout: 20000 });
    });

    await step("Ben takes Ana out while the call is on: her window goes back to the waiting screen and says so", async () => {
      await row(ben.page, "KIASA").click();
      await ben.page.locator(".chat-meeting[data-status='live']", { hasText: "Sales standup" }).last().getByRole("button", { name: "People" }).click();
      const dialog = ben.page.getByRole("dialog", { name: "People in the meeting" });
      await dialog.getByRole("button", { name: "Take Ana Silva out" }).click();
      await anaMeet.getByText("You were not let in, or were taken out of this meeting.").waitFor({ timeout: 15000 });
      await dialog.getByRole("button", { name: "Done" }).click();
      await benMeet.getByRole("button", { name: "Leave the meeting" }).click();
      await benMeet.getByRole("menuitem", { name: /^End for everyone/ }).click();
      await benMeet.getByRole("heading", { name: "This meeting has ended" }).waitFor({ timeout: 10000 });
      await Promise.all([benMeet.close(), anaMeet.close()]);
    });

    let withOthers;
    await step("Ben asks for a meeting with Ana, Dia and the admin: it waits; no one but Ben can see it, and the admins get a request", async () => {
      await ben.page.getByRole("button", { name: "New meeting" }).click();
      const dialog = await newMeeting(ben.page, { title: "Sales with others", later: 11, tick: ["Ana Silva", "Dia Rahman", "Chris Lim"], button: "Ask the admin" });
      await dialog.getByText("Sent to the admins.").waitFor({ timeout: 10000 });
      await dialog.getByRole("button", { name: "OK" }).click();
      withOthers = (await latest(site, "Sales with others")).id;
      await ben.page.locator(".chat-meeting[data-status='waiting']", { hasText: "Sales with others" }).waitFor({ timeout: 10000 });
      const asAna = createClient(env.url, env.publishable, { auth: { persistSession: false } });
      await asAna.auth.signInWithPassword({ email: "ana@example.com", password: people["ana@example.com"].password });
      const seen = await asAna.from("meetings").select("id").eq("id", withOthers);
      if (seen.data?.length) throw new Error("Ana sees a meeting still waiting");
      if (await ana.page.locator(".chat-meeting", { hasText: "Sales with others" }).count()) throw new Error("Ana got its card");
      await row(admin.page, "Contact requests").click();
      const card = admin.page.locator(".chat-request", { hasText: "Sales with others" });
      await card.waitFor({ timeout: 10000 });
      await card.getByText("Dia Rahman, Chris Lim").waitFor();
      await admin.page.screenshot({ path: path.join(out, "4-admin-request.png") });
      return whoIs(await peopleOf(site, withOthers));
    });

    await step("the admin allows it: Ana and Dia get its card, Ben's turns Planned, and he is told", async () => {
      await admin.page.locator(".chat-request", { hasText: "Sales with others" }).getByRole("button", { name: "Allow" }).click();
      await admin.page.locator(".chat-request", { hasText: "Sales with others" }).getByText(/^Allowed by/).waitFor({ timeout: 10000 });
      await ana.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Sales with others" }).waitFor({ timeout: 10000 });
      await dia.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Sales with others" }).waitFor({ timeout: 10000 });
      await ben.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Sales with others" }).waitFor({ timeout: 10000 });
      await ben.page.locator(".chat-notice", { hasText: "An admin allowed your meeting \"Sales with others\"" }).last().waitFor({ timeout: 10000 });
      const meeting = await latest(site, "Sales with others");
      return `${meeting.approval}; ${whoIs(await peopleOf(site, withOthers))}`;
    });

    await step("Ben asks to meet Eli (another team's manager); the admin refuses: Ben's card reads Not allowed, and Eli never hears of it", async () => {
      await ben.page.getByRole("button", { name: "New meeting" }).click();
      const dialog = await newMeeting(ben.page, { title: "Sales with Eli", later: 12, tick: ["Eli Novak"], button: "Ask the admin" });
      await dialog.getByRole("button", { name: "OK" }).click();
      const card = admin.page.locator(".chat-request", { hasText: "Sales with Eli" });
      await card.getByRole("button", { name: "Refuse" }).click();
      await card.getByText(/^Not allowed by/).waitFor({ timeout: 10000 });
      await ben.page.locator(".chat-meeting[data-status='refused']", { hasText: "Sales with Eli" }).waitFor({ timeout: 10000 });
      const meeting = await latest(site, "Sales with Eli");
      if (!meeting.ended_at) throw new Error("the refused meeting is not over");
      // Its only card is Ben's own.
      const { data: cards } = await site.from("messages").select("chat_id").eq("attachment->>id", meeting.id).eq("attachment->>type", "meeting");
      const { data: bens } = await site.from("chat_members").select("chat_id").eq("user_id", id("ben@example.com")).in("chat_id", (cards ?? []).map(card => card.chat_id));
      if ((cards ?? []).length !== 1 || (bens ?? []).length !== 1) throw new Error(`${cards?.length} cards, ${bens?.length} of them Ben's`);
      return meeting.approval;
    });

    await step("in Sales' own group Ben has the meeting button, with Ana chosen to start with; Ana has none", async () => {
      await row(ben.page, "Sales corner").click();
      await ben.page.getByRole("button", { name: "Start or schedule a meeting" }).click();
      const dialog = ben.page.getByRole("dialog", { name: "New meeting" });
      await dialog.getByRole("group", { name: "Who is in it" }).waitFor({ timeout: 15000 });
      if (!(await dialog.getByLabel("Ana Silva").isChecked())) throw new Error("Ana is not chosen");
      await newMeeting(ben.page, { title: "Sales group meeting", later: 9, button: "Schedule" });
      await ben.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Sales group meeting" }).waitFor({ timeout: 10000 });
      await row(ana.page, "Sales corner").click();
      await ana.page.locator(".chat-meeting[data-status='scheduled']", { hasText: "Sales group meeting" }).waitFor({ timeout: 10000 });
      if (await ana.page.getByRole("button", { name: "Start or schedule a meeting" }).count()) throw new Error("Ana has the meeting button");
      if (await ana.page.locator(".chat-meeting", { hasText: "Sales group meeting" }).getByRole("button", { name: "People" }).count()) throw new Error("Ana can change who is in it");
    });

    await step("the database: no one but the site's server puts people in a meeting; Ana cannot add herself to one not hers", async () => {
      const asDia = createClient(env.url, env.publishable, { auth: { persistSession: false } });
      await asDia.auth.signInWithPassword({ email: "dia@example.com", password: people["dia@example.com"].password });
      const added = await asDia.from("meeting_people").insert({ meeting_id: chosen, user_id: id("dia@example.com"), name: "Dia Rahman" }).select("user_id");
      if (!added.error) throw new Error("Dia put herself in a meeting");
      const seen = await asDia.from("meeting_people").select("user_id").eq("meeting_id", chosen);
      if (seen.data?.length) throw new Error("Dia sees who is in a meeting not hers");
      return `refused (${added.error.code})`;
    });
  } finally {
    console.log(results.join("\n"));
    console.log("page errors:", errors.length ? errors.join(" | ") : "none");
    await browser.close();
    await site.from("messages").delete().in("attachment->>title", titles);
    await site.from("meetings").delete().in("title", titles);
    await site.from("chats").delete().eq("title", "Sales corner");
    await site.from("team_members").delete().not("user_id", "is", null);
    await site.from("teams").delete().not("id", "is", null);
    await site.from("top_managers").delete().not("user_id", "is", null);
    process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
  }
})().catch(error => { console.log(results.join("\n")); console.error("stopped:", error.message); process.exit(1); });
