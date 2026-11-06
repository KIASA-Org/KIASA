// Word by word, in a real Notepad, real Chrome boxes and a real LibreOffice. Run as e2e.cjs is.
// Windows come to the front; the test build writes and reads only in windows with the marker in
// their title. Nothing is ever closed by killing it: test windows save and close themselves.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync, spawn } = require("child_process");
const { Desk, memberPage, sleep, until, check, count, chromium, MARKER, ADMIN, ANA, summary } = require("./e2e.cjs");

const only = process.env.DESK_ONLY;
const clipboardNow = () => execSync(`powershell -NoProfile -STA -Command "Get-Clipboard -Raw"`, { encoding: "utf8" });
/** The script the way it should read in a box. */
const form = (script, between) => (script.match(/[^.!?]*[.!?]+|[^.!?]+$/g) ?? []).map(part => part.trim()).filter(Boolean).join(between);
const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
// A real script only grows, so each part of this test carries on from what was said before it.
let spoken = "";
const opening = text => (spoken ? `${spoken.replace(/[.!?]?\s*$/, ".")} ` : "") + text;

async function notepad(desk, member) {
  const file = path.join(os.tmpdir(), `${MARKER}-words-${Date.now()}.txt`);
  fs.writeFileSync(file, "");
  spawn("notepad.exe", [file], { detached: true, stdio: "ignore" }).unref();
  await sleep(1800);
  await desk.ask(`front ${MARKER}-words`);
  // Coming to the front can leave the keyboard in its menu: try again, as a person would click again.
  const ready = await until("box", async () => { await desk.ask(`front ${MARKER}-words`); await sleep(350); return (await desk.state()).target.Writable; }, 6000);
  check("Notepad: ready", !!ready.value, (await desk.state()).target);

  let script = opening("Earlier sentence here. We are");
  const say = text => { script = text; spoken = text; member.say(script); };
  const sayMore = words => say(script + words);
  const reads = async expected => until("reads", async () => (await desk.box()) === expected, 3000);
  // What should be in the box: it starts from the sentence that was being spoken, not before it.
  const wanted = () => form(script.slice(script.lastIndexOf("We are")), "\n");

  say(script);
  await until("cards", async () => (await desk.state()).cards.at(-1)?.Text === "We are", 5000);

  // The button starts it, from the sentence being spoken. Its setting is remembered, so it may be on.
  let pressed = await desk.state();
  if (pressed.wordMode) pressed = await desk.ask("wordbutton");
  pressed = await desk.ask("wordbutton");
  check("the button turns it on", pressed.wordMode === true && pressed.wordsOn === true && pressed.following === true, pressed);
  const started = await reads("We are");
  check("it starts from the sentence being spoken, with nothing before it", !!started.value, await desk.box());

  // The speed, at the pace of speech: each word against when the next one started.
  const delays = [];
  sayMore(" w0");
  await sleep(250);
  for (let i = 1; i <= 12; i++) {
    const before = `w${i - 1}`;
    sayMore(` w${i}`);
    const heard = await until("word", async () => (await desk.box()).endsWith(before), 2000);
    if (!heard.value) { check("each word goes in", false, { before, box: await desk.box() }); break; }
    delays.push(heard.ms);
    await sleep(Math.max(0, 250 - heard.ms));
  }
  if (delays.length) {
    console.log(`      a word to Notepad, once the next has started: median ${median(delays)} ms, worst ${Math.max(...delays)} ms`);
    check("words go in fast (median under 300 ms)", median(delays) < 300, delays);
  }
  const quiet = await until("last word", async () => (await desk.box()) === wanted(), 2000);
  check("a word going quiet goes in by itself", !!quiet.value, { box: await desk.box(), want: wanted() });
  console.log(`      the last word, with nothing after it: ${quiet.ms} ms after the check began`);

  // A word changes after it went in.
  say(script.replace(" w3 ", " CORRECTED "));
  const put = await reads(wanted());
  check("a changed word is put right, ten words back", !!put.value, { box: await desk.box(), want: wanted() });
  console.log(`      a word put right: ${put.ms} ms`);

  // Sentences.
  sayMore(". Next sentence begins here");
  const line = await reads(wanted());
  check("a new sentence takes a new line", !!line.value, { box: await desk.box(), want: wanted() });
  say(script.replace(". Next sentence", " and next sentence"));
  const joined = await reads(wanted());
  check("sentences joined by a correction are put right", !!joined.value, { box: await desk.box(), want: wanted() });

  // A correction far back, as live captions make: about 420 characters taken back and written again.
  const farWords = Array.from({ length: 72 }, (_, i) => `far${String(i).padStart(2, "0")}`);
  sayMore(` ${farWords.join(" ")}`);
  check("a long run goes in", !!(await reads(wanted())).value, { firstDifference: firstDifference(await desk.box(), wanted()) });
  say(script.replace(" far02 ", " FIXED "));
  const farFixed = await until("far", async () => (await desk.box()) === wanted(), 8000);
  check("a word put right 420 characters back, with nothing lost", !!farFixed.value, { firstDifference: firstDifference(await desk.box(), wanted()) });
  console.log(`      a word put right 420 characters back: ${farFixed.ms} ms`);
  sayMore(" and on after it");
  check("writing goes on after it", !!(await until("on", async () => (await desk.box()) === wanted(), 3000)).value, { firstDifference: firstDifference(await desk.box(), wanted()) });

  // A long run with corrections, faster than speech at times: reads exactly like the script.
  const mine = [];
  const base = script;
  for (let i = 0; i < 120; i++) {
    mine.push(`long${i}${i % 9 === 8 ? "." : ""}`);
    if (i % 7 === 3 && i > 10) mine[mine.length - 3] = `${mine[mine.length - 3].replace(".", "")}x${mine[mine.length - 3].endsWith(".") ? "." : ""}`;
    say(`${base} ${mine.join(" ")}`);
    await sleep(i % 10 < 7 ? 140 : 40);
  }
  const run = await reads(wanted());
  const read = await desk.box();
  check("120 words with corrections: reads exactly like the script", !!run.value, { firstDifference: firstDifference(read, wanted()) });

  // The cursor moved: nothing of the person's is touched.
  const whole = await desk.box();
  await desk.ask("totop");
  await sleep(150);
  const lastWord = mine.at(-1);
  say(script.replace(new RegExp(`${lastWord}$`), "changedword"));
  sayMore(" newone");
  await sleep(1300);
  let now = await desk.box();
  check("cursor moved: everything written stays", now.includes(whole), { now: now.slice(0, 200) });
  check("cursor moved: new words go where the cursor is", now.startsWith(" changedword") || now.startsWith("changedword") || now.startsWith(" newone") || now.startsWith("newone"), now.slice(0, 60));
  await desk.ask("toend");
  await sleep(200);

  // Text selected: it waits.
  await desk.ask("selectall");
  await sleep(150);
  const chosen = await desk.box();
  sayMore(" whileselected more");
  const held = await until("held", async () => (await desk.state()).hold === "Selected", 2000);
  check("selected text: the words wait", !!held.value, await desk.state());
  check("selected text: nothing replaced", (await desk.box()) === chosen);
  await desk.ask("toend");
  const freed = await until("freed", async () => (await desk.box()).includes("whileselected"), 2500);
  check("nothing selected: the words go in", !!freed.value);

  // Turned off part way through a sentence: the rest of it comes as a whole sentence.
  const offState = await desk.ask("wordbutton");
  check("the button turns it off, and following goes on", offState.wordMode === false && offState.following === true, offState);
  await until("handed back", async () => !(await desk.state()).wordsOn, 2500);
  const atOff = await desk.box();
  sayMore(" rest of this one. And");
  const whole2 = await until("sentence", async () => (await desk.box()).length > atOff.length, 3500);
  await sleep(300);
  now = await desk.box();
  check("off: the rest of the sentence goes in once", !!whole2.value && now.endsWith("rest of this one.\n") && count(now, "rest of this one.") === 1, now.slice(-120));
  check("off: with a space before it", now.includes(" rest of this one.") || now.includes("more rest of this one."), now.slice(-120));

  // And on again.
  const onAgain = await desk.ask("wordbutton");
  check("on again", onAgain.wordMode === true && onAgain.wordsOn === true, onAgain);
  sayMore(" goes on now");
  const again = await until("again", async () => (await desk.box()).includes("And goes on"), 2500);
  check("on again: carries on, nothing repeated", !!again.value && count(await desk.box(), "rest of this one.") === 1, (await desk.box()).slice(-100));

  // Stop means stop.
  await sleep(400);
  const stopped = await desk.ask("stop");
  check("stop ends it", stopped.following === false && stopped.wordsOn === false, stopped);
  const atStop = await desk.box();
  sayMore(" not written");
  await sleep(900);
  check("stopped: nothing more goes in", (await desk.box()) === atStop);

  // Turned off by the member: the last word still goes in.
  if ((await desk.state()).wordMode) await desk.ask("wordbutton");
  const pressedOnce = await desk.ask("wordbutton");
  check("the button starts it again when nothing is being followed", pressedOnce.wordsOn === true, pressedOnce);
  sayMore(" one last");
  await until("before off", async () => (await desk.box()).includes("one"), 2000);
  sayMore(" finalword");
  // It has to have reached the app first: a page closing takes with it what it had not sent.
  await until("final word here", async () => (await desk.state()).cards.at(-1)?.Text.endsWith("finalword"), 2000);
  await member.off();
  const lastIn = await until("last", async () => (await desk.box()).includes("finalword"), 10000);
  check("turned off: the last word goes in", !!lastIn.value, (await desk.box()).slice(-80));
  const ended = await until("ended", async () => !(await desk.state()).wordsOn, 3000);
  check("turned off: it ends", !!ended.value);

  await desk.ask("save");
  await sleep(400);
  await desk.ask("closetab");
  await sleep(500);
  fs.rmSync(file, { force: true });

  function firstDifference(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return { at: i, got: a.slice(Math.max(0, i - 30), i + 30), want: b.slice(Math.max(0, i - 30), i + 30) };
  }
}

