"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The KIASA ChatGPT Bridge (a Chrome extension: `bridge/` in this project,
 * downloaded from /jobs/bridge.zip): KIASA's page hands it a question, it
 * asks ChatGPT in the member's own signed-in browser, and hands back the whole
 * answer. Spoken to through window messages, with its part on KIASA's pages. */

/** How the bridge is doing. `retrying`: ChatGPT seemed stuck or its page
 * failed (`why`), so it is asked again in a new chat (try `attempt`). */
export type BridgeProgress = { step: "reading" | "opening" | "pasting" | "sent" | "thinking" | "retrying"; seconds?: number; chars?: number; attempt?: number; why?: string };

/** The bridge's version as downloaded now. Older ones still ask ChatGPT, but
 * cannot read a job's page (1.1.0), nor say whether ChatGPT is signed in (1.2.0),
 * nor tell ChatGPT's error notices (1.4.0: KIASA then finds it stuck later). */
export const BRIDGE_LATEST = "1.4.0";
const newer = (version: string, than: string) => {
  const [a, b] = [version, than].map(each => each.split(".").map(Number));
  for (let n = 0; n < 3; n++) if ((a[n] ?? 0) !== (b[n] ?? 0)) return (a[n] ?? 0) > (b[n] ?? 0);
  return false;
};
/** Whether this bridge can read a job's page. */
export const canRead = (version: string | null) => !!version && !newer("1.1.0", version);
/** Whether this bridge can run Auto mode: from 1.2.1 it stays awake through a
 * long wait (before, Chrome could stop it in the middle of a job). */
export const canRun = (version: string | null) => !!version && !newer("1.2.1", version);
/** Whether a newer bridge can be downloaded. */
export const outdated = (version: string | null) => !!version && newer(BRIDGE_LATEST, version);

const send = (message: Record<string, unknown>) => window.postMessage({ source: "kiasa-page", ...message }, window.location.origin);

/** The bridge's version when it is installed here, else null (asked; it answers at once). */
export function bridgeVersion(timeout = 1500): Promise<string | null> {
  return new Promise(resolve => {
    const heard = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== "kiasa-bridge" || event.data.type !== "hello") return;
      window.removeEventListener("message", heard);
      clearTimeout(timer);
      resolve(String(event.data.version ?? "1"));
    };
    const timer = setTimeout(() => { window.removeEventListener("message", heard); resolve(null); }, timeout);
    window.addEventListener("message", heard);
    send({ type: "hello" });
  });
}

/** ChatGPT taken to be stuck: no new characters of its answer (or none at all, once sent) for this long. */
export const STUCK_MINUTES = 6;
/** No word at all from the bridge for this long (it reports every few seconds while it works): it has stopped. */
const SILENT_MS = 4 * 60_000;
/** One try at its longest: ChatGPT writing on and on. */
const TRY_MS = 20 * 60_000;
/** Tries in all, each in a new chat. */
export const ASK_TRIES = 3;
/** What a new chat can put right: ChatGPT stuck, or its page failing, or its tab lost. */
const WORTH_RETRYING = /seemed stuck|no word from the bridge|answered with an error|showed an error|did not open|message box|send button|closed or reloaded|did not finish|bridge stopped|bridge did not answer|busy with another/i;
/** What it cannot: ChatGPT's limit (waited out by Auto mode), not signed in. */
const NOT_RETRIED = /usage limit|not signed in/i;

/** ChatGPT's whole answer to `text`, asked in a new chat, `signal` stops it.
 * Watched as it goes: when ChatGPT seems stuck (nothing new for
 * STUCK_MINUTES, no word from the bridge for four minutes, or still going
 * after twenty), or its page fails (an error, the tab lost, its message box or
 * Send button missing), it is stopped and asked again in a new chat, up to
 * ASK_TRIES in all. Its limit and signing in are not retried here. */
export async function askChatGPT(text: string, onProgress: (progress: BridgeProgress) => void, signal?: AbortSignal): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= ASK_TRIES; attempt++) {
    if (last) {
      onProgress({ step: "retrying", attempt, why: last.message });
      await pause(5000, signal);
      if (signal?.aborted) throw new Error("Stopped.");
    }
    try {
      return await askOnce(text, onProgress, signal);
    } catch (error) {
      last = error as Error;
      if (signal?.aborted || NOT_RETRIED.test(last.message) || !WORTH_RETRYING.test(last.message)) throw last;
    }
  }
  throw new Error(`${last!.message.replace(/\.$/, "")} (tried ${ASK_TRIES} times, each in a new chat).`);
}

