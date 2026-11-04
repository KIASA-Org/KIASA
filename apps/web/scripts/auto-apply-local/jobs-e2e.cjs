// End-to-end test of the Jobs list on the Auto apply page, against the LOCAL Supabase copy and
// a local server on port 3002. Signs in as made-up Ana and changes things in the database, to
// see the page follow without being reloaded. Usage, from apps/web:
// node scripts/auto-apply-local/jobs-e2e.cjs
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://127.0.0.1:3002";
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const out = path.join(os.tmpdir(), "kiasa-apply-e2e");
fs.mkdirSync(out, { recursive: true });
const sql = statement => execSync("docker exec -i supabase_db_web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tA", { input: statement, encoding: "utf8" }).trim();
const q = text => `'${String(text).replace(/'/g, "''")}'`;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`); }
}

const RESUME = JSON.stringify({ info: { name: "Ana" }, summary: "s", skills: [], experience: [], certifications: [], education: [] });

async function main() {
  const anaId = people["ana@example.com"].id;
  const benId = people["ben@example.com"].id;
  const run = String(Date.now());
  const job = (title, url, ago = "0 minutes") => sql(`insert into public.jobs (url, title, company, posted_at) values (${q(url)}, ${q(title)}, 'Testco', now() - interval '${ago}') returning id`).split("\n")[0];
  sql(`delete from public.apply_results where user_id = ${q(anaId)}; delete from public.tailored_resumes where user_id = ${q(anaId)};
       delete from public.jobs where url like 'https://job-boards.greenhouse.io/testco/%' or url like 'https://jobs.lever.co/testco/%';`);
  const tailor = (id, who = anaId) => sql(`insert into public.tailored_resumes (job_id, user_id, profile) values (${q(id)}, ${q(who)}, ${q(RESUME)}::jsonb);`);

  const withResume = job("Has a resume", `https://job-boards.greenhouse.io/testco/jobs/${run}1`, "1 minute");
  const noResume = job("No resume at all", `https://job-boards.greenhouse.io/testco/jobs/${run}2`, "2 minutes");
  const otherSite = job("Another site", `https://jobs.lever.co/testco/${run}3`, "3 minutes");
  const oldOne = job("Saved long ago", `https://job-boards.greenhouse.io/testco/jobs/${run}4`, "40 days");
  const bensOnly = job("Only Ben has one", `https://job-boards.greenhouse.io/testco/jobs/${run}5`, "4 minutes");
  tailor(withResume); tailor(otherSite); tailor(oldOne); tailor(bensOnly, benId);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto(BASE + "/sign-in", { timeout: 120000 });
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByLabel("Password").fill(people["ana@example.com"].password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes("sign-in"), { timeout: 60000 });
  await page.goto(BASE + "/apply", { timeout: 120000 });

  const card = page.locator("section.apply-work");
  const row = title => card.locator(".apply-row", { hasText: title });
  await row("Has a resume").waitFor({ timeout: 45000 });
  check("a job with a résumé is listed as ready", (await row("Has a resume").innerText()).includes("Ready to apply"));
  check("a job with no résumé is not among the ready ones", await row("No resume at all").count() === 0);
  check("a job only someone else has a résumé for is not ready for this member", await row("Only Ben has one").count() === 0);
  check("a job on another site says the agent cannot apply there yet", (await row("Another site").innerText()).includes("works on Greenhouse for now"));
  check("a ready job from long ago is still here", await row("Saved long ago").count() === 1);
  const readyButton = card.getByRole("button", { name: /^Ready/ });
  const count = async button => Number((await button.locator("span").innerText()).trim());
  const readyBefore = await count(readyButton);
  check("the ready count is right", readyBefore === 3, readyBefore);
  check("the jobs are headed by their day, with the date", /Today, [A-Z][a-z]{2} \d+/.test(await card.locator(".apply-day-title").first().innerText()), await card.locator(".apply-day-title").first().innerText());
  check("each says when it was saved", /Saved \d\d:\d\d/.test(await row("Has a resume").innerText()));
  await page.screenshot({ path: path.join(out, "jobs-ready.png"), fullPage: true });

  // A résumé being made turns a job ready, without the page being reloaded.
  let started = Date.now();
  tailor(noResume);
  await row("No resume at all").waitFor({ timeout: 15000 });
  check(`a new résumé makes its job appear by itself (${Date.now() - started} ms)`, (await row("No resume at all").innerText()).includes("Ready to apply"));
  await card.getByRole("button", { name: /^Ready 4/ }).waitFor({ timeout: 5000 });
  check("and the count goes up", true);

  started = Date.now();
  const fresh = job("Posted while watching", `https://job-boards.greenhouse.io/testco/jobs/${run}6`);
  tailor(fresh);
  await row("Posted while watching").waitFor({ timeout: 15000 });
  check(`a job saved and given a résumé now appears by itself (${Date.now() - started} ms)`, true);

  // All jobs: everything, with or without a résumé.
  const allButton = card.getByRole("button", { name: /^All jobs/ });
  await allButton.click();
  const total = Number(sql("select count(*) from public.jobs"));
  check("All jobs counts every saved job", await count(allButton) === total, [await count(allButton), total]);
  check("every job is listed, Ben's too", await row("Only Ben has one").count() === 1);
  check("a job with no résumé says so", (await row("Only Ben has one").innerText()).includes("No résumé yet"));
  const before = await card.locator(".apply-row").count();
  check("the long list comes a page at a time", before === Math.min(100, total), before);
  const more = card.getByRole("button", { name: "Show more" });
  if (total > 100) {
    await more.click();
    await page.waitForFunction(count => document.querySelectorAll("section.apply-work .apply-row").length > count, before, { timeout: 15000 });
    check("Show more brings older jobs", (await card.locator(".apply-row").count()) > before);
  }
  await page.screenshot({ path: path.join(out, "jobs-all.png") });
  await card.getByRole("button", { name: /^Ready/ }).click();

  // What the agent does shows on the job, live.
  const key = `kapp_${require("crypto").randomBytes(32).toString("hex")}`;
  void key;
  sql(`insert into public.apply_results (job_id, user_id, outcome, reason) values (${q(fresh)}, ${q(anaId)}, 'working', null);`);
  await row("Posted while watching").getByText("Working on it").waitFor({ timeout: 15000 });
  check("a job being worked on says so by itself", true);
  sql(`update public.apply_results set outcome = 'filled', reason = '9 questions answered. Nothing was sent.' where job_id = ${q(fresh)} and user_id = ${q(anaId)};`);
  await row("Posted while watching").getByText("Filled, not sent: 9 questions answered").waitFor({ timeout: 15000 });
  check("a filled job says so by itself, and stays among the ready ones until it is sent", true);
  sql(`update public.apply_results set outcome = 'skipped', reason = 'No application form on this page.' where job_id = ${q(fresh)} and user_id = ${q(anaId)};`);
  await row("Posted while watching").waitFor({ state: "detached", timeout: 15000 });
  check("a skipped job leaves the ready list", true);
  sql(`insert into public.applications (job_id, user_id, status) values (${q(withResume)}, ${q(anaId)}, 'applied');`);
  await row("Has a resume").waitFor({ state: "detached", timeout: 15000 });
  check("an applied job leaves the ready list", true);
  sql(`delete from public.tailored_resumes where job_id = ${q(noResume)} and user_id = ${q(anaId)};`);
  await row("No resume at all").waitFor({ state: "detached", timeout: 15000 });
  check("a résumé being removed takes its job off the list", true);
  await card.getByRole("button", { name: /^All jobs/ }).click();
  await row("Has a resume").waitFor({ timeout: 10000 });
  check("All jobs shows what became of them", (await row("Has a resume").innerText()).includes("Applied") && (await row("Posted while watching").innerText()).includes("Skipped"));

  // A company's text is only ever text.
  const odd = job("<img src=x onerror=window.hacked=1>", `https://job-boards.greenhouse.io/testco/jobs/${run}7`);
  const bad = sql(`insert into public.jobs (url, title) values ('http://javascript-looking.example/${run}', 'Plain http job') returning id`).split("\n")[0];
  await row("<img src=x").waitFor({ timeout: 15000 });
  check("a job's title is shown as text, never as page code", await page.evaluate(() => window.hacked === undefined));
  void odd;

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const small = await phone.newPage();
  await small.goto(BASE + "/apply", { timeout: 120000 });
  await small.locator("section.apply-work .apply-row").first().waitFor({ timeout: 45000 });
  const wide = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("at phone width the page does not scroll sideways", wide <= 0, wide);

  const noise = errors.filter(text => !/favicon|Failed to load resource.*(404|401)/i.test(text));
  check("no errors in the page", noise.length === 0, noise.slice(0, 4));

  sql(`delete from public.applications where user_id = ${q(anaId)} and job_id = ${q(withResume)};
       delete from public.jobs where url like 'https://job-boards.greenhouse.io/testco/%' or url like 'https://jobs.lever.co/testco/%' or id = ${q(bad)};`);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error("The test could not run:", error.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 8).join(" | ")); process.exit(2); });