async function chrome(desk, member, headed) {
  const page = await headed.newPage();
  await page.setContent(`<!doctype html><title>${MARKER}-words-chrome</title><body style="font:16px sans-serif;padding:20px">
    <p><textarea id="two" rows="6" cols="90"></textarea></p>
    <div id="three" contenteditable style="border:1px solid #888;min-height:80px;padding:6px"></div></body>`);
  await page.bringToFront();
  await desk.ask(`front ${MARKER}-words-chrome`);
  await sleep(400);

  const inBox = async (selector, read, name) => {
    await page.click(selector);
    await until("writable", async () => (await desk.state()).target.Writable, 2500);
    let script = opening(`Opening words here. ${name} starts`);
    const at = script.lastIndexOf(`${name} starts`);
    const tell = () => { spoken = script; member.say(script); };
    tell();
    await until("card", async () => (await desk.state()).cards.at(-1)?.Text === `${name} starts`, 4000);
    if ((await desk.state()).wordMode) await desk.ask("wordbutton");
    await desk.ask("wordbutton");
    const clean = text => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const reads = async () => until("reads", async () => clean(await read()) === clean(form(script.slice(at), " ")), 3000);
    check(`${name}: words go in`, !!(await reads()).value, await read());
    script += " and on and on";
    tell();
    check(`${name}: more words follow`, !!(await reads()).value, await read());
    script = script.slice(0, at) + script.slice(at).replace(" and on and on", " and on and off");
    tell();
    check(`${name}: a word is put right`, !!(await reads()).value, await read());
    script += ". Second one here";
    tell();
    check(`${name}: a space between sentences, no new line`, !!(await reads()).value && !(await read()).includes("\n"), await read());
    script = script.slice(0, at) + script.slice(at).replace(". Second one", " second one");
    tell();
    check(`${name}: sentences joined are put right`, !!(await reads()).value, await read());
    await sleep(300);
    await desk.ask("stop");
    await sleep(200);
  };
  await inBox("#two", () => page.inputValue("#two"), "Textarea");
  await inBox("#three", () => page.innerText("#three"), "Rich");
  await page.close();
}

