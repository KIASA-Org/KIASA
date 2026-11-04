// Tests the résumé PDF route against the LOCAL Supabase copy and a local server on port 3002:
// a KIASA Browser gets a job's résumé with its key alone, and signed-in members still get theirs
// as before. Usage, from apps/web: node scripts/auto-apply-local/resume-e2e.cjs
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://127.0.0.1:3002";
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const sql = statement => execSync("docker exec -i supabase_db_web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tA", { input: statement, encoding: "utf8" }).trim();
const q = text => `'${String(text).replace(/'/g, "''")}'`;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`); }
}
const isPdf = bytes => Buffer.from(bytes).subarray(0, 5).toString("latin1") === "%PDF-";

async function main() {
  const anaId = people["ana@example.com"].id;
  const benId = people["ben@example.com"].id;
  const run = crypto.randomBytes(4).toString("hex");
  const key = `kapp_${crypto.randomBytes(32).toString("hex")}`;
  const benKey = `kapp_${crypto.randomBytes(32).toString("hex")}`;
  const agent = sql(`insert into public.browser_agents (owner, owner_name, name) values (${q(anaId)}, 'Ana', 'test ${run}') returning id`).split("\n")[0];
  const benAgent = sql(`insert into public.browser_agents (owner, owner_name, name) values (${q(benId)}, 'Ben', 'test ${run}') returning id`).split("\n")[0];
  sql(`insert into public.browser_agent_keys (agent_id, key_hash) values (${q(agent)}, sha256(convert_to(${q(key)}, 'UTF8'))), (${q(benAgent)}, sha256(convert_to(${q(benKey)}, 'UTF8')));`);
  const job = sql(`insert into public.jobs (url, title) values ('https://job-boards.greenhouse.io/acme/jobs/pdf-${run}', 'PDF test') returning id`).split("\n")[0];
  const other = sql(`insert into public.jobs (url, title) values ('https://job-boards.greenhouse.io/acme/jobs/pdf-none-${run}', 'No resume') returning id`).split("\n")[0];
  const profile = JSON.stringify({ info: { name: "Ana Silva", title: "Engineer", location: "Boston", email: "ana@example.com", phone: "+1 555 0100", linkedin: "" }, summary: "Made for this job.", skills: [], experience: [], certifications: [], education: [] });
  sql(`insert into public.tailored_resumes (job_id, user_id, profile) values (${q(job)}, ${q(anaId)}, ${q(profile)}::jsonb);
       insert into public.resume_profiles (user_id, profile, status) values (${q(anaId)}, ${q(profile)}::jsonb, 'typed') on conflict (user_id) do update set profile = excluded.profile;`);

  const get = (jobId, token) => fetch(`${BASE}/jobs/resume/pdf?job=${jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  let r = await get(job, key);
  const bytes = await r.arrayBuffer();
  check("a browser gets its member's résumé for a job, with its key alone", r.status === 200 && isPdf(bytes), r.status);
  check("the file is named as a member's résumé", /Ana Silva Resume\.pdf/.test(r.headers.get("content-disposition") ?? ""), r.headers.get("content-disposition"));
  check("it is not kept along the way", /no-store/.test(r.headers.get("cache-control") ?? ""), r.headers.get("cache-control"));
  r = await get(job, benKey);
  check("another member's browser cannot get it", r.status === 404, r.status);
  r = await get(job, `kapp_${"0".repeat(64)}`);
  check("an unknown key cannot get it", r.status === 401, r.status);
  r = await get(job);
  check("nor can someone with no key", r.status === 401, r.status);
  r = await get(other, key);
  check("a job with no résumé says so", r.status === 404, r.status);
  r = await get("not-a-job", key);
  check("a made-up job id is refused", r.status === 400, r.status);
  r = await fetch(`${BASE}/jobs/resume/pdf?job=${job}`, { headers: { Authorization: "Bearer something-else" } });
  check("a bearer that is not a browser key gets nothing", r.status === 401, r.status);

  // Signed-in members, as before.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(BASE + "/sign-in", { timeout: 120000 });
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByLabel("Password").fill(people["ana@example.com"].password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes("sign-in"), { timeout: 60000 });
  let res = await page.request.get(`${BASE}/jobs/resume/pdf?job=${job}`);
  check("a signed-in member still gets a job's résumé", res.status() === 200 && isPdf(await res.body()), res.status());
  res = await page.request.get(`${BASE}/jobs/resume/pdf?base=1`);
  check("and their base résumé", res.status() === 200 && isPdf(await res.body()), res.status());
  res = await page.request.get(`${BASE}/jobs/resume/pdf?job=${job}&inline=1`);
  check("and can still view it in place", /^inline/.test(res.headers()["content-disposition"] ?? ""), res.headers()["content-disposition"]);
  res = await page.request.post(`${BASE}/jobs/resume/pdf`, { data: { profile: JSON.parse(profile) } });
  check("and can print one not kept on KIASA", res.status() === 200 && isPdf(await res.body()), res.status());
  await browser.close();

  sql(`delete from public.jobs where id in (${q(job)}, ${q(other)}); delete from public.browser_agents where id in (${q(agent)}, ${q(benAgent)});`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error("The test could not run:", error.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 6).join(" | ")); process.exit(2); });
