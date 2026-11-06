// KIASA Live Desk from end to end, on this computer: the local Supabase copy, a local site, the
// member's real page (with a stand-in for the capture app), and the app's test build typing into
// a real Notepad. Made-up accounts only; it refuses anything but the local copy.
//
//   next dev -p 3004 -H 127.0.0.1 with the local Supabase's keys in its environment
//   dotnet build apps/live-desk/KiasaLiveDesk.csproj -c Debug -p:DefineConstants=DESK_TEST -o bin/test
//   node apps/live-desk/tests/e2e.cjs
//
// The app's test build only ever types into a window with the marker in its title. Notepad comes
// to the front while this runs, and the mouse makes a few real clicks, then goes back.
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const { execSync, spawn } = require("child_process");

const WEB = path.resolve(__dirname, "../../web");
const { chromium } = require(path.join(WEB, "node_modules/playwright"));

const BASE = process.env.DESK_SITE || "http://127.0.0.1:3004";
// The member's page: a built site, as `next dev` can keep reloading a page while a test uses it.
const MEMBER = process.env.DESK_MEMBER_SITE || "http://127.0.0.1:3002";
if (![BASE, MEMBER].every(site => /^http:\/\/127\.0\.0\.1:/.test(site))) throw new Error("Refusing: this is only for a site on this computer");
const EXE = path.resolve(__dirname, "../bin/test/KiasaLiveDesk.exe");
// New for every run: a tab left open by an earlier test must never count as this test's window.
const MARKER = `kiasa-desk-test-${Date.now().toString(36)}`;
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const ADMIN = { email: "chrislim@kiasa.tech", ...people["chrislim@kiasa.tech"] };
// A member of these tests' own: others share Ana, Ben, Dia and Eli, and two people writing one script
// mix their words on its channel.
const memberFile = path.join(os.tmpdir(), "kiasa-desk-member.json");
if (!fs.existsSync(memberFile)) execSync(`node "${path.join(__dirname, "make-member.cjs")}"`, { stdio: "ignore" });
const ANA = JSON.parse(fs.readFileSync(memberFile, "utf8"));
const sql = text => execSync(`docker exec -i supabase_db_web psql -U postgres -tA`, { input: text, encoding: "utf8" }).trim();

