// Every kind of place words might go: which take them, in what form, and which never do.
// Run as e2e.cjs is. Windows come to the front for a moment; the test build writes only into
// windows with the marker in their title.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync, spawn } = require("child_process");
const { Desk, memberPage, sleep, until, check, chromium, MARKER, ADMIN, ANA, summary } = require("./e2e.cjs");

const shots = process.env.DESK_SHOTS;
const shot = async (desk, name, extra = {}) => {
  if (!shots) return;
  const bar = await desk.ask("barpos");
  const state = await desk.state();
  const x = extra.x ?? bar.left, y = extra.y ?? bar.top, w = extra.w ?? bar.right - bar.left, h = extra.h ?? bar.bottom - bar.top;
  const file = path.join(shots, `${name}.png`);
  const script = `Add-Type -AssemblyName System.Drawing; $b=New-Object Drawing.Bitmap(${w},${h}); $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${x},${y},0,0,$b.Size); $b.Save('${file}'); $g.Dispose(); $b.Dispose()`;
  execSync(`powershell -NoProfile -Command "${script}"`, { stdio: "ignore" });
  return state;
};

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "desk-data-"));
  const desk = new Desk(data);
  await desk.start();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const headed = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-size=1000,640"] });
  let member;
  try {
    await desk.ask(`signin ${ADMIN.email} ${ADMIN.password}`);
    await until("in", async () => (await desk.state()).signedIn, 15000);
    member = await memberPage(browser, ANA);
    member.say("First sentence here. Second sentence here. Third is going on");
    await until("listed", async () => (await desk.state()).people.some(person => person.Id === ANA.id), 8000);
    await desk.ask(`open ${ANA.id}`);
    await until("cards", async () => (await desk.state()).cards.length === 3, 8000);

    check("the Ctrl+Alt+Space key is the app's", (await desk.state()).hasHotkey === true);
    await shot(desk, "main-window");
    if (process.env.DESK_ONLY === "picture") return;

    // ── Chrome ──────────────────────────────────────────────────────────────────────────────
    if (process.env.DESK_ONLY !== "libreoffice") {
    const page = await headed.newPage();
    await page.setContent(`<!doctype html><title>${MARKER}-chrome</title><body style="font:16px sans-serif;padding:20px">
      <h1>Plain words on a page</h1>
      <p><input id="one" style="width:600px"></p>
      <p><textarea id="two" rows="4" cols="70"></textarea></p>
      <div id="three" contenteditable style="border:1px solid #888;min-height:60px;padding:6px"></div>
      <p><input id="readonly" readonly value="cannot change this" style="width:300px"></p>
      <p><input id="pw" type="password" style="width:300px"> <button id="btn">Button</button></p></body>`);
    await page.bringToFront();
    await desk.ask(`front ${MARKER}-chrome`);
    await sleep(500);

    const inBox = async (selector, read) => {
      await page.click(selector);
      const on = await until("writable", async () => { const t = (await desk.state()).target; return t.Writable ? t : null; }, 2500);
      return on.value;
    };

    let box = await inBox("#one");
    check("Chrome: a one-line box takes words", !!box);
    check("Chrome: a one-line box gets no new lines", box?.NewLines === false);
    const onePlace = box;
    await desk.ask("click 0");
    await until("one", async () => (await page.inputValue("#one")).includes("First sentence"), 3000);
    check("Chrome: the words go in", (await page.inputValue("#one")) === "First sentence here. ", await page.inputValue("#one"));
    await shot(desk, "main-window");

    box = await inBox("#two");
    check("Chrome: a text area takes words", !!box);
    check("Chrome: the icon's place moved with the box", box && (box.X !== onePlace?.X || box.Y !== onePlace?.Y), { box, onePlace });
    await desk.ask("drag 0 1");
    await until("two", async () => (await page.inputValue("#two")).includes("Second sentence"), 3000);
    check("Chrome: cards go in order, with a space between", (await page.inputValue("#two")) === "First sentence here. Second sentence here. ", await page.inputValue("#two"));

    box = await inBox("#three");
    check("Chrome: a rich box takes words", !!box);
    await desk.ask("click 1");
    await until("three", async () => (await page.innerText("#three")).includes("Second sentence"), 3000);
    check("Chrome: the words go in a rich box", (await page.innerText("#three")).trim() === "Second sentence here.", await page.innerText("#three"));

    // Following in a rich box, with the bubble.
    await desk.ask("click 2");
    member.say("First sentence here. Second sentence here. Third is going on and on. Fourth has just begun");
    await until("written", async () => (await page.innerText("#three")).includes("Third is going"), 4000);
    check("Chrome: following writes into a rich box", (await page.innerText("#three")).includes("Third is going on and on."), await page.innerText("#three"));
    check("Chrome: the sentence being spoken is in the bubble", (await desk.state()).bubble.includes("Fourth has just begun"));
    await sleep(120);
    if (shots) {
      const placed = (await desk.state()).target;
      await shot(desk, "icon-in-chrome", { x: Math.max(placed.X - 260, -4000), y: placed.Y - 90, w: 860, h: 190 });
    }
    await desk.ask("stop");

    // ── Places that never take words ────────────────────────────────────────────────────────
    const refuses = async (name, selector, read) => {
      await page.click(selector);
      await sleep(500);
      const state = await desk.state();
      check(`${name}: not a place to write`, state.target.Writable === false, state.target);
      await desk.ask("click 0");
      const held = await until("held", async () => { const s = await desk.state(); return s.hold === "NoBox" && s.waiting > 0 ? s : null; }, 1500);
      check(`${name}: the words wait instead`, !!held.value, await desk.state());
      await sleep(250);
      if (read) check(`${name}: nothing written`, await read() === true);
      await desk.ask("stop");
      await until("cleared", async () => (await desk.state()).waiting === 0, 1500);
    };
    await refuses("Chrome password box", "#pw", async () => (await page.inputValue("#pw")) === "");
    await refuses("Chrome read-only box", "#readonly", async () => (await page.inputValue("#readonly")) === "cannot change this");
    await refuses("Chrome button", "#btn");
    await refuses("Chrome plain page", "h1");
    await page.close();
    }

    // ── LibreOffice, which cannot tell Windows about its cursor or read words back ─────────
    const soffice = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
    const running = execSync(`powershell -NoProfile -Command "(Get-Process soffice.bin -ErrorAction SilentlyContinue).Id"`, { encoding: "utf8" }).trim();
    if (!fs.existsSync(soffice) || running) console.log(`SKIP  LibreOffice (${running ? "open with someone's work, left alone" : "not installed"})`);
    else {
      // Its own flat file format, which saves without asking anything (a .txt asks whether to keep it plain).
      const file = path.join(os.tmpdir(), `${MARKER}-lo-${Date.now()}.fodt`);
      fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.text"><office:body><office:text><text:p/></office:text></office:body></office:document>`);
      spawn(soffice, ["--writer", "--norestore", "--nologo", file], { detached: true, stdio: "ignore" }).unref();
      const up = await until("writer", async () => { await desk.ask(`front ${MARKER}-lo`); const t = (await desk.state()).target; return t.Writable && t.Title.includes(`${MARKER}-lo`) ? t : null; }, 40000);
      check("LibreOffice: known as a place to write", !!up.value, (await desk.state()).target);
      check("LibreOffice: a new line for each sentence", up.value?.NewLines === true);
      if (up.value) {
        const sentences = Array.from({ length: 12 }, (_, i) => `LibreOffice sentence ${i} goes here.`);
        let script = "Opening words here. ";
        member.say(script + "Going on");
        await until("ready", async () => (await desk.state()).cards.at(-1)?.Text === "Going on", 3000);
        await desk.ask(`click ${(await desk.state()).cards.length - 1}`);
        script += "Going on. ";
        for (const sentence of sentences) {
          script += sentence + " ";
          member.say(script + "Next");
          await sleep(500);
        }
        await until("all gone", async () => (await desk.state()).waiting === 0 && (await desk.state()).bubble === "Next", 8000);
        await sleep(600);
        if (shots) {
          const placed = (await desk.state()).target;
          await shot(desk, "icon-in-writer", { x: placed.X - 260, y: placed.Y - 90, w: 860, h: 190 });
        }
        await desk.ask("stop");
        await sleep(700);
        const before = fs.statSync(file).mtimeMs;
        check("LibreOffice: the test could save", (await desk.ask("save")).ok === true);
        await until("saved", () => fs.statSync(file).mtimeMs !== before, 6000);
        await sleep(300);
        const saved = fs.readFileSync(file, "utf8");
        const lost = sentences.filter(sentence => !saved.includes(sentence));
        const doubled = sentences.filter(sentence => saved.split(sentence).length > 2);
        check("LibreOffice: none lost", lost.length === 0, { lost, saved: saved.slice(0, 300) });
        check("LibreOffice: none doubled", doubled.length === 0, doubled);
        const paragraphs = [...saved.matchAll(/<text:p[^>]*>([^<]*)<\/text:p>/g)].map(match => match[1]);
        check("LibreOffice: a line each", sentences.every(sentence => paragraphs.includes(sentence)), paragraphs.slice(0, 6));
      }
      // Saved above, so it closes without asking. Nothing here is ever closed by killing it.
      await desk.ask(`front ${MARKER}-lo`);
      await sleep(300);
      await desk.ask("quitapp");
      await sleep(1500);
      try { fs.rmSync(file, { force: true }); } catch { /* still closing: it is only an empty test file in the temp folder */ }
    }
  } finally {
    if (member) await member.close().catch(() => {});
    await browser.close().catch(() => {});
    await headed.close().catch(() => {});
    await desk.stop();
    fs.rmSync(data, { recursive: true, force: true });
  }
  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(2); });
