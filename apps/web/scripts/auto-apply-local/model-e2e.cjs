// End-to-end test of the admin's Model server tab, against the LOCAL Supabase copy and a local
// server on port 3002. Plays the model server itself by calling what it calls, so stop any real
// local model server first. Usage, from apps/web: node scripts/auto-apply-local/model-e2e.cjs
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://127.0.0.1:3002";
const URL_ = "http://127.0.0.1:54321";
const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const KEY = (raw.match(/^PUBLISHABLE_KEY="?([^"\n]*)"?/m) || raw.match(/^ANON_KEY="?([^"\n]*)"?/m))[1];
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

async function main() {
  const ana = people["ana@example.com"];
  const ben = people["ben@example.com"];
  const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
  const serverKey = `kserver_${crypto.randomBytes(24).toString("hex")}`;
  sql(`delete from public.model_server; insert into public.model_server_keys (key_hash) values (sha256(convert_to(${q(serverKey)}, 'UTF8')));
       delete from public.browser_agents where name like 'model-test%';`);
  const healthy = { ollama: true, model: "qwen3:8b", installed: true, loaded: true, on_gpu: 100, answered: 12, failed: 0, average_seconds: 4.2, last_answer_seconds_ago: 30, last_failure_seconds_ago: null };
  const report = (health, connected, waiting = 2) => anon.rpc("model_server_report", { server_key: serverKey, address: "https://test-model.trycloudflare.com", waiting, health, connected });

  // Only an admin can read this.
  const asAna = createClient(URL_, KEY, { auth: { persistSession: false } });
  await asAna.auth.signInWithPassword({ email: "ana@example.com", password: ana.password });
  let r = await asAna.rpc("model_server_admin_status");
  check("a member cannot read it", r.error?.code === "42501", r);
  r = await anon.rpc("model_server_admin_status");
  check("nor can someone signed out", !!r.error, r);
  r = await report([], {});
  check("a report of the wrong shape is refused", r.error?.code === "22023", r);
  r = await anon.rpc("model_server_report", { server_key: "wrong", address: "https://test-model.trycloudflare.com", waiting: 0, health: {}, connected: [] });
  check("a wrong key cannot report", r.error?.code === "28000", r);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(BASE + "/sign-in", { timeout: 120000 });
  await page.getByLabel("Email").fill("chrislim@kiasa.tech");
  await page.getByLabel("Password").fill(people["chrislim@kiasa.tech"].password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes("sign-in"), { timeout: 60000 });

  await page.goto(BASE + "/admin", { timeout: 120000 });
  const tab = page.getByRole("link", { name: "Model", exact: true });
  await tab.first().waitFor({ timeout: 30000 });
  check("the admin's bar has a Model tab", true);
  await page.goto(BASE + "/admin/model", { timeout: 120000 });
  const state = page.locator(".model-state");
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const room = await page.evaluate(() => { const nav = document.querySelector(".app-bar-tabs"); return nav.scrollWidth - nav.clientWidth; });
    check(`at ${width} wide every tab in the bar fits`, room <= 0, room);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });

  await state.waitFor({ timeout: 45000 });
  check("with no server heard from, it says Off", (await state.innerText()).includes("Off"), await state.innerText());
  check("and no one is connected", await page.getByText("None, because the model server is off.").isVisible());

  // The server reports: healthy, with two people connected.
  await report(healthy, [{ member: ana.id, seconds_ago: 5, requests: 7 }, { member: ben.id, seconds_ago: 12, requests: 1 }, { member: "not-a-real-id", seconds_ago: 1, requests: 1 }]);
  await page.getByText("Healthy").waitFor({ timeout: 20000 });
  check("once it reports, it says Healthy", true);
  check("with what is loaded", await page.getByText("qwen3:8b is loaded, 100% on the GPU.").isVisible());
  const rowOf = name => page.locator(".model-row", { hasText: name });
  check("it names who is connected", await rowOf(ana.name).count() === 1 && await rowOf(ben.name).count() === 1, [ana.name, ben.name]);
  check("with how many jobs each", (await rowOf(ana.name).innerText()).includes("7 jobs answered") && (await rowOf(ben.name).innerText()).includes("1 job answered"));
  check("a line that names no real person is left out", await page.locator(".model-row").count() === 2, await page.locator(".model-row").count());
  check("it shows the counts", (await page.locator(".model-facts").innerText()).includes("4.2 s a job"));
  await page.screenshot({ path: path.join(out, "model-healthy.png"), fullPage: true });

  // A browser that is on but has not reached the server.
  const agent = sql(`insert into public.browser_agents (owner, owner_name, name, computer, version, state, seen_at) values (${q(people["cara@example.com"].id)}, 'Cara Test', 'model-test', 'CARA-PC', '1.2.0', 'idle', now()) returning id`).split("\n")[0];
  await page.getByText("Browser on, not connected").waitFor({ timeout: 20000 });
  check("a browser that is on but not connected is listed apart", (await rowOf("Cara Test").innerText()).includes("CARA-PC"));
  sql(`delete from public.browser_agents where id = ${q(agent)};`);

  // The things that go wrong.
  await report({ ...healthy, ollama: false }, []);
  await page.getByText("Ollama is not running").waitFor({ timeout: 20000 });
  check("Ollama being down is named", true);
  await report({ ...healthy, installed: false }, []);
  await page.getByText("The model is not installed").waitFor({ timeout: 20000 });
  check("the model being missing is named", true);
  await report({ ...healthy, failed: 3, last_failure_seconds_ago: 20, last_answer_seconds_ago: 300 }, []);
  await page.getByText("Having trouble").waitFor({ timeout: 20000 });
  check("recent failures are named", true);
  await report({ ...healthy, failed: 3, last_failure_seconds_ago: 300, last_answer_seconds_ago: 20 }, []);
  await page.getByText("Healthy").waitFor({ timeout: 20000 });
  check("an answer since then clears it", true);

  sql(`update public.model_server set seen_at = now() - interval '4 minutes';`);
  await state.getByText("Off").waitFor({ timeout: 20000 });
  check("a server not heard from lately goes Off by itself", true);

  // A member gets nothing from this page.
  const member = await browser.newContext();
  const memberPage = await member.newPage();
  await memberPage.goto(BASE + "/sign-in", { timeout: 120000 });
  await memberPage.getByLabel("Email").fill("ana@example.com");
  await memberPage.getByLabel("Password").fill(ana.password);
  await memberPage.getByRole("button", { name: /sign in/i }).click();
  await memberPage.waitForURL(url => !url.pathname.includes("sign-in"), { timeout: 60000 });
  await memberPage.goto(BASE + "/admin/model", { timeout: 120000 });
  await memberPage.waitForTimeout(1500);
  check("a member cannot open the page", await memberPage.locator(".model-desk").count() === 0);
  await memberPage.goto(BASE + "/apply", { timeout: 120000 });
  await memberPage.getByRole("heading", { name: "The agent" }).waitFor({ timeout: 45000 });
  check("and has no such tab", await memberPage.getByRole("link", { name: "Model", exact: true }).count() === 0);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const small = await phone.newPage();
  await report(healthy, [{ member: ana.id, seconds_ago: 5, requests: 7 }]);
  await small.goto(BASE + "/admin/model", { timeout: 120000 });
  await small.getByText("Healthy").waitFor({ timeout: 45000 });
  const wide = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("at phone width the page does not scroll sideways", wide <= 0, wide);
  await small.screenshot({ path: path.join(out, "model-phone.png"), fullPage: true });

  const noise = errors.filter(text => !/favicon|Failed to load resource.*(404|401)/i.test(text));
  if (noise.length) fs.writeFileSync(path.join(out, "model-errors.txt"), noise.join(String.fromCharCode(10) + "-----" + String.fromCharCode(10)));
  check("no errors in the page", noise.length === 0, noise.slice(0, 4));

  sql(`delete from public.model_server; delete from public.model_server_keys where key_hash = sha256(convert_to(${q(serverKey)}, 'UTF8'));`);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${out}`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error("The test could not run:", error.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 8).join(" | ")); process.exit(2); });
