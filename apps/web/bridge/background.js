// KIASA ChatGPT Bridge: takes a question from a KIASA page to ChatGPT, in a
// ChatGPT tab of its own in the member's signed-in browser (a new chat each
// time), and brings the whole answer back. One question at a time.
const CHATGPT = "https://chatgpt.com/";
// Each question in a new Temporary Chat (Chris's choice): fresh, kept out of
// the member's chat history, and not using or changing ChatGPT's memory.
const NEW_CHAT = CHATGPT + "?temporary-chat=true";
let busy = false;

/** Whether this browser is signed in to ChatGPT, asked as chatgpt.com's own
 * page asks (its session), so no message is used: `signedIn` true with the
 * account's name and email, false, or null when ChatGPT did not say (it may
 * check the browser first). Only for KIASA's page, in this browser. */
async function chatgptStatus() {
  try {
    const response = await fetch(CHATGPT + "api/auth/session", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok || !/json/i.test(response.headers.get("content-type") || "")) return { signedIn: null };
    const session = await response.json();
    const user = session?.user;
    return user ? { signedIn: true, name: String(user.name || ""), email: String(user.email || "") } : { signedIn: false };
  } catch {
    return { signedIn: null };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only the bridge's own part on KIASA's pages asks.
  if (message?.type !== "status" || sender.id !== chrome.runtime.id || !sender.tab) return;
  chatgptStatus().then(respond);
  return true;
});

/** Kept awake while it has work. Chrome stops an extension's background part
 * after about 30 seconds with nothing it counts as activity, and waiting (for
 * ChatGPT, or a slow job page) is not: it would stop mid-question, and KIASA
 * would hear "The bridge stopped". A small call every 20 seconds counts. */
let working = 0, keeper = null;
function hold() {
  if (working++ === 0) keeper = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
}
function release() {
  if (--working > 0) return;
  working = 0;
  clearInterval(keeper);
  keeper = null;
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "kiasa") return;
  let stopped = false;
  let chat = null;
  port.onMessage.addListener(async message => {
    if (message.type === "stop") { stopped = true; chat?.postMessage({ type: "stop" }); return; }
    if (message.type === "read") {
      hold();
      try {
        port.postMessage({ type: "progress", step: "reading" });
        port.postMessage({ type: "answer", answer: await readJob(message.url, () => stopped) });
      } catch (error) {
        try { port.postMessage({ type: "error", error: String(error?.message || error) }); } catch { /* the page went */ }
      } finally {
        release();
      }
      return;
    }
    if (message.type !== "ask") return;
    if (busy) return port.postMessage({ type: "error", error: "The bridge is busy with another question. Wait for it, or stop it first." });
    busy = true;
    hold();
    try {
      const answer = await ask(message.text, progress => { try { port.postMessage({ type: "progress", ...progress }); } catch { /* the page went */ } },
        opened => { chat = opened; }, () => stopped);
      port.postMessage({ type: "answer", answer });
    } catch (error) {
      try { port.postMessage({ type: "error", error: String(error?.message || error) }); } catch { /* the page went */ }
    } finally {
      busy = false;
      release();
    }
  });
});

/** The bridge's own ChatGPT window (small, beside the member's work: a page
 * that can be seen keeps working at full speed), on a new chat each time. Kept
 * in session storage: the worker may restart. */