async function libreoffice(desk, member) {
  const soffice = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
  const running = execSync(`powershell -NoProfile -Command "(Get-Process soffice.bin -ErrorAction SilentlyContinue).Id"`, { encoding: "utf8" }).trim();
  if (!fs.existsSync(soffice) || running) { console.log(`SKIP  LibreOffice (${running ? "open, left alone" : "not installed"})`); return; }
  const file = path.join(os.tmpdir(), `${MARKER}-lo-${Date.now()}.fodt`);
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.text"><office:body><office:text><text:p/></office:text></office:body></office:document>`);
  spawn(soffice, ["--writer", "--norestore", "--nologo", file], { detached: true, stdio: "ignore" }).unref();
  const up = await until("writer", async () => { await desk.ask(`front ${MARKER}-lo`); const t = (await desk.state()).target; return t.Writable && t.Title.includes(`${MARKER}-lo`) ? t : null; }, 40000);
  check("LibreOffice: ready", !!up.value, (await desk.state()).target);
  if (up.value) {
    let script = opening("Before this one. LibreOffice words");
    spoken = script;
    member.say(script);
    await until("card", async () => (await desk.state()).cards.at(-1)?.Text === "LibreOffice words", 4000);
    if ((await desk.state()).wordMode) await desk.ask("wordbutton");
    await desk.ask("wordbutton");
    for (const more of [" come", " one", " at", " a", " time.", " Then", " another", " line", " begins", " here."]) {
      script += more;
      spoken = script;
      member.say(script);
      await sleep(500);
    }
    script += " Last";
    spoken = script;
    member.say(script);
    await sleep(1200);
    const stopped = await desk.ask("stop");
    check("LibreOffice: stops", stopped.wordsOn === false);
    await sleep(500);
    const before = fs.statSync(file).mtimeMs;
    check("LibreOffice: the test could save", (await desk.ask("save")).ok === true);
    await until("saved", () => fs.statSync(file).mtimeMs !== before, 6000);
    await sleep(300);
    const saved = fs.readFileSync(file, "utf8");
    const paragraphs = [...saved.matchAll(/<text:p[^>]*>(.*?)<\/text:p>/g)].map(match => match[1].replace(/<[^>]+>/g, ""));
    check("LibreOffice: reads right, a line for each sentence", paragraphs.includes("LibreOffice words come one at a time.") && paragraphs.includes("Then another line begins here."), paragraphs.slice(0, 6));
    await desk.ask(`front ${MARKER}-lo`);
    await sleep(300);
    await desk.ask("quitapp");
    await sleep(1500);
  }
  try { fs.rmSync(file, { force: true }); } catch { /* still closing: only an empty test file */ }
}

