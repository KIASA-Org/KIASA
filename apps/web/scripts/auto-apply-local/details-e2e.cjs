// End-to-end test of the details form on the Auto apply page, against the LOCAL Supabase copy
// and a local server on port 3002 using its keys. Signs in as made-up Ana, fills the form,
// answers a question a job is waiting on, and checks what was saved. Screenshots go to the
// system's temp folder. Usage, from apps/web: node scripts/auto-apply-local/details-e2e.cjs
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

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`); }
}

// While a page streams in, React keeps a hidden copy of it for a moment. Tests wait until that
// has gone and the form has loaded what is saved.
const settled = page => page.waitForFunction(() => !document.querySelector('[id^="S:"]') && document.querySelectorAll('section.apply-details').length === 1 && !document.querySelector('.apply-details .jobs-card-sub').textContent.startsWith('Loading'), null, { timeout: 30000 });

async function main() {
  const anaId = people["ana@example.com"].id;
  const q = text => `'${String(text).replace(/'/g, "''")}'`;
  sql(`delete from public.apply_details where user_id = ${q(anaId)}; delete from public.apply_results where user_id = ${q(anaId)};
       insert into public.resume_profiles (user_id, profile, status) values (${q(anaId)}, '{"info":{"name":"Ana Silva","title":"Engineer","location":"Boston, MA","email":"ana@example.com","phone":"+1 555 0100","linkedin":"https://linkedin.com/in/anasilva"},"summary":"","skills":[],"experience":[],"certifications":[],"education":[]}', 'typed')
       on conflict (user_id) do update set profile = excluded.profile;`);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
  await page.getByRole("heading", { name: "Your details for applying" }).waitFor({ timeout: 60000 });
  await settled(page);
  check("the form is on the page once", await page.locator("section.apply-details").count() === 1 && await page.locator("input[autocomplete=given-name]").count() === 1);

  check("the first time, it fills in from the base résumé", await page.getByLabel("First name").inputValue() === "Ana" && await page.getByLabel("Last name").inputValue() === "Silva");
  check("email, phone and city come along", await page.getByLabel("Email").inputValue() === "ana@example.com" && await page.getByLabel("Phone").inputValue() === "+1 555 0100" && await page.getByLabel("City").inputValue() === "Boston");
  check("it says where they came from", await page.getByText("Filled in from your base résumé").isVisible());
  check("it says admins cannot see them", await page.getByText("Only you can see these. KIASA admins cannot.").isVisible());
  check("it says where the details go", await page.getByText("go to KIASA's model server").isVisible());
  await page.screenshot({ path: path.join(out, "details-empty.png"), fullPage: true });

  await page.getByLabel("Country").fill("United States");
  await page.getByLabel("Work authorization").fill("Authorized to work in the United States.");
  await page.getByLabel("Visa sponsorship").fill("I do not need sponsorship.");
  await page.getByLabel("Salary expectations").fill("$120,000 to $140,000");
  await page.getByLabel("More about my career").fill("I also ran payments migrations at a small startup.");
  await page.getByRole("button", { name: "Save my details" }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15000 });
  check("saving says so", true);

  const saved = JSON.parse(sql(`select details from public.apply_details where user_id = ${q(anaId)}`));
  check("contact details are saved as written", saved.first_name === "Ana" && saved.country === "United States" && saved.phone === "+1 555 0100", saved);
  check("the career box is saved", saved.career === "I also ran payments migrations at a small startup.", saved.career);
  const fact = name => saved.facts?.find(item => item.question === name)?.answer;
  check("the fixed questions are saved under the names the server looks for", fact("Work authorization") === "Authorized to work in the United States." && fact("Visa sponsorship") === "I do not need sponsorship.", saved.facts);
  check("the salary is saved", fact("Salary expectations") === "$120,000 to $140,000", saved.facts);
  check("empty ones are not kept", !fact("Security clearance") && !fact("Citizenship"), saved.facts);

  await page.reload({ timeout: 120000 });
  await settled(page);
  check("after a reload, everything is still there", await page.getByLabel("Work authorization").inputValue() === "Authorized to work in the United States." && await page.getByLabel("More about my career").inputValue().then(text => text.startsWith("I also ran")));
  check("it no longer says it came from the résumé", !(await page.getByText("Filled in from your base résumé").isVisible()));

  // A job is waiting on questions only Ana can answer: they should appear as it happens.
  const jobId = sql(`insert into public.jobs (url, title, posted_at) values ('https://job-boards.greenhouse.io/acme/jobs/e2e-${Date.now()}', 'E2E job', now()) returning id`).split("\n")[0];
  const asks = [
    { id: "box", label: "I affirm that what I submit is my own work.", why: "This is a statement you make yourself, so the agent does not agree to it for you.", kind: "checkbox" },
    { id: "clear", label: "Do you hold an active security clearance?", why: "Only you can answer this.", kind: "choice", options: ["Yes", "No"] },
    { id: "text", label: "How many years have you lived in <b>Boston</b>?", why: "Your résumé and saved answers do not say.", kind: "text" },
  ];
  sql(`insert into public.apply_results (job_id, user_id, outcome, reason, asks) values (${q(jobId)}, ${q(anaId)}, 'waiting', 'Needs your answer', ${q(JSON.stringify(asks))}::jsonb);`);
  const region = page.getByRole("region", { name: "Questions waiting for your answer" });
  await region.waitFor({ timeout: 15000 });
  check("questions a job is waiting on appear by themselves", await region.getByText("I affirm that what I submit is my own work.").isVisible());
  check("a question's text is shown as text, never as page code", await region.getByText("How many years have you lived in <b>Boston</b>?").isVisible() && await region.locator("b").count() === 0);
  await page.screenshot({ path: path.join(out, "details-waiting.png"), fullPage: true });

  const box = region.getByRole("combobox", { name: "Your answer: I affirm" });
  check("a consent offers yes and no", (await box.locator("option").allInnerTexts()).join("|") === "Choose…|Yes|No");
  const firstSave = region.getByRole("button", { name: "Save answer" }).first();
  check("it cannot be saved empty", await firstSave.isDisabled());
  await box.selectOption("Yes");
  await firstSave.click();
  await region.getByText("I affirm that what I submit is my own work.").waitFor({ state: "detached", timeout: 15000 });
  check("once answered, it leaves the list", true);
  await region.getByRole("combobox", { name: "Your answer: Do you hold" }).selectOption("No");
  await region.getByRole("button", { name: "Save answer" }).first().click();
  await region.getByText("Do you hold an active security clearance?").waitFor({ state: "detached", timeout: 15000 });
  await region.getByRole("textbox", { name: /Your answer: How many years/ }).fill("Six");
  await region.getByRole("button", { name: "Save answer" }).first().click();
  await region.waitFor({ state: "detached", timeout: 15000 });
  check("with all answered, the box goes away", true);

  const after = JSON.parse(sql(`select details from public.apply_details where user_id = ${q(anaId)}`));
  const said = name => after.facts?.find(item => item.question === name)?.answer;
  check("each answer is saved under the form's exact wording", said(asks[0].label) === "Yes" && said(asks[1].label) === "No" && said(asks[2].label) === "Six", after.facts);
  check("answering keeps the rest", after.career?.startsWith("I also ran") && said("Work authorization")?.startsWith("Authorized"), after);
  const newer = sql(`select (select updated_at from public.apply_details where user_id = ${q(anaId)}) > (select updated_at from public.apply_results where job_id = ${q(jobId)} and user_id = ${q(anaId)})`);
  check("the waiting job can now go ahead", newer === "t" || newer === "true", newer);

  const removable = page.getByRole("button", { name: /Remove your answer: Do you hold/ });
  check("answers given to forms are listed", await removable.isVisible());
  await page.screenshot({ path: path.join(out, "details-answers.png"), fullPage: true });
  await removable.click();
  await page.getByRole("button", { name: "Save my details" }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15000 });
  const removed = JSON.parse(sql(`select details from public.apply_details where user_id = ${q(anaId)}`));
  check("one can be removed", !removed.facts?.some(item => item.question === asks[1].label), removed.facts);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const small = await phone.newPage();
  await small.goto(BASE + "/apply", { timeout: 120000 });
  await settled(small);
  const wide = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("at phone width the page does not scroll sideways", wide <= 0, wide);
  await small.screenshot({ path: path.join(out, "details-phone.png"), fullPage: true });

  const bad = errors.filter(text => !/favicon|Failed to load resource.*(404|401)/i.test(text));
  check("no errors in the page", bad.length === 0, bad.slice(0, 4));

  sql(`delete from public.jobs where id = ${q(jobId)}; delete from public.apply_details where user_id = ${q(anaId)};`);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error("The test could not run:", error.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 8).join(" | ")); process.exit(2); });