/** One try, watched: stopped (and said why) when ChatGPT seems stuck. */
function askOnce(text: string, onProgress: (progress: BridgeProgress) => void, signal?: AbortSignal): Promise<string> {
  const mine = new AbortController();
  const stopAll = () => mine.abort();
  signal?.addEventListener("abort", stopAll, { once: true });
  const began = Date.now();
  let heard = began, grew = began, sent = false, chars = -1;
  let stuck: string | null = null;
  const watch = window.setInterval(() => {
    const now = Date.now();
    if (now - heard > SILENT_MS) stuck = "No word from the bridge for four minutes: ChatGPT seemed stuck.";
    else if (sent && now - grew > STUCK_MINUTES * 60_000) stuck = chars > 0
      ? `ChatGPT seemed stuck: its answer did not grow for ${STUCK_MINUTES} minutes.`
      : `ChatGPT seemed stuck: no answer ${STUCK_MINUTES} minutes after the question was sent.`;
    else if (now - began > TRY_MS) stuck = "ChatGPT seemed stuck: still not done after 20 minutes.";
    if (stuck) mine.abort();
  }, 5000);
  return talk<string>({ type: "ask", text }, progress => {
    heard = Date.now();
    if (progress.step === "sent") { sent = true; grew = heard; }
    if (progress.step === "thinking" && (progress.chars ?? 0) !== chars) { chars = progress.chars ?? 0; grew = heard; }
    onProgress(progress);
  }, mine.signal)
    .then(answer => String(answer ?? ""))
    .catch(error => { throw stuck && !signal?.aborted ? new Error(stuck) : error; })
    .finally(() => { window.clearInterval(watch); signal?.removeEventListener("abort", stopAll); });
}

/** Waits, or less when `signal` stops it. */
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>(resolve => {
    const done = () => { window.clearTimeout(timer); resolve(); };
    const timer = window.setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** A KIASA job's description, read off its page in the member's own browser
 * (the bridge asks KIASA for the job's link): "" when the page has none, and
 * `form` when it seems to be only an application form. */
export function readJobPage(job: string, onProgress: (progress: BridgeProgress) => void, signal?: AbortSignal): Promise<{ text: string; form: boolean }> {
  return talk<{ text?: unknown; form?: unknown }>({ type: "read", job }, onProgress, signal)
    .then(found => ({ text: typeof found?.text === "string" ? found.text : "", form: !!found?.form }));
}

function talk<T>(question: Record<string, unknown>, onProgress: (progress: BridgeProgress) => void, signal?: AbortSignal): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const heard = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || data?.source !== "kiasa-bridge" || data.id !== id) return;
      if (data.type === "progress") onProgress(data as BridgeProgress);
      if (data.type === "answer") { finish(); resolve(data.answer as T); }
      if (data.type === "error") { finish(); reject(new Error(String(data.error ?? "The bridge failed."))); }
    };
    // Stopped: the bridge says so once ChatGPT has stopped (so the next
    // question is not "busy"); a bridge that says nothing is left after 30 seconds.
    let gone = 0;
    const stop = () => {
      send({ type: "stop", id });
      gone = window.setTimeout(() => { finish(); reject(new Error("Stopped.")); }, 30_000);
    };
    const finish = () => { window.clearTimeout(gone); window.removeEventListener("message", heard); signal?.removeEventListener("abort", stop); };
    window.addEventListener("message", heard);
    signal?.addEventListener("abort", stop);
    send({ ...question, id });
  });
}

/** "ChatGPT is thinking: 1:20" and the like. */
export function progressText(progress: BridgeProgress | null): string {
  if (!progress) return "Asking ChatGPT…";
  if (progress.step === "reading") return "Reading the job's description off its page…";
  if (progress.step === "opening") return "Opening ChatGPT…";
  if (progress.step === "pasting") return "Giving ChatGPT the prompt, the job and your résumé…";
  if (progress.step === "sent") return "Sent. ChatGPT is starting…";
  if (progress.step === "retrying") return `${(progress.why ?? "ChatGPT did not answer.").replace(/\.$/, "")}. Asking again in a new chat (try ${progress.attempt ?? 2} of ${ASK_TRIES})…`;
  const seconds = progress.seconds ?? 0;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return progress.chars ? `ChatGPT is writing (${clock}, ${progress.chars.toLocaleString("en-US")} characters so far)…` : `ChatGPT is thinking (${clock})…`;
}

/** How KIASA and ChatGPT are connected in this browser: no bridge; a bridge
 * too old to read job pages (`old`) or to say (`outdated`); ChatGPT signed
 * in (with whose account), signed out, or `unknown` (ChatGPT did not say). */
export type BridgeStatus =
  | { state: "missing" }
  | { state: "old" | "outdated" | "unknown" | "signed-out"; version: string }
  | { state: "connected"; version: string; name: string; email: string };

export async function bridgeStatus(): Promise<BridgeStatus> {
  const version = await bridgeVersion();
  if (!version) return { state: "missing" };
  if (!canRead(version)) return { state: "old", version };
  if (outdated(version)) return { state: "outdated", version };
  const said = await Promise.race([
    talk<{ signedIn?: unknown; name?: unknown; email?: unknown }>({ type: "status" }, () => {}).catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 10000)),
  ]);
  if (said?.signedIn === true) return { state: "connected", version, name: String(said.name ?? ""), email: String(said.email ?? "") };
  return { state: said?.signedIn === false ? "signed-out" : "unknown", version };
}

/** The bridge's status, asked when the page opens and again each time the
 * member comes back to it (say, from signing in to ChatGPT). `check` asks now. */
export function useBridgeStatus(): { status: BridgeStatus | null; check: () => void } {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  // Only the latest asking's answer is shown, and none once the page has gone.
  const asked = useRef(0);
  const gone = useRef(false);
  const check = useCallback(() => {
    const mine = ++asked.current;
    void bridgeStatus().then(found => { if (asked.current === mine && !gone.current) setStatus(found); });
  }, []);
  useEffect(() => {
    gone.current = false;
    check();
    const back = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", back);
    return () => { gone.current = true; document.removeEventListener("visibilitychange", back); };
  }, [check]);
  return { status, check };
}
