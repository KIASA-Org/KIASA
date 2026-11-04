// Tests the Auto apply database rules against the LOCAL Supabase copy, calling them the way
// a KIASA Browser does: with the site's public key and its own secret key. Each run makes its
// own made-up jobs and removes them again. Usage, from apps/web, after `npx supabase start`
// and `npm run chat:local:seed`: node scripts/auto-apply-local/check.cjs
// Stop any local model server first: it says it is on every 30 seconds, and this tests it being off.
const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function localEnv() {
  const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]*)"?`, "m")) || [])[1] || "";
  const env = { url: get("API_URL"), secret: get("SECRET_KEY") || get("SERVICE_ROLE_KEY"), anon: get("PUBLISHABLE_KEY") || get("ANON_KEY") };
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error("Refusing: this is only for the local Supabase copy");
  return env;
}
const env = localEnv();
const sql = statement => execSync("docker exec -i supabase_db_web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tA", { input: statement, encoding: "utf8" }).trim();
const anon = createClient(env.url, env.anon, { auth: { persistSession: false } });
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`); }
}

const signIn = async who => {
  const client = createClient(env.url, env.anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) throw new Error(`could not sign in ${who.email}: ${error.message}`);
  return client;
};
const q = text => `'${String(text).replace(/'/g, "''")}'`;
const RUN = crypto.randomBytes(4).toString("hex");

