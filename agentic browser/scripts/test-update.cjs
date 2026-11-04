// End-to-end test of auto-update, on a real install in a folder of its own: builds three test
// versions signed with a throwaway key, and checks that a browser updates itself, refuses forged
// updates, can be put back, and survives a release that will not install. The real KIASA Browser
// is left alone, and that is checked too. Needs the local Supabase copy and the local test account.
// Usage, from "agentic browser": node scripts/test-update.cjs
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync, spawn } = require("child_process");

const WEB = path.resolve(__dirname, "../../apps/web");
const { createClient } = require(path.join(WEB, "node_modules/@supabase/supabase-js"));
const ROOT = path.resolve(__dirname, "..");
const WORK = path.join(os.tmpdir(), "kiasa-update-test");
const PORT = 3004;
const NAME = "KIASA-UpdateTest";
const LOCAL = process.env.LOCALAPPDATA;
const INSTALLED = path.join(LOCAL, "Programs", NAME, "KIASA.exe");
const DATA = path.join(LOCAL, NAME);
const UNINSTALL = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${NAME}`;
const REAL_UNINSTALL = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KIASA";
const SCHEME = "kiasa-browser-updatetest";
const URL_ = "http://127.0.0.1:54321";
const KEY = (execSync("npx supabase status -o env", { cwd: WEB, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).match(/^PUBLISHABLE_KEY="?([^"\n]*)"?/m) || [])[1];
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const ana = people["ana@example.com"];

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`); }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Something not being there to remove is fine, so the script's own errors do not count.
const ps = script => execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`${script}\nexit 0`, "utf16le").toString("base64")}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function readLog(name) {
  try { return fs.readFileSync(path.join(DATA, "logs", name), "utf8"); } catch { return ""; }
}

// ── What the "site" serves.
const served = { manifest: null, files: {} };
const site = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://x").pathname;
  if (pathname === "/latest.json") {
    if (!served.manifest) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(served.manifest);
    return;
  }
  const file = served.files[pathname];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200);
  fs.createReadStream(file).pipe(res);
});

function stopBrowser() {
  ps(`
    $installed = '${INSTALLED.replace(/'/g, "''")}'
    Get-CimInstance Win32_Process -Filter "Name = 'KIASA.exe'" | Where-Object { $_.ExecutablePath -eq $installed } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -match '${NAME}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `);
}

