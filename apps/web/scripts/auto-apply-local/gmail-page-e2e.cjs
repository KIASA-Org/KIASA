// End-to-end test of the Connect Gmail card on /apply, against the LOCAL copy and a local site on
// 3002. It plays the browser by calling the report RPC with a test key. Usage, from apps/web:
//   node scripts/auto-apply-local/gmail-page-e2e.cjs
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://127.0.0.1:3002";
const URL_ = "http://127.0.0.1:54321";
const KEY = (execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).match(/^PUBLISHABLE_KEY="?([^"\n]*)"?/m) || [])[1];
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const sql = s => execSync("docker exec -i supabase_db_web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tA", { input: s, encoding: "utf8" }).trim();
const q = t => `'${String(t).replace(/'/g, "''")}'`;
const out = path.join(os.tmpdir(), "kiasa-apply-e2e");
fs.mkdirSync(out, { recursive: true });

let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log("PASS  " + n); } else { failed++; console.log(`FAIL  ${n}${d === undefined ? "" : ": " + JSON.stringify(d)}`); } };

async function main() {
  const ana = people["ana@example.com"];
  sql(`delete from public.apply_gmail where user_id = ${q(ana.id)}; delete from public.browser_agents where name = 'gmail-page-test';`);
  const agentKey = `kapp_${crypto.randomBytes(32).toString("hex")}`;
  const agent = sql(`insert into public.browser_agents (owner, owner_name, name) values (${q(ana.id)}, 'Ana', 'gmail-page-test') returning id`).split("\n")[0];
  sql(`insert into public.browser_agent_keys (agent_id, key_hash) values (${q(agent)}, sha256(convert_to(${q(agentKey)}, 'UTF8')));`);
  const anon = createClient(URL_, KEY, { auth: { persistSession: false } });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE + "/sign-in", { timeout: 120000 });
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByLabel("Password").fill(ana.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(u => !u.pathname.includes("sign-in"), { timeout: 60000 });
  await page.goto(BASE + "/apply", { timeout: 120000 });

  const card = page.locator("section.apply-gmail");
  await card.getByRole("heading", { name: "Gmail for verification codes" }).waitFor({ timeout: 45000 });
  await card.getByRole("button", { name: "Connect Gmail" }).waitFor({ timeout: 20000 });
  check("starts not connected, with a Connect button", (await card.getByRole("status").first().innerText()).includes("Not connected"));

  await card.getByRole("button", { name: "Connect Gmail" }).click();
  await card.getByText("Waiting for you to allow it").waitFor({ timeout: 10000 });
  check("after Connect it waits and tells you to open the browser", await card.getByText(/A Google .*Allow.* page will appear/).isVisible());
  check("the browser's request is set in the database", sql(`select want_connect from public.apply_gmail where user_id = ${q(ana.id)}`) === "t");

  // The browser connects and reports back; the card should update live.
  await anon.rpc("browser_agent_gmail_report", { agent_key: agentKey, email: "ana.silva@gmail.com", connected: true });
  await card.getByText("Connected: ana.silva@gmail.com").waitFor({ timeout: 15000 });
  check("the card shows connected the moment the browser reports it, without a reload", true);
  check("and offers Disconnect", await card.getByRole("button", { name: "Disconnect" }).isVisible());
  await page.screenshot({ path: path.join(out, "gmail-connected.png"), fullPage: true });

  await card.getByRole("button", { name: "Disconnect" }).click();
  check("disconnect sets the request", sql(`select want_disconnect from public.apply_gmail where user_id = ${q(ana.id)}`) === "t");
  await anon.rpc("browser_agent_gmail_report", { agent_key: agentKey, email: "", connected: false });
  await card.getByRole("button", { name: "Connect Gmail" }).waitFor({ timeout: 15000 });
  check("once the browser confirms, it is back to Connect", true);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
  const small = await phone.newPage();
  await small.goto(BASE + "/apply", { timeout: 120000 });
  await small.locator("section.apply-gmail").waitFor({ timeout: 45000 });
  check("no sideways scroll on a phone", (await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);

  check("no page errors", errors.filter(e => !/favicon/i.test(e)).length === 0, errors.slice(0, 3));
  sql(`delete from public.apply_gmail where user_id = ${q(ana.id)}; delete from public.browser_agents where id = ${q(agent)};`);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error("could not run:", (e.message || e).replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 6).join(" | ")); process.exit(2); });