async function main() {
  const list = Object.entries(people).map(([email, value]) => typeof value === "string" ? { email, id: value } : { email, ...value });
  const ana = list.find(p => /ana/i.test(p.email));
  const ben = list.find(p => /ben/i.test(p.email));
  const boss = list.find(p => /admin|boss|chris|owner/i.test(p.email)) ?? list.find(p => p.admin);
  if (!ana || !ben) throw new Error("run npm run chat:local:seed first");
  const anaId = ana.id ?? sql(`select id from auth.users where email = ${q(ana.email)}`);
  const benId = ben.id ?? sql(`select id from auth.users where email = ${q(ben.email)}`);

  const key = `kapp_${crypto.randomBytes(32).toString("hex")}`;
  const benKey = `kapp_${crypto.randomBytes(32).toString("hex")}`;
  const agent = sql(`insert into public.browser_agents (owner, owner_name, name) values (${q(anaId)}, 'Ana', 'test ${RUN}') returning id`).split("\n")[0];
  const benAgent = sql(`insert into public.browser_agents (owner, owner_name, name) values (${q(benId)}, 'Ben', 'test ${RUN}') returning id`).split("\n")[0];
  sql(`insert into public.browser_agent_keys (agent_id, key_hash) values (${q(agent)}, sha256(convert_to(${q(key)}, 'UTF8'))), (${q(benAgent)}, sha256(convert_to(${q(benKey)}, 'UTF8')));`);

  // Anything an earlier run left behind when it stopped part way.
  sql(`delete from public.jobs where url like '%/acme/jobs/%' or url like 'https://careers.acme.example/%' or url like 'https://jobs.lever.co/acme/%' or url like 'https://example.com/%/old/%';
       delete from public.browser_agents where name like 'test %' and id not in (${q(agent)}, ${q(benAgent)});
       update public.profiles set status = 'approved' where id in (${q(anaId)}, ${q(benId)});`);
  // The only jobs Ana has left to do are these: older ones of hers are out of the way.
  sql(`delete from public.model_server;`);
  sql(`delete from public.apply_details where user_id in (${q(anaId)}, ${q(benId)});
       delete from public.apply_control where user_id in (${q(anaId)}, ${q(benId)});
       delete from public.apply_results where user_id in (${q(anaId)}, ${q(benId)});
       delete from public.tailored_resumes where user_id in (${q(anaId)}, ${q(benId)});
       delete from public.applications where user_id = ${q(anaId)} and applied_at >= now() - interval '2 days';
       update public.jobs set posted_at = posted_at - interval '30 days' where posted_at > now() - interval '7 days' and url !~ '${RUN}';`);

  const job = (host, suffix) => sql(`insert into public.jobs (url, title, company, description, posted_at) values ('${host}/${RUN}/${suffix}', 'Engineer ${suffix}', 'Acme', 'A job description', now() - interval '${suffix} minutes') returning id`).split("\n")[0];
  const greenhouse = job("https://job-boards.greenhouse.io/acme/jobs", "1");
  const companyPage = sql(`insert into public.jobs (url, title, posted_at) values ('https://careers.acme.example/${RUN}?gh_jid=2', 'Engineer on their own page', now() - interval '30 seconds') returning id`).split("\n")[0];
  const lever = job("https://jobs.lever.co/acme", "3");
  const fakeGreenhouse = job("https://greenhouse.io.evil.example/acme/jobs", "4");
  job("https://boards.greenhouse.io/acme/jobs", "5"); // Never gets a résumé, so it always waits.

  const next = async (k = key) => anon.rpc("browser_agent_next_job", { agent_key: k });
  const report = (jobId, outcome, reason = null, asks = [], k = key) => anon.rpc("browser_agent_report", { agent_key: k, job: jobId, outcome, reason, asks });
  const setMode = mode => sql(`insert into public.apply_control (user_id, mode) values (${q(anaId)}, ${q(mode)}) on conflict (user_id) do update set mode = excluded.mode;`);
  const tailor = (jobId, who = anaId) => sql(`insert into public.tailored_resumes (job_id, user_id, profile) values (${q(jobId)}, ${q(who)}, '{"info":{"name":"Ana"},"summary":"made for this job"}') on conflict (job_id, user_id) do nothing;`);

  // ── Who a key belongs to
  let r = await anon.rpc("browser_agent_who", { agent_key: key });
  check("a key says which member it belongs to", r.data === anaId, r);
  r = await anon.rpc("browser_agent_who", { agent_key: "kapp_" + "0".repeat(64) });
  check("an unknown key is refused with the code browsers look for", r.error?.code === "28000", r);
  r = await anon.rpc("browser_agent_owner", { agent_key: key });
  check("the helper cannot be called from outside", !!r.error, r);

  // ── Off until switched on
  r = await next();
  check("with no switch set, the browser is told off and given no job", r.data?.mode === "off" && !r.data.job, r);
  setMode("fill");
  r = await next();
  check("with no details saved, it says so", r.data?.stop === "no_details" && !r.data.job, r);

  sql(`insert into public.apply_details (user_id, details) values (${q(anaId)}, '{"first_name":"Ana","facts":[]}');`);
  r = await next();
  check("details saved, it says what else is missing", r.data?.stop === "model_server_off" && !r.data.job, r);

  sql(`insert into public.model_server (id, address, seen_at) values (true, 'https://test.trycloudflare.com', now()) on conflict (id) do update set address = excluded.address, seen_at = now();`);
  r = await next();
  check("with no résumé made, the job waits", r.data?.stop === "waiting_for_resumes" && !r.data.job && r.data.waiting_for_resumes >= 2, r);

  // ── Taking jobs
  tailor(greenhouse); tailor(lever); tailor(fakeGreenhouse); tailor(companyPage);
  r = await next();
  check("it takes the newest job with a résumé", r.data?.job?.id === companyPage, r.data?.job);
  check("a company's page holding a Greenhouse job counts", r.data?.job?.url.includes("gh_jid"), r.data?.job);
  r = await report(companyPage, "skipped", "Not needed in this test");
  check("a job can be reported", !r.error, r);
  r = await next();
  check("it comes with the job's description", r.data?.job?.id === greenhouse && r.data.job.description === "A job description", r.data?.job);
  check("it comes with the résumé made for that job", r.data?.resume?.summary === "made for this job", r.data?.resume);
  check("it comes with the member's details", r.data?.details?.first_name === "Ana", r.data?.details);
  const second = await next();
  check("a job being worked on is not handed out twice", second.data?.job?.id !== greenhouse, second.data);
  check("a job on another site is never handed out", second.data?.job?.id !== lever, second.data);
  check("an address only pretending to be Greenhouse is never handed out", second.data?.job?.id !== fakeGreenhouse, second.data);
  r = await anon.rpc("browser_agent_resume", { agent_key: key, job: greenhouse });
  check("the résumé can be fetched for printing", r.data?.summary === "made for this job", r);
  r = await anon.rpc("browser_agent_resume", { agent_key: benKey, job: greenhouse });
  check("another member's browser gets no résumé", r.data === null && !r.error, r);

  // ── Reporting
  r = await report(greenhouse, "applied");
  check("it cannot report applied unless set to apply", r.error?.code === "42501", r);
  r = await report(greenhouse, "filled", null, null);
  check("a report whose questions are not a list is refused", r.error?.code === "22023", r);
  r = await report(greenhouse, "nonsense");
  check("a made-up result is refused", r.error?.code === "22023", r);
  r = await report(greenhouse, "filled", null, [], benKey);
  check("another member's browser cannot report this job", r.error?.code === "P0002", r);
  r = await report(lever, "filled");
  check("a job that was not handed out cannot be reported", r.error?.code === "P0002", r);
  r = await report(greenhouse, "filled", "Would have sent");
  check("a filled form is reported", !r.error, r);
  const shown = sql(`select count(*) from public.applications where job_id = ${q(greenhouse)} and user_id = ${q(anaId)}`);
  check("a filled form is not counted as applied", shown === "0", shown);
  r = await next();
  check("in fill mode, a filled form is not taken again", r.data?.job?.id !== greenhouse, r.data);

  setMode("apply");
  r = await next();
  check("in apply mode, a filled form is taken again", r.data?.job?.id === greenhouse, r.data?.job);
  r = await report(greenhouse, "applied");
  check("in apply mode, it can report applied", !r.error, r);
  const applied = sql(`select status || '|' || (applied_at is not null) from public.applications where job_id = ${q(greenhouse)} and user_id = ${q(anaId)}`);
  check("an applied job counts as an application", applied === "applied|true", applied);
  r = await next();
  check("an applied job is never taken again", r.data?.job?.id !== greenhouse, r.data);

  // ── Trying again
  const retry = job("https://job-boards.greenhouse.io/acme/jobs", "0");
  tailor(retry);
  r = await next();
  check("the next job comes", r.data?.job?.id === retry, r.data?.job);
  await report(retry, "failed", "The form did not finish loading");
  r = await next();
  check("a failed job is not retried straight away", r.data?.job?.id !== retry, r.data?.job);
  sql(`update public.apply_results set updated_at = now() - interval '31 minutes' where job_id = ${q(retry)} and user_id = ${q(anaId)};`);
  r = await next();
  check("a failed job is retried later", r.data?.job?.id === retry, r.data?.job);
  await report(retry, "failed", "Again");
  sql(`update public.apply_results set updated_at = now() - interval '31 minutes' where job_id = ${q(retry)} and user_id = ${q(anaId)};`);
  r = await next();
  check("a second retry", r.data?.job?.id === retry, r.data?.job);
  await report(retry, "failed", "And again");
  sql(`update public.apply_results set updated_at = now() - interval '31 minutes' where job_id = ${q(retry)} and user_id = ${q(anaId)};`);
  r = await next();
  check("after three tries it stops", r.data?.job?.id !== retry, r.data?.job);

  const stuck = job("https://job-boards.greenhouse.io/acme/jobs", "00");
  tailor(stuck);
  r = await next();
  check("a job is taken", r.data?.job?.id === stuck, r.data?.job);
  sql(`update public.apply_results set updated_at = now() - interval '16 minutes' where job_id = ${q(stuck)} and user_id = ${q(anaId)};`);
  r = await next();
  check("a job left working by a crash comes back", r.data?.job?.id === stuck, r.data?.job);

  // ── However long ago it was saved
  const longAgo = sql(`insert into public.jobs (url, title, posted_at) values ('https://job-boards.greenhouse.io/acme/jobs/${RUN}/old', 'Saved long ago', now() - interval '60 days') returning id`).split("\n")[0];
  sql(`delete from public.apply_results where job_id = ${q(stuck)} and user_id = ${q(anaId)}; delete from public.tailored_resumes where job_id = ${q(stuck)} and user_id = ${q(anaId)};`);
  tailor(longAgo);
  r = await next();
  check("a job saved long ago is still taken if it has a résumé", r.data?.job?.id === longAgo, r.data?.job);
  await report(longAgo, "skipped", "Done with this test");
  tailor(stuck);
  r = await next();
  check("the job comes back with its résumé", r.data?.job?.id === stuck, r.data?.job);

  // ── Giving a job back
  r = await report(stuck, "released");
  check("a job can be given back untouched", !r.error, r);
  check("with no trace", sql(`select count(*) from public.apply_results where job_id = ${q(stuck)} and user_id = ${q(anaId)}`) === "0");
  r = await next();
  check("and it is taken again at once", r.data?.job?.id === stuck, r.data?.job);

  // ── Questions for the member
  const asks = [{ id: "q1", label: "I confirm this is my own work.", why: "This is a statement you make yourself.", kind: "checkbox" }];
  r = await report(stuck, "waiting", "Needs your answer", asks);
  check("a job can wait for the member", !r.error, r);
  const kept = sql(`select asks->0->>'label' from public.apply_results where job_id = ${q(stuck)} and user_id = ${q(anaId)}`);
  check("the question is kept for them", kept === asks[0].label, kept);
  r = await next();
  check("a waiting job is not retried until they answer", r.data?.job?.id !== stuck, r.data?.job);
  sql(`update public.apply_results set updated_at = now() - interval '1 second' where job_id = ${q(stuck)} and user_id = ${q(anaId)};
       update public.apply_details set details = details || '{"facts":[{"question":"I confirm this is my own work.","answer":"yes"}]}' where user_id = ${q(anaId)};`);
  r = await next();
  check("once they answer, the job comes back", r.data?.job?.id === stuck, r.data?.job);
  check("with their answer", r.data?.details?.facts?.[0]?.answer === "yes", r.data?.details);
  await report(stuck, "skipped", "Done with this test");

  // ── The day's limit
  sql(`delete from public.apply_results where job_id in (select id from public.jobs where url like '%${RUN}%' and url like 'https://job-boards%') and user_id = ${q(anaId)};`);
  const today = sql(`select count(*) from public.applications where user_id = ${q(anaId)} and applied_at >= date_trunc('day', now() at time zone coalesce((select timezone from public.job_settings where id = 1), 'UTC')) at time zone coalesce((select timezone from public.job_settings where id = 1), 'UTC')`);
  const needed = 100 - Number(today);
  sql(`insert into public.jobs (url, title, posted_at) select 'https://example.com/${RUN}/old/' || n, 'Old job', now() - interval '40 days' from generate_series(1, ${needed}) n;
       insert into public.applications (job_id, user_id, status) select id, ${q(anaId)}, 'applied' from public.jobs where url like 'https://example.com/${RUN}/old/%';`);
  r = await next();
  check("at 100 applications today, it stops for the day", r.data?.stop === "limit" && !r.data.job && r.data.applied_today === 100, r.data);
  sql(`update public.model_server set seen_at = now();`);
  sql(`delete from public.applications where user_id = ${q(anaId)} and job_id in (select id from public.jobs where url like 'https://example.com/${RUN}/old/%');`);

  // ── The model server
  const serverKey = `kserver_${crypto.randomBytes(24).toString("hex")}`;
  sql(`insert into public.model_server_keys (key_hash) values (sha256(convert_to(${q(serverKey)}, 'UTF8')));`);
  const address = `https://test-${RUN}.trycloudflare.com`;
  r = await anon.rpc("model_server_report", { server_key: "wrong", address });
  check("a wrong key cannot say where the server is", r.error?.code === "28000", r);
  for (const bad of ["http://test.trycloudflare.com", "https://evil.example", "https://evil.example/.trycloudflare.com", "https://a.trycloudflare.com.evil.example", "https://a.trycloudflare.com/path", "http://127.0.0.1.evil.example:8787", "http://127.0.0.1:8787/path", "http://10.0.0.1:8787"]) {
    r = await anon.rpc("model_server_report", { server_key: serverKey, address: bad });
    check(`it cannot send browsers to ${bad}`, r.error?.code === "22023", r);
  }
  r = await anon.rpc("model_server_report", { server_key: serverKey, address: "http://127.0.0.1:8787" });
  check("this PC's address is accepted, for trying it locally", !r.error, r);
  r = await anon.rpc("model_server_report", { server_key: serverKey, address, waiting: 3 });
  check("the server says where it is", !r.error, r);
  r = await next();
  check("browsers are told where it is", r.data?.model_server === address, r.data?.model_server);
  const asTeam = await signIn(ana);
  r = await asTeam.rpc("model_server_status");
  check("the team can see it is on, and how busy", r.data?.on === true && r.data.waiting === 3, r);
  check("but not its address", !JSON.stringify(r.data).includes("trycloudflare"), r.data);
  r = await anon.rpc("model_server_status");
  check("no one signed out can see that", !!r.error, r);
  r = await asTeam.rpc("model_server_admin_status");
  check("a member cannot see who is connected", r.error?.code === "42501", r);
  sql(`update public.model_server set seen_at = now() - interval '4 minutes';`);
  r = await next();
  check("a server not heard from lately is taken to be off", !r.data?.model_server, r.data?.model_server);
  r = await asTeam.rpc("model_server_status");
  check("and the page says so", r.data?.on === false, r);
  sql(`delete from public.model_server; delete from public.model_server_keys where key_hash = sha256(convert_to(${q(serverKey)}, 'UTF8'));`);

  // ── Who may read and write what
  const asAna = await signIn(ana);
  const asBen = await signIn(ben);
  for (const table of ["apply_details", "apply_control", "apply_results", "model_server", "model_server_keys", "browser_agent_keys"]) {
    r = await anon.from(table).select("*").limit(1);
    check(`no one signed out can read ${table}`, !!r.error || r.data.length === 0, r);
  }
  r = await asAna.from("apply_details").select("details").eq("user_id", anaId).maybeSingle();
  check("a member reads their own details", r.data?.details?.first_name === "Ana", r);
  r = await asBen.from("apply_details").select("details").eq("user_id", anaId);
  check("another member cannot read them", r.data?.length === 0, r);
  r = await asBen.from("apply_details").update({ details: { first_name: "Changed" } }).eq("user_id", anaId).select();
  check("another member cannot change them", (r.data?.length ?? 0) === 0, r);
  r = await asBen.from("apply_details").upsert({ user_id: benId, details: { first_name: "Ben" } }).select();
  check("a member saves their own", r.data?.length === 1 && !r.error, r);
  r = await asBen.from("apply_details").insert({ user_id: anaId, details: {} });
  check("a member cannot save someone else's", !!r.error, r);
  r = await asAna.from("apply_results").select("job_id").eq("user_id", anaId);
  check("a member reads their results", (r.data?.length ?? 0) > 0, r);
  r = await asBen.from("apply_results").select("job_id").eq("user_id", anaId);
  check("another member cannot read them", r.data?.length === 0, r);
  r = await asAna.from("apply_results").update({ outcome: "applied" }).eq("user_id", anaId);
  check("a member cannot write results directly", !!r.error, r);
  r = await asAna.from("apply_control").update({ mode: "off" }).eq("user_id", anaId).select();
  check("a member can stop their own browser", r.data?.[0]?.mode === "off", r);
  r = await asBen.from("apply_control").update({ mode: "apply" }).eq("user_id", anaId).select();
  check("another member cannot switch it", (r.data?.length ?? 0) === 0, r);
  r = await next();
  check("stopped, it is given no job", r.data?.mode === "off" && !r.data.job, r.data);

  if (boss) {
    const asBoss = await signIn(boss);
    const isAdmin = await asBoss.rpc("jobs_admin");
    if (isAdmin.data === true) {
      r = await asBoss.from("apply_results").select("job_id").eq("user_id", anaId);
      check("an admin reads a member's results", (r.data?.length ?? 0) > 0, r);
      r = await asBoss.from("apply_details").select("details").eq("user_id", anaId);
      check("an admin cannot read a member's details", r.data?.length === 0, r);
      r = await asBoss.from("apply_control").update({ mode: "off" }).eq("user_id", anaId).select();
      check("an admin can stop a member's browser", r.data?.[0]?.mode === "off", r);
    } else console.log("SKIP  admin checks: this test account is not an admin here");
  } else console.log("SKIP  admin checks: no admin in the seed file");

  // ── Leaving the team
  const status = sql(`select status from public.profiles where id = ${q(anaId)}`);
  sql(`update public.profiles set status = 'declined' where id = ${q(anaId)};`);
  r = await next();
  check("a browser stops working once its member leaves the team", r.error?.code === "28000", r);
  r = await anon.rpc("browser_agent_who", { agent_key: key });
  check("and the model server refuses it too", r.error?.code === "28000", r);
  sql(`update public.profiles set status = ${q(status)} where id = ${q(anaId)};`);

  // ── Tidying up
  sql(`delete from public.applications where user_id = ${q(anaId)} and job_id in (select id from public.jobs where url like '%${RUN}%');
       delete from public.jobs where url like '%${RUN}%';
       delete from public.browser_agents where id in (${q(agent)}, ${q(benAgent)});
       delete from public.apply_details where user_id in (${q(anaId)}, ${q(benId)});
       delete from public.apply_control where user_id in (${q(anaId)}, ${q(benId)});
       delete from public.apply_results where user_id in (${q(anaId)}, ${q(benId)});`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error("The test could not run:", error.message.split("\n").slice(0, 6).join(" ")); process.exit(2); });