function tidy() {
  stopBrowser();
  ps(`
    Remove-Item -LiteralPath '${path.dirname(INSTALLED)}' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath '${DATA}' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath '${UNINSTALL}' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath 'HKCU:\\Software\\Classes\\${SCHEME}' -Recurse -Force -ErrorAction SilentlyContinue
  `);
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  tidy();
  const realBefore = {
    version: ps(`(Get-ItemProperty '${REAL_UNINSTALL}' -ErrorAction SilentlyContinue).DisplayVersion`),
    file: ps(`$p = Join-Path $env:LOCALAPPDATA 'Programs\\KIASA\\KIASA.exe'; if (Test-Path $p) { (Get-FileHash $p).Hash }`),
    link: ps(`(Get-Item 'HKCU:\\Software\\Classes\\kiasa-browser\\shell\\open\\command' -ErrorAction SilentlyContinue).GetValue('')`),
  };

  // ── A throwaway key, and three versions of the program signed with it.
  console.log("Building the test versions...");
  const signer = path.join(WORK, "signrelease.exe");
  execSync(`go build -o "${signer}" ./tools/signrelease`, { cwd: ROOT, stdio: "ignore" });
  const keyFile = path.join(WORK, "test-key.txt");
  fs.rmSync(keyFile, { force: true });
  const made = execSync(`"${signer}" -new-key -key "${keyFile}"`, { encoding: "utf8" });
  const publicKey = made.match(/brand\.UpdateKey: (\S+)/)[1];
  const brand = "stealth-app/internal/brand";
  const flags = [
    `-X ${brand}.LocalTest=on`, `-X ${brand}.DatabaseHost=127.0.0.1:54321`, `-X ${brand}.SiteURL=http://127.0.0.1:3002`,
    `-X ${brand}.AppLinkScheme=${SCHEME}`, `-X ${brand}.DataFolder=${NAME}`, `-X ${brand}.InstallFolder=${NAME}`,
    `-X ${brand}.UninstallKey=Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${NAME}`,
    `-X ${brand}.MutexName=Local\\${NAME}`, `-X ${brand}.UpdateKey=${publicKey}`, `-X ${brand}.UpdateFile=http://127.0.0.1:${PORT}/latest.json`,
  ].join(" ");
  const build = version => {
    const out = path.join(WORK, version);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(ROOT, "scripts", "build-installer.ps1")}" -Version ${version} -OutDir "${out}" -ExtraFlags "${flags}"`, { cwd: ROOT, stdio: "ignore" });
    return path.join(out, "KIASA-Setup.exe");
  };
  const v900 = build("9.0.0");
  const v901 = build("9.0.1");
  // A release that is properly signed but will not install: an installer with nothing inside it.
  const broken = path.join(WORK, "broken-setup.exe");
  execSync(`go build -ldflags "-X ${brand}.Version=9.0.2 ${flags}" -o "${broken}" ./cmd/setup`, { cwd: ROOT, stdio: "ignore" });
  served.files = { "/9.0.0.exe": v900, "/9.0.1.exe": v901, "/broken.exe": broken };

  const signManifest = (version, urlName, file, { rollback = false } = {}) => {
    const out = path.join(WORK, "latest.json");
    execSync(`"${signer}" -key "${keyFile}" -public "${publicKey}" -version ${version} -url http://127.0.0.1:${PORT}/${urlName} -file "${file}" -out "${out}"${rollback ? " -rollback" : ""}`, { stdio: "ignore" });
    return fs.readFileSync(out, "utf8");
  };

  await new Promise(resolve => site.listen(PORT, "127.0.0.1", resolve));

  // ── The test account's connection, as the Start button makes it.
  const member = createClient(URL_, KEY, { auth: { persistSession: false } });
  const signedIn = await member.auth.signInWithPassword({ email: "ana@example.com", password: ana.password });
  if (signedIn.error) throw signedIn.error;
  await member.from("apply_control").upsert({ user_id: ana.id, mode: "off" }, { onConflict: "user_id" });
  const first = await member.from("browser_agents").select("id").eq("owner", ana.id).order("created_at").limit(1).maybeSingle();
  const agentId = first.data?.id ?? null;

  const versionNow = async () => {
    const r = await member.from("browser_agents").select("version, state, detail, seen_at").eq("owner", ana.id).order("seen_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    return r.data;
  };
  // Starts the browser as the Start button does, and waits for it to say it has opened.
  const start = async wanted => {
    stopBrowser();
    await sleep(800);
    const connected = await member.rpc("browser_agent_connect", { agent_name: "My browser", existing: agentId });
    if (connected.error) throw connected.error;
    const packed = Buffer.from(JSON.stringify({ u: URL_, k: KEY, s: connected.data })).toString("base64url");
    const link = `${SCHEME}://start?code=${encodeURIComponent(`KIASA-APP1.${packed}`)}`;
    const startedAt = new Date();
    spawn(INSTALLED, [link], { detached: true, stdio: "ignore", env: { ...process.env, KIASA_TEST_HEADLESS: "1" } }).unref();
    const deadline = Date.now() + 100000;
    let now = null;
    while (Date.now() < deadline) {
      now = await versionNow();
      if (now && new Date(now.seen_at) >= startedAt && now.version === wanted && now.state === "idle" && !now.detail) return { ok: true, now, seconds: Math.round((Date.now() - startedAt) / 1000) };
      await sleep(1000);
    }
    return { ok: false, now, seconds: 100 };
  };
  const installedVersion = () => ps(`(Get-ItemProperty '${UNINSTALL}' -ErrorAction SilentlyContinue).DisplayVersion`);

  // ── Installing, with no one asked and no shortcuts touched.
  execSync(`"${v900}" -update -no-open`, { stdio: "ignore" });
  check("the installer works with no one asked", fs.existsSync(INSTALLED) && installedVersion() === "9.0.0", installedVersion());

  // ── Nothing to update to.
  let r = await start("9.0.0");
  check(`with no update file it just opens (${r.seconds}s)`, r.ok, r.now);

  // ── Forgeries.
  const good = signManifest("9.0.1", "9.0.1.exe", v901);
  const parsed = JSON.parse(good);
  served.manifest = JSON.stringify({ ...parsed, url: `http://127.0.0.1:${PORT}/broken.exe`, sha256: sha(broken) });
  r = await start("9.0.0");
  check("an update pointed at another file is refused", r.ok && installedVersion() === "9.0.0", r.now);
  check("and it says why", /not signed/.test(readLog("kiasa.log")));
  const forged = { ...parsed, signature: Buffer.alloc(64, 7).toString("base64") };
  served.manifest = JSON.stringify(forged);
  r = await start("9.0.0");
  check("a made-up signature is refused", r.ok && installedVersion() === "9.0.0", r.now);

  // The download swapped after signing.
  served.manifest = good;
  served.files["/9.0.1.exe"] = v900;
  r = await start("9.0.0");
  check("a download that is not what was signed is refused", r.ok && installedVersion() === "9.0.0", r.now);
  check("and it says why", /does not match its signed checksum/.test(readLog("kiasa.log")));
  served.files["/9.0.1.exe"] = v901;

  // ── The real thing.
  const before = sha(INSTALLED);
  r = await start("9.0.1");
  check(`a signed newer version installs and opens by itself (${r.seconds}s)`, r.ok, r.now);
  check("the program was really replaced", sha(INSTALLED) !== before && installedVersion() === "9.0.1", installedVersion());
  check("the install says so in its log", /Updated to 9\.0\.1/.test(readLog("update.log")), readLog("update.log"));
  check("the connection to KIASA carried over", r.ok && r.now.version === "9.0.1");
  check("the link that opens it still works", ps(`(Get-Item 'HKCU:\\Software\\Classes\\${SCHEME}\\shell\\open\\command').GetValue('')`).includes(INSTALLED));

  // ── It does not keep updating.
  const after = fs.statSync(INSTALLED).mtimeMs;
  r = await start("9.0.1");
  check(`pressing Start again changes nothing (${r.seconds}s)`, r.ok && fs.statSync(INSTALLED).mtimeMs === after, r.now);

  // ── Going back.
  served.manifest = signManifest("9.0.0", "9.0.0.exe", v900);
  r = await start("9.0.1");
  check("an old signed file served again cannot take it back", r.ok && installedVersion() === "9.0.1", r.now);
  served.manifest = signManifest("9.0.0", "9.0.0.exe", v900, { rollback: true });
  r = await start("9.0.0");
  check(`a release put back on purpose does (${r.seconds}s)`, r.ok && installedVersion() === "9.0.0", r.now);

  // ── A release that will not install, on a browser that is otherwise fine.
  served.manifest = good;
  r = await start("9.0.1");
  check("forward again", r.ok, r.now);
  served.manifest = signManifest("9.0.2", "broken.exe", broken);
  r = await start("9.0.1");
  check(`a signed release that will not install leaves it working (${r.seconds}s)`, r.ok && installedVersion() === "9.0.1", r.now);
  check("and it says what happened", /Could not update to 9\.0\.2/.test(readLog("update.log")), readLog("update.log"));
  r = await start("9.0.1");
  check(`tried again, it still opens (${r.seconds}s)`, r.ok, r.now);
  const tries = (readLog("update.log").match(/Could not update to 9\.0\.2/g) || []).length;
  r = await start("9.0.1");
  const triesAfter = (readLog("update.log").match(/Could not update to 9\.0\.2/g) || []).length;
  check(`after two tries it stops trying for a while, and opens straight away (${r.seconds}s)`, r.ok && tries === 2 && triesAfter === 2, [tries, triesAfter]);

  // ── The site being down.
  site.close();
  await sleep(300);
  r = await start("9.0.1");
  check(`with the site down it just opens (${r.seconds}s)`, r.ok, r.now);

  // ── Nothing of this touched the real browser.
  tidy();
  const realAfter = {
    version: ps(`(Get-ItemProperty '${REAL_UNINSTALL}' -ErrorAction SilentlyContinue).DisplayVersion`),
    file: ps(`$p = Join-Path $env:LOCALAPPDATA 'Programs\\KIASA\\KIASA.exe'; if (Test-Path $p) { (Get-FileHash $p).Hash }`),
    link: ps(`(Get-Item 'HKCU:\\Software\\Classes\\kiasa-browser\\shell\\open\\command' -ErrorAction SilentlyContinue).GetValue('')`),
  };
  check("the real KIASA Browser is untouched", JSON.stringify(realBefore) === JSON.stringify(realAfter), [realBefore, realAfter]);
  check("and the test install is gone", !fs.existsSync(INSTALLED) && !fs.existsSync(DATA));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => {
  console.error("The test could not run:", String(error.message || error).split("\n").slice(0, 6).join(" | "));
  try { tidy(); } catch { /* It tried. */ }
  process.exit(2);
});