async function chatgptTab() {
  const { tab: kept } = await chrome.storage.session.get("tab");
  if (typeof kept === "number") {
    try {
      await chrome.tabs.get(kept);
      await chrome.tabs.update(kept, { url: NEW_CHAT });
      return kept;
    } catch { /* closed: a new one */ }
  }
  const opened = await chrome.windows.create({ url: NEW_CHAT, focused: false, type: "normal", width: 560, height: 760 });
  const tab = opened.tabs[0].id;
  await chrome.storage.session.set({ tab });
  return tab;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The tab loaded, and the bridge's part in it answering. */
async function reach(tab) {
  for (let tries = 0; tries < 60; tries++) {
    const info = await chrome.tabs.get(tab).catch(() => null);
    if (!info) throw new Error("The ChatGPT tab was closed.");
    if (info.status === "complete") {
      const ready = await chrome.tabs.sendMessage(tab, { type: "ping" }).catch(() => null);
      if (ready?.ok) return;
    }
    await wait(500);
  }
  throw new Error("ChatGPT did not open. Check that chatgpt.com opens in this browser.");
}

async function ask(text, progress, opened, stopped) {
  progress({ step: "opening" });
  const tab = await chatgptTab();
  await reach(tab);
  if (stopped()) throw new Error("Stopped.");
  return new Promise((resolve, reject) => {
    const chat = chrome.tabs.connect(tab, { name: "ask" });
    opened(chat);
    let done = false;
    // Looks asked for every 1.5 seconds: the worker's timers are not slowed as a hidden page's are.
    const looking = setInterval(() => { try { chat.postMessage({ type: "look" }); } catch { /* gone */ } }, 1500);
    const finish = () => { done = true; clearInterval(looking); };
    chat.onMessage.addListener(message => {
      if (message.type === "progress") progress(message);
      if (message.type === "answer") { finish(); resolve(message.answer); chat.disconnect(); }
      if (message.type === "error") { finish(); reject(new Error(message.error)); chat.disconnect(); }
    });
    chat.onDisconnect.addListener(() => { clearInterval(looking); if (!done) reject(new Error("The ChatGPT tab was closed or reloaded before it answered.")); });
    chat.postMessage({ type: "ask", text });
  });
}

/** A KIASA job's description, read off its page as the member sees it (many
 * hiring sites write it in the browser, where KIASA's server cannot see it):
 * the page opened in a tab beside the bridge's ChatGPT (or a small window of
 * its own), read once it has settled, and closed. `{ text: "" }` when the page
 * has none: often it is only an application form (`form`). */
async function readJob(url, stopped) {
  if (!/^https?:\/\//i.test(url)) throw new Error("That is not a web page.");
  const { tab: chat } = await chrome.storage.session.get("tab");
  const beside = typeof chat === "number" ? await chrome.tabs.get(chat).catch(() => null) : null;
  let own = null, tab;
  if (beside) tab = (await chrome.tabs.create({ windowId: beside.windowId, url, active: false })).id;
  else { own = await chrome.windows.create({ url, focused: false, type: "normal", width: 560, height: 760 }); tab = own.tabs[0].id; }
  try {
    const started = Date.now();
    let best = { text: "", form: false }, last = "", steady = 0;
    while (Date.now() - started < 30000 && !stopped()) {
      await wait(1000);
      const info = await chrome.tabs.get(tab).catch(() => null);
      if (!info) throw new Error("The job's page was closed before it was read.");
      const [run] = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId: tab }, func: readDescription }).catch(() => []),
        wait(8000).then(() => []),
      ]);
      const found = run?.result;
      if (!found) continue;
      best = found;
      if (found.text) {
        // The same for two looks running: the page has settled.
        steady = found.text === last ? steady + 1 : 0;
        last = found.text;
        if (steady >= 2 && info.status === "complete") break;
      } else if (info.status === "complete" && Date.now() - started > 12000) break;
    }
    if (stopped()) throw new Error("Stopped.");
    return best;
  } finally {
    if (own) chrome.windows.remove(own.id).catch(() => {}); else chrome.tabs.remove(tab).catch(() => {});
  }
}

/** Runs in the job's page: its description, as plain text. What the page tells
 * search engines first; else its prose (paragraphs, list items and headings,
 * outside menus, footers and forms, as shown); else its main part. Only text
 * that reads like a job (duties, requirements, …), so a form's fine print is
 * not taken for one. */
function readDescription() {
  const clean = text => (text || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const jobLike = text => text.length >= 300 && /responsib|requirement|qualifications|you will|you'll|you’ll|skills|experience (with|in)|years of|about (the|this) (role|job|position)|what we|duties/i.test(text);
  const fields = document.querySelectorAll("input:not([type=hidden]), textarea, select").length;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const all = [].concat(JSON.parse(script.textContent)).flatMap(entry => entry && entry["@graph"] ? entry["@graph"] : [entry]);
      const job = all.find(entry => entry && /JobPosting/.test(String(entry["@type"])));
      if (job && typeof job.description === "string") {
        // Read as an inert document: nothing in it runs or loads.
        const html = job.description.replace(/<br\s*\/?>|<\/(p|li|h\d|div|ul|ol)>/gi, "$&\n");
        const text = clean(new DOMParser().parseFromString(html, "text/html").body.textContent);
        if (jobLike(text)) return { text: text.slice(0, 30000), form: false };
      }
    } catch { /* not readable: the page itself, then */ }
  }
  const skip = "nav, header, footer, form, aside, button, dialog, [role=navigation], [role=banner], [role=contentinfo], [role=dialog], [aria-hidden=true], script, style, noscript, template";
  const seen = new Set();
  const parts = [];
  for (const element of document.querySelectorAll("h1, h2, h3, h4, h5, p, li, dd")) {
    if (element.closest(skip) || element.querySelector("p, li") || !element.getClientRects().length) continue;
    const text = clean(element.innerText);
    const heading = /^H\d$/.test(element.tagName);
    if (!text || seen.has(text) || (!heading && text.length < 25)) continue;
    seen.add(text);
    parts.push(heading ? `\n${text}` : element.tagName === "LI" ? `• ${text}` : text);
  }
  const prose = clean(parts.join("\n"));
  if (jobLike(prose)) return { text: prose.slice(0, 30000), form: false };
  const main = document.querySelector("main, [role=main], article");
  const whole = main ? clean(main.innerText) : "";
  if (jobLike(whole)) return { text: whole.slice(0, 30000), form: false };
  return { text: "", form: fields >= 3 };
}
