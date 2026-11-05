// Tests the Gmail connect-state rules against the LOCAL Supabase copy, the way the page and the
// browser use them. Usage, from apps/web, after npx supabase start and npm run chat:local:seed:
//   node scripts/auto-apply-local/gmail-db.cjs
const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const url = (raw.match(/^API_URL="?([^"\n]*)"?/m) || [])[1];
const key = (raw.match(/^PUBLISHABLE_KEY="?([^"\n]*)"?/m) || raw.match(/^ANON_KEY="?([^"\n]*)"?/m))[1];
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("local copy only");
const anon = createClient(url, key, { auth: { persistSession: false } });
const sql = s => execSync("docker exec -i supabase_db_web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tA", { input: s, encoding: "utf8" }).trim();
const q = t => `'${String(t).replace(/'/g, "''")}'`;
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));

let passed = 0, failed = 0;
const check = (name, ok, detail) => { if (ok) { passed++; console.log("PASS  " + name); } else { failed++; console.log(`FAIL  ${name}${detail === undefined ? "" : ": " + JSON.stringify(detail)}`); } };
const signIn = async who => { const c = createClient(url, key, { auth: { persistSession: false } }); const r = await c.auth.signInWithPassword({ email: who.email, password: who.password }); if (r.error) throw r.error; return c; };

async function main() {
  const ana = { ...people["ana@example.com"], email: "ana@example.com" };
  const ben = { ...people["ben@example.com"], email: "ben@example.com" };
  const boss = { ...people["chrislim@kiasa.tech"], email: "chrislim@kiasa.tech" };
  sql(`delete from public.apply_gmail where user_id in (${q(ana.id)}, ${q(ben.id)});`);
  const agentKey = `kapp_${crypto.randomBytes(32).toString("hex")}`;
  const agent = sql(`insert into public.browser_agents (owner, owner_name, name) values (${q(ana.id)}, 'Ana', 'gmail-test') returning id`).split("\n")[0];
  sql(`insert into public.browser_agent_keys (agent_id, key_hash) values (${q(agent)}, sha256(convert_to(${q(agentKey)}, 'UTF8')));`);

  const asAna = await signIn(ana);
  const asBen = await signIn(ben);

  // Nothing yet.
  let r = await anon.rpc("browser_agent_gmail", { agent_key: agentKey });
  check("a fresh member wants nothing and has no email", r.data?.want_connect === false && r.data?.email === "", r);

  // Member asks to connect.
  r = await asAna.rpc("apply_gmail_request", { connect: true });
  check("a member can ask to connect", !r.error, r);
  r = await anon.rpc("browser_agent_gmail", { agent_key: agentKey });
  check("the browser sees the connect request", r.data?.want_connect === true && r.data?.want_disconnect === false, r);

  // Browser reports connected.
  r = await anon.rpc("browser_agent_gmail_report", { agent_key: agentKey, email: "ana.test@gmail.com", connected: true });
  check("the browser reports it connected", !r.error, r);
  r = await asAna.from("apply_gmail").select("email, connected_at, want_connect").eq("user_id", ana.id).maybeSingle();
  check("the member sees the connected address", r.data?.email === "ana.test@gmail.com" && !!r.data?.connected_at && r.data?.want_connect === false, r.data);
  r = await anon.rpc("browser_agent_gmail", { agent_key: agentKey });
  check("the request is cleared, and the address is a sign-in hint", r.data?.want_connect === false && r.data?.email === "ana.test@gmail.com", r);

  // Another member cannot see it.
  r = await asBen.from("apply_gmail").select("email").eq("user_id", ana.id);
  check("another member cannot see it", (r.data?.length ?? 0) === 0, r);

  // An admin can see who connected.
  const isAdmin = await (await signIn(boss)).rpc("jobs_admin");
  if (isAdmin.data === true) {
    r = await (await signIn(boss)).from("apply_gmail").select("email").eq("user_id", ana.id).maybeSingle();
    check("an admin sees the connected address", r.data?.email === "ana.test@gmail.com", r.data);
  } else console.log("SKIP  admin check: test account is not admin");

  // Member asks to disconnect; browser reports done.
  r = await asAna.rpc("apply_gmail_request", { connect: false });
  check("a member can ask to disconnect", !r.error, r);
  r = await anon.rpc("browser_agent_gmail", { agent_key: agentKey });
  check("the browser sees the disconnect request", r.data?.want_disconnect === true, r);
  await anon.rpc("browser_agent_gmail_report", { agent_key: agentKey, email: "", connected: false });
  r = await asAna.from("apply_gmail").select("email, want_disconnect").eq("user_id", ana.id).maybeSingle();
  check("after disconnect the address is gone", !r.data?.email && r.data?.want_disconnect === false, r.data);

  // Only a real browser key works.
  r = await anon.rpc("browser_agent_gmail", { agent_key: "kapp_" + "0".repeat(64) });
  check("an unknown key is refused", r.error?.code === "28000", r);
  r = await anon.rpc("apply_gmail_request", { connect: true });
  check("someone signed out cannot ask", !!r.error, r);

  sql(`delete from public.apply_gmail where user_id = ${q(ana.id)}; delete from public.browser_agents where id = ${q(agent)};`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error("could not run:", (e.message || e).split("\n").slice(0, 4).join(" | ")); process.exit(2); });