async function main() {
  const clipboardBefore = clipboardNow();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "desk-data-"));
  const desk = new Desk(data);
  await desk.start();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const headed = only && only !== "chrome" ? null : await chromium.launch({ channel: "chrome", headless: false, args: ["--window-size=1100,640"] });
  let member;
  try {
    await desk.ask(`signin ${ADMIN.email} ${ADMIN.password}`);
    await until("in", async () => (await desk.state()).signedIn, 15000);
    member = await memberPage(browser, ANA);
    member.say("Before anything else");
    spoken = "Before anything else";
    await until("listed", async () => (await desk.state()).people.some(person => person.Id === ANA.id), 8000);
    await desk.ask(`open ${ANA.id}`);
    await until("cards", async () => (await desk.state()).cards.length >= 1, 8000);
    if (!only || only === "chrome") await chrome(desk, member, headed);
    if (!only || only === "libreoffice") await libreoffice(desk, member);
    if (!only || only === "notepad") await notepad(desk, member);
    await sleep(2200);
    const clipboardAfter = clipboardNow();
    // Only sizes and whether it looks like this test's words: what is on it may be private.
    check("the person's clipboard is back as it was", clipboardAfter === clipboardBefore,
      { before: clipboardBefore.length, after: clipboardAfter.length, looksLikeTestWords: /\b(long\d+|w\d+|finalword|LibreOffice words)\b/.test(clipboardAfter) });
  } finally {
    if (member) await member.close().catch(() => {});
    await browser.close().catch(() => {});
    if (headed) await headed.close().catch(() => {});
    await desk.stop();
    fs.rmSync(data, { recursive: true, force: true });
  }
  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(2); });