const only = process.argv[2];   // one part by name, or all of them
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`); }
};
const until = async (what, test, ms = 8000) => {
  const start = Date.now();
  for (;;) {
    const value = await test();
    if (value) return { value, ms: Date.now() - start };
    if (Date.now() - start > ms) return { value: null, ms: Date.now() - start };
    await sleep(15);
  }
};

class Desk {
  constructor(data) { this.data = data; }
  async start() {
    // The real app writes into whatever is in front, and a test's window is in front: its words would
    // go there and be lost (it happened, 2026-11-05). So never while it is open.
    const real = execSync(`powershell -NoProfile -Command "(Get-Process 'KIASA Live Desk' -ErrorAction SilentlyContinue).Id"`, { encoding: "utf8" }).trim();
    if (real) throw new Error("Refusing: KIASA Live Desk is open. Close it first: its words would go into this test's windows.");
    this.process = spawn(EXE, [], { env: { ...process.env, KIASA_DESK_SITE: BASE, KIASA_DESK_DATA: this.data, KIASA_DESK_ONLY_INTO: MARKER }, detached: false, stdio: "ignore" });
    const started = Date.now();
    for (;;) {
      try {
        this.socket = await new Promise((resolve, reject) => {
          const socket = net.connect("\\\\.\\pipe\\kiasa-desk-test", () => resolve(socket));
          socket.on("error", reject);
        });
        break;
      } catch (error) {
        if (Date.now() - started > 20000) throw error;
        await sleep(100);
      }
    }
    this.buffer = "";
    this.waiting = [];
    this.socket.on("data", chunk => {
      this.buffer += chunk.toString("utf8");
      let at;
      while ((at = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        this.waiting.shift()?.(JSON.parse(line));
      }
    });
    this.socket.on("error", () => {});
  }
  ask(line) {
    return new Promise(resolve => {
      this.waiting.push(resolve);
      this.socket.write(line + "\n");
    });
  }
  state() { return this.ask("state"); }
  async box() { return (await this.ask("boxtext")).text.replace(/\r\n?/g, "\n"); }
  async stop() {
    try { this.socket.write("close\n"); } catch { /* gone */ }
    await sleep(400);
    try { this.process.kill(); } catch { /* gone */ }
    await sleep(300);
  }
}

/** The member: their real page, with a stand-in for the capture app. */
async function memberPage(browser, who) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let app = null;
  await page.routeWebSocket(/127\.0\.0\.1:87\d\d/, socket => {
    app = socket;
    socket.send(JSON.stringify({ type: "hello", sources: ["kiasa", "system"] }));
    socket.send(JSON.stringify({ type: "state", state: "ready" }));
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.action === "start") socket.send(JSON.stringify({ type: "state", state: "listening", source: message.source }));
      if (message.action === "stop") socket.send(JSON.stringify({ type: "state", state: "ready" }));
    });
  });
  await page.goto(`${MEMBER}/sign-in`, { timeout: 120000 });
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes("sign-in"), { timeout: 60000 });
  await page.goto(`${MEMBER}/interview`, { timeout: 120000 });
  await page.getByRole("button", { name: "Turn on live script" }).click();
  const on = await until("capture on", () => app, 15000);
  if (!on.value) throw new Error("the page did not connect to the stand-in app");
  await page.waitForTimeout(800);
  return {
    page,
    say: text => app.send(JSON.stringify({ type: "text", text })),
    off: () => page.getByRole("button", { name: "Turn off live script" }).click(),
    close: () => context.close(),
  };
}

const count = (haystack, needle) => haystack.split(needle).length - 1;

const clipboardNow = () => execSync(`powershell -NoProfile -STA -Command "Get-Clipboard -Raw"`, { encoding: "utf8" });

async function main() {
  const clipboardBefore = clipboardNow();
  const notepadFile = path.join(os.tmpdir(), `${MARKER}-${Date.now()}.txt`);
  fs.writeFileSync(notepadFile, "");
  spawn("notepad.exe", [notepadFile], { detached: true, stdio: "ignore" }).unref();
  await sleep(1800);

  const data = fs.mkdtempSync(path.join(os.tmpdir(), "desk-data-"));
  const desk = new Desk(data);
  await desk.start();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let member;
  try {
    // ── Signing in ──────────────────────────────────────────────────────────────────────────
    await desk.ask(`signin ${ADMIN.email} wrong-password`);
    const refused = await until("refused", async () => { const s = await desk.state(); return s.said ? s : null; }, 15000);
    check("a wrong password is refused", refused.value && !refused.value.signedIn && /do not match/.test(refused.value.said), refused.value);

    await desk.ask(`signin ${ANA.email} ${ANA.password}`);
    const member403 = await until("member refused", async () => { const s = await desk.state(); return /admins/.test(s.said) ? s : null; }, 15000);
    check("a member cannot use it", member403.value && !member403.value.signedIn, member403.value);

    await desk.ask(`signin ${ADMIN.email} ${ADMIN.password}`);
    const signedIn = await until("signed in", async () => (await desk.state()).signedIn, 15000);
    check("an admin signs in", !!signedIn.value);
    const stored = fs.readdirSync(data).map(name => fs.readFileSync(path.join(data, name)).toString("latin1")).join("");
    check("nothing readable is kept on disk", !stored.includes("refresh") && !stored.includes(ADMIN.email), "plain text found");

    // ── The list and the words ──────────────────────────────────────────────────────────────
    member = await memberPage(browser, ANA);
    const listed = await until("Ana listed", async () => (await desk.state()).people.find(person => person.Id === ANA.id), 8000);
    check("whoever is live is listed, by name", listed.value?.Name?.length > 0 && listed.value.Name !== "A KIASA member", listed.value);

    member.say("First sentence here. Second sentence here. Third one is");
    await desk.ask(`open ${ANA.id}`);
    const opened = await until("cards", async () => { const s = await desk.state(); return s.cards.length === 3 ? s : null; }, 10000);
    check("the script opens, a card per sentence", opened.value?.cards.map(card => card.Text).join("|") === "First sentence here.|Second sentence here.|Third one is", opened.value?.cards);
    check("the last card is the live one", opened.value?.cards[2].Live === true && opened.value?.cards[0].Live === false);
    console.log(`      opened in ${opened.ms} ms`);

    // How quickly a new word reaches the app, over the real channel.
    const delays = [];
    let growing = "First sentence here. Second sentence here. Third one is";
    for (let i = 0; i < 12; i++) {
      growing += ` w${i}`;
      member.say(growing);
      const heard = await until("word", async () => (await desk.state()).cards[2]?.Text.endsWith(`w${i}`), 3000);
      if (!heard.value) { check("each word arrives", false, i); break; }
      delays.push(heard.ms);
      await sleep(120);
    }
    if (delays.length) {
      const sorted = [...delays].sort((a, b) => a - b);
      console.log(`      word to the app: median ${sorted[sorted.length >> 1]} ms, worst ${sorted[sorted.length - 1]} ms`);
      check("words arrive quickly (median under 400 ms)", sorted[sorted.length >> 1] < 400, sorted);
    }

    // ── Where words go ──────────────────────────────────────────────────────────────────────
    await desk.ask(`front ${MARKER}`);
    const onBox = await until("Notepad is the place", async () => { const s = await desk.state(); return s.target.Writable ? s : null; }, 3000);
    check("Notepad counts as a box", !!onBox.value, (await desk.state()).target);
    check("in a document, each sentence takes a new line", onBox.value?.target.NewLines === true);
    const shown = await until("icon", async () => (await desk.state()).iconVisible, 1000);
    check("the icon shows beside the cursor", !!shown.value);

    await desk.ask("click 0");
    const wrote = await until("typed", async () => (await desk.box()).includes("First sentence here."), 3000);
    check("clicking a card writes it where the cursor is", !!wrote.value, await desk.box());
    console.log(`      click to words in Notepad: ${wrote.ms} ms`);
    check("the keyboard stayed in Notepad", (await desk.ask("fg")).title.includes(MARKER));

    await desk.ask("click 1 ctrl");
    await until("second", async () => (await desk.box()).endsWith("Second sentence here.\n"), 3000);
    let text = await desk.box();
    check("Ctrl adds only the new card", count(text, "First sentence here.") === 1 && count(text, "Second sentence here.") === 1, { text, state: await desk.state() });
    check("each on its own line", text.startsWith("First sentence here.\nSecond sentence here.\n"), text);

    await desk.ask("drag 0 1");
    await until("drag", async () => (await desk.box()).endsWith("First sentence here.\nSecond sentence here.\n"), 3000);
    text = await desk.box();
    check("dragging writes the cards in order", text.endsWith("First sentence here.\nSecond sentence here.\n"), text);

    // ── Following ───────────────────────────────────────────────────────────────────────────
    await until("all in", async () => (await desk.state()).waiting === 0, 3000);
    await sleep(150);
    const before = await desk.box();
    await desk.ask("click 2");
    const following = await desk.state();
    check("picking the live sentence follows it", following.following === true);
    check("its open words are not written yet", (await desk.box()) === before, await desk.box());
    growing += " still talking";
    member.say(growing);
    const bubble = await until("bubble", async () => (await desk.state()).bubble.includes("still talking"), 3000);
    check("the bubble shows the words as they come", !!bubble.value);
    console.log(`      word to the bubble: ${bubble.ms} ms`);

    growing += " about this. Now the next sentence starts";
    member.say(growing);
    const settled = await until("settled", async () => (await desk.box()).includes("still talking about this."), 4000);
    check("a finished sentence goes in by itself", !!settled.value, await desk.box());
    console.log(`      finished sentence to Notepad: ${settled.ms} ms (it waits to settle)`);
    check("the sentence being spoken stays in the bubble", !(await desk.box()).includes("Now the next") && (await desk.state()).bubble.includes("Now the next"), await desk.state());

    // A correction that joins what was written with what follows: nothing twice, nothing lost.
    growing = growing.replace("about this. Now the next", "about this now the next") + " right here. Then more";
    member.say(growing);
    const joined = await until("joined", async () => (await desk.box()).includes("right here."), 4000);
    text = await desk.box();
    check("a correction across the place loses nothing", !!joined.value && text.includes("now the next sentence starts right here."), text);
    check("a correction across the place repeats nothing", count(text, "about this") === 1, text);

    // By hand.
    await desk.ask("hotkey");
    const flushed = await until("flush", async () => (await desk.box()).includes("Then more"), 3000);
    check("the key writes the bubble's words now", !!flushed.value, await desk.box());
    check("the bubble is empty after that", (await desk.state()).bubble === "");

    // ── Never over the person's work ────────────────────────────────────────────────────────
    await until("flush done", async () => (await desk.box()).endsWith("\n") && (await desk.state()).waiting === 0, 2000);
    await sleep(200);
    await desk.ask("selectall");
    await until("selected", async () => (await desk.state()).target.Writable, 500);
    const whole = await desk.box();
    growing += " and now a sentence with text selected. Next again";
    member.say(growing);
    const held = await until("held", async () => { const s = await desk.state(); return s.hold === "Selected" ? s : null; }, 4000);
    check("selected text is never typed over", !!held.value && (await desk.box()) === whole, await desk.state());
    await desk.ask("toend");
    const released = await until("released", async () => (await desk.box()).includes("with text selected."), 3000);
    check("the words go in once nothing is selected", !!released.value, { state: await desk.state(), end: (await desk.box()).slice(-120) });
    text = await desk.box();
    check("everything is still there", text.startsWith(whole.trimEnd()), text.slice(0, 80));

    // ── The same words again must go in again ─────────────────────────────────────────────
    await desk.ask("stop");
    await until("idle", async () => (await desk.state()).waiting === 0, 3000);
    await sleep(200);
    const once = count(await desk.box(), "First sentence here.");
    await desk.ask("click 0");
    await until("again", async () => count(await desk.box(), "First sentence here.") === once + 1, 3000);
    await desk.ask("click 0");
    const twiceMore = await until("again", async () => count(await desk.box(), "First sentence here.") === once + 2, 3000);
    check("the same card clicked twice goes in twice", !!twiceMore.value, count(await desk.box(), "First sentence here.") - once);
    await sleep(800);
    check("and no more than twice", count(await desk.box(), "First sentence here.") === once + 2, count(await desk.box(), "First sentence here.") - once);

    // ── A real mouse ────────────────────────────────────────────────────────────────────────
    const stopAsk = await desk.ask("stop");
    check("Stop ends the following", stopAsk.following === false);
    const beforeClick = await desk.box();
    const cardsNow = (await desk.state()).cards;
    const aim = cardsNow.length - 2;
    const place = await desk.ask(`cardpos ${aim}`);
    if (place.found) {
      await desk.ask(`realclick ${Math.round(place.x)} ${Math.round(place.y)}`);
      const clicked = await until("real click", async () => (await desk.box()).length > beforeClick.length, 3000);
      check("a real click on a card writes it", !!clicked.value, await desk.box());
      check("a real click leaves the keyboard in Notepad", (await desk.ask("fg")).title.includes(MARKER), (await desk.ask("fg")).title);
    } else check("the first card is on screen to click", false, place);
    const bar = await desk.ask("barpos");
    await desk.ask(`realdrag ${Math.round(bar.x)} ${Math.round(bar.y)} ${Math.round(bar.x) + 40} ${Math.round(bar.y) + 30}`);
    await sleep(150);
    const moved = await desk.ask("barpos");
    check("the window moves by its top bar", moved.left === bar.left + 40 && moved.top === bar.top + 30, { bar, moved });
    check("moving it leaves the keyboard in Notepad", (await desk.ask("fg")).title.includes(MARKER));

    // ── A long run, at the pace of speech and faster, with the clipboard busy: none lost ─────
    await desk.ask("stop");
    const runStart = (await desk.state()).cards.length - 1;
    let run = "First sentence here. Second sentence here. Third one is w0.";
    const words = [];
    for (let i = 0; i < 40; i++) words.push(`Run sentence number ${i} is here.`);
    member.say(run + " Starting now");
    await until("run ready", async () => (await desk.state()).cards.at(-1)?.Text === "Starting now", 3000);
    await desk.ask(`click ${(await desk.state()).cards.length - 1}`);
    for (let i = 0; i < words.length; i++) {
      run += (i ? " " : " Starting now. ") + words[i];
      member.say(run + " Next");
      await sleep(i < 20 ? 700 : 150);
    }
    member.say(run + ". And the end");
    await until("run done", async () => (await desk.box()).includes("Run sentence number 39 is here."), 8000);
    await sleep(300);
    text = await desk.box();
    const lost = words.filter(sentence => !text.includes(sentence));
    const doubled = words.filter(sentence => count(text, sentence) > 1);
    check("forty sentences in a row: none lost", lost.length === 0, { lost: lost.length, front: (await desk.ask("fg")).title, state: (await desk.state()).target, hold: (await desk.state()).hold });
    check("forty sentences in a row: none doubled", doubled.length === 0, doubled);
    check("in order", words.every((sentence, i) => !i || text.indexOf(words[i - 1]) < text.indexOf(sentence)));
    await desk.ask("stop");

    // ── A long script: the newest first, then the older words above them ────────────────────
    const lots = Array.from({ length: 3000 }, (_, i) => `Sentence number ${i} of the long script.`).join(" ");
    member.say(lots);
    const longDone = await until("long", async () => { const s = await desk.state(); return s.cards.length === 3000 ? s : null; }, 20000);
    check("a long script arrives whole", !!longDone.value, (await desk.state()).cards.length);
    check("in the right order", longDone.value?.cards[0].Text === "Sentence number 0 of the long script." && longDone.value?.cards[2999].Text === "Sentence number 2999 of the long script.");
    console.log(`      3000 sentences in ${longDone.ms} ms`);
    member.say(lots + " One more word");
    const afterLong = await until("word after long", async () => (await desk.state()).cards[3000]?.Text === "One more word", 3000);
    check("still quick at that length", !!afterLong.value);
    console.log(`      a word at 3000 sentences: ${afterLong.ms} ms`);

    // ── Turned off while following ──────────────────────────────────────────────────────────
    await desk.ask("click 3000");
    check("following again", (await desk.state()).following === true);
    member.say(lots + " One more word and the last words");
    await until("last words", async () => (await desk.state()).bubble.includes("the last words"), 3000);
    await member.off();
    const ended = await until("off", async () => { const s = await desk.state(); return !s.following ? s : null; }, 8000);
    check("turned off: following ends", !!ended.value);
    const lastIn = await until("last in", async () => (await desk.box()).includes("the last words"), 3000);
    check("turned off: the last words still go in", !!lastIn.value);
    const offStatus = await until("status", async () => /turned their live script off/.test((await desk.state()).status), 8000);
    check("turned off: the app says so", !!offStatus.value, (await desk.state()).status);
    await sleep(700);
    const clipboardAfter = clipboardNow();
    // Only sizes and whether it looks like this test's words: what is on it may be private.
    check("the person's clipboard is back as it was", clipboardAfter === clipboardBefore,
      { before: clipboardBefore.length, after: clipboardAfter.length, looksLikeTestWords: /sentence|Sentence number|\bw\d+\b/.test(clipboardAfter) });
  } finally {
    if (member) await member.close().catch(() => {});
    await browser.close().catch(() => {});
    // Saved and closed as a person would, and only with this test's window in front. Nothing here is
    // ever closed by killing it: that once closed every terminal on the computer (2026-11-04).
    await desk.ask(`front ${MARKER}`);
    await sleep(300);
    await desk.ask("save");
    await desk.ask("closetab");
    await sleep(500);
    await desk.stop();
    fs.rmSync(notepadFile, { force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
if (require.main === module) main().catch(error => { console.error(error); process.exit(2); });
module.exports = { Desk, memberPage, sleep, until, check, count, chromium, BASE, MARKER, ADMIN, ANA, sql, summary: () => ({ passed, failed }) };
