// KIASA ChatGPT Bridge, on chatgpt.com (the member's own, signed in): puts
// KIASA's question in the message box (as a paste: ChatGPT turns a long one
// into an attached text), sends it, waits for the whole answer, and gives it
// back. ChatGPT's page changes over time, so each part is looked for in
// several ways, and when one is not found the bridge says which. (ChatGPT's
// page of October 2026 dropped the old markers, data-message-author-role,
// #prompt-textarea and the conversation turns: the new ones come first.)
(() => {
  const FIND = {
    composer: ['form[data-chatgpt-composer] [contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]', "#prompt-textarea", 'div.ProseMirror[contenteditable="true"]', 'form [contenteditable="true"]', 'textarea[name="prompt-textarea"]', "form textarea"],
    send: ['[data-testid="send-button"]', "#composer-submit-button", 'button[aria-label="Send"]', 'button[aria-label="Send prompt"]', 'button[aria-label*="Send" i]', 'button[data-testid*="send" i]', 'form button[type="submit"]'],
    // Only ChatGPT's own Stop (of its answer): not, say, "Stop dictation".
    stop: ['[data-testid="stop-button"]', '#composer-submit-button[aria-label*="Stop" i]', 'button[aria-label="Stop streaming"]', 'button[aria-label="Stop generating"]'],
    // Under a finished answer: its Copy button (shown once ChatGPT is done; not
    // a code block's own "Copy code", there while it is still writing).
    copied: ['button[data-testid="copy-turn-action-button"]', 'button[aria-label="Copy response"]'],
    // Signs it is still writing, besides its Stop button.
    streaming: ['[data-is-streaming="true"]', ".result-streaming", ".result-thinking"],
    answer: ['[data-content-search-unit-key$=":assistant"]', '[data-markdown-text-style="assistant-message"]', '[data-message-author-role="assistant"]', 'div[class*="MarkdownRoot-"]', ".markdown", '[class*="prose"]'],
    signIn: ['[data-testid="login-button"]', 'a[href*="/auth/login"]', 'button[data-testid="welcome-login-button"]'],
  };
  // ChatGPT's own words when its limit is reached ("You've reached our limit of
  // messages per hour", "You've hit your GPT-5 limit", "usage cap"). Looked for
  // only in its notices and in a short answer with no code block: a résumé or a
  // job's description saying "rate limiting" is not one.
  const LIMIT = /you(['’]ve| have) (reached|hit) (our|your|the) (current )?([\w.-]+ )?(usage |message )?(limit|cap)|usage cap|(reached|hit) (the|your|our) (usage|message) limit/i;
  const FAILED = /something went wrong|an error occurred|network error|conversation not found/i;
  const NOTICES = '[role="alert"], [role="status"], [data-testid*="error" i], [class*="text-token-text-error"]';

  const first = list => { for (const selector of list) { try { const found = document.querySelector(selector); if (found) return found; } catch { /* a selector this browser cannot read */ } } return null; };
  const every = list => { for (const selector of list) { try { const found = document.querySelectorAll(selector); if (found.length) return [...found]; } catch { /* as above */ } } return []; };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const usable = button => !!button && !button.disabled && button.getAttribute("aria-disabled") !== "true";

  /** Whether ChatGPT is still writing: its Stop button (a button whose name
   * starts with "Stop", but not "Stop dictation" and the like), or its own
   * signs of streaming. */
  function writing() {
    if (first(FIND.stop) || first(FIND.streaming)) return true;
    for (const button of document.querySelectorAll("button[aria-label]")) {
      const name = button.getAttribute("aria-label") || "";
      if (/^stop\b/i.test(name) && !/dictat|voice|record|shar|listen|aloud|video|camera/i.test(name)) return true;
    }
    return false;
  }

  /** Looks asked for by the bridge's background (every 1.5 seconds while it
   * waits): a page Chrome hides (its window behind others) has its own timers
   * slowed to once a minute, so ChatGPT's finished answer would wait. */
  const lookers = new Set();

  /** Waits for `check` to give something, looking again on every change of the page, each second, and each look the bridge asks for. */
  function until(check, timeout, stopped) {
    return new Promise(resolve => {
      const end = Date.now() + timeout;
      let timer = 0, last = 0;
      const observer = new MutationObserver(() => look(false));
      const look = (asked = true) => {
        if (!asked && Date.now() - last < 300) return false;
        last = Date.now();
        const found = check();
        if (found || Date.now() > end || stopped?.()) {
          observer.disconnect();
          clearTimeout(timer);
          lookers.delete(look);
          resolve(found || null);
          return true;
        }
        return false;
      };
      if (look()) return;
      lookers.add(look);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
      const tick = () => { if (!look()) timer = setTimeout(tick, 1000); };
      timer = setTimeout(tick, 1000);
    });
  }

  /** The question into the message box: pasted (as a person does), else typed in. */
  async function putIn(box, text) {
    box.focus();
    const data = new DataTransfer();
    data.setData("text/plain", text);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    // Taken: it shows as text, or the Send button wakes for an attached text.
    if (await until(() => (box.textContent || box.value || "").length > 20 || usable(first(FIND.send)), 8000)) return;
    if (box.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("insertText", false, text);
    }
  }

  /** Whether an answer is finished: ChatGPT shows its "Copy response" button
   * under it then (in its turn, after it: the question before it has its own). */
  function finished(turn) {
    return !!copyButton(turn);
  }
  /** An answer's "Copy response" button: in its turn, after it. */
  function copyButton(turn) {
    const whole = turn.closest('[data-turn-key], article, [data-testid^="conversation-turn"]') || turn.parentElement?.parentElement || turn;
    for (const selector of FIND.copied) {
      let buttons = [];
      try { buttons = [...whole.querySelectorAll(selector)]; } catch { /* as above */ }
      const found = buttons.find(button => turn.contains(button) || (turn.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (found) return found;
    }
    return null;
  }

  /** The answer as ChatGPT copies it (whole, as written): "Copy response"
   * pressed, its text caught by chatgpt-main.js before the clipboard. None
   * when that does not work within a few seconds: the page is read instead. */
  function copiedAnswer(turn) {
    const button = copyButton(turn);
    if (!button) return Promise.resolve(null);
    return new Promise(resolve => {
      const finish = text => { clearTimeout(timer); window.removeEventListener("message", heard); document.documentElement.removeAttribute("data-kiasa-capture"); resolve(text); };
      const heard = event => {
        if (event.source === window && event.data?.source === "kiasa-bridge-copied" && typeof event.data.text === "string") finish(event.data.text);
      };
      const timer = setTimeout(() => finish(null), 4000);
      window.addEventListener("message", heard);
      // The page marked first (chatgpt-main.js sees it at once), then Copy pressed.
      document.documentElement.setAttribute("data-kiasa-capture", String(Date.now()));
      button.click();
    });
  }

  /** The whole answer: its code block (the JSON), else all its text. */
  function answerOf(turn) {
    const blocks = [...turn.querySelectorAll("pre")].map(block => (block.querySelector("code") || block).textContent || "");
    const longest = blocks.sort((a, b) => b.length - a.length)[0];
    return longest && longest.includes("{") ? "```json\n" + longest.trim() + "\n```" : (turn.innerText || "").trim();
  }

  async function ask(text, progress, stopped) {
    const box = await until(() => first(FIND.composer), 30000, stopped);
    if (!box) {
      if (first(FIND.signIn)) throw new Error("ChatGPT is not signed in in this browser. Sign in at chatgpt.com, then try again.");
      throw new Error("The bridge could not find ChatGPT's message box (ChatGPT's page may have changed: the bridge needs an update).");
    }
    const before = every(FIND.answer).length;
    progress({ step: "pasting" });
    await putIn(box, text);
    // An attached text uploads first: Send wakes when it is ready.
    const send = await until(() => { const button = first(FIND.send); return usable(button) ? button : null; }, 120000, stopped);
    if (stopped()) throw new Error("Stopped.");
    if (!send) throw new Error("ChatGPT's Send button did not become ready (the question may not have gone in).");
    send.click();
    progress({ step: "sent" });

    const started = Date.now();
    let last = "", steadySince = Date.now(), reported = 0;
    const done = await until(() => {
      const turns = every(FIND.answer);
      const turn = turns.length > before ? turns[turns.length - 1] : null;
      const said = turn ? (turn.innerText || "") : "";
      // A short answer with no code block can be ChatGPT saying it cannot (its limit, an error).
      const plain = turn && !turn.querySelector("pre") && said.length < 600;
      // Its limit stops it only when it is not writing: "You've hit your GPT-5
      // limit" can come with ChatGPT answering on with another model. A notice
      // alone counts once no answer has come for ten seconds.
      const quiet = !writing();
      const notice = [...document.querySelectorAll(NOTICES)].map(each => (each.textContent || "").trim()).find(words => words.length < 600 && LIMIT.test(words));
      const limited = quiet && ((plain && LIMIT.test(said)) || (notice && (!turn || plain) && Date.now() - started > 10000));
      if (limited) return { error: `ChatGPT's usage limit is reached (“${(plain && LIMIT.test(said) ? said : notice).trim().slice(0, 160)}”).` };
      if (plain && FAILED.test(said) && said.length < 400) return { error: `ChatGPT answered with an error: “${said.trim().slice(0, 160)}”` };
      if (said !== last) { last = said; steadySince = Date.now(); }
      if (Date.now() - reported > 5000) { reported = Date.now(); progress({ step: "thinking", seconds: Math.round((Date.now() - started) / 1000), chars: said.length }); }
      const busy = !quiet;
      // Finished: its Copy button is there; or (should ChatGPT rename its buttons)
      // not writing, a code block in it (KIASA's prompts ask for one), and no change for eight seconds.
      if (turn && said.trim() && !busy && finished(turn)) return { turn };
      if (turn && !busy && said.trim() && turn.querySelector("pre") && Date.now() - steadySince > 8000) return { turn };
      return null;
    }, 25 * 60 * 1000, stopped);
    if (stopped()) {
      first(FIND.stop)?.click();
      [...document.querySelectorAll("button[aria-label]")].find(button => /^stop (streaming|generating|answer|response)/i.test(button.getAttribute("aria-label") || ""))?.click();
      throw new Error("Stopped.");
    }
    if (!done) throw new Error("ChatGPT did not finish answering within 25 minutes.");
    if (done.error) throw new Error(done.error);
    // As ChatGPT copies it (its page may show a long code block only in part); else as the page shows it.
    const copied = await copiedAnswer(done.turn);
    return copied && copied.includes("{") ? copied : answerOf(done.turn);
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "ping") respond({ ok: true });
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "ask") return;
    let stopped = false;
    port.onMessage.addListener(async message => {
      if (message.type === "stop") { stopped = true; return; }
      if (message.type === "look") { for (const look of [...lookers]) look(); return; }
      if (message.type !== "ask") return;
      // "Still working", while it waits: the bridge stays awake, and KIASA knows.
      const alive = setInterval(() => { try { port.postMessage({ type: "alive" }); } catch { /* gone */ } }, 10000);
      try {
        const answer = await ask(message.text, progress => { try { port.postMessage({ type: "progress", ...progress }); } catch { /* gone */ } }, () => stopped);
        port.postMessage({ type: "answer", answer });
      } catch (error) {
        try { port.postMessage({ type: "error", error: String(error?.message || error) }); } catch { /* gone */ }
      } finally {
        clearInterval(alive);
      }
    });
  });
})();
