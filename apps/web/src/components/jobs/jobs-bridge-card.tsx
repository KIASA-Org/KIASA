"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download } from "../site/icons";
import { askChatGPT, BRIDGE_LATEST, progressText, useBridgeStatus, type BridgeProgress, type BridgeStatus } from "./jobs-bridge";

const TEST = 'This is a connection test from KIASA. Reply with only this, in a json code block: {"ok": true}';

/** How KIASA and ChatGPT are connected in this browser, in a line: a dot
 * (green when ready), what it means, and what to do about it. `onSetUp` opens
 * the bridge's install or update steps, where they are not already shown. */
export function BridgeStatusLine({ status, check, onSetUp }: { status: BridgeStatus | null; check: () => void; onSetUp?: () => void }) {
  const again = <button type="button" className="jobs-link" onClick={check}>Check again</button>;
  const setUp = (label: string) => onSetUp && <button type="button" className="jobs-link" onClick={onSetUp}>{label}</button>;
  const line = (state: string, children: ReactNode) =>
    <p className="bridge-status" data-state={state} role="status"><span className="bridge-status-dot" aria-hidden="true" /><span>{children}</span></p>;
  if (!status) return line("checking", "Checking the connection to ChatGPT…");
  switch (status.state) {
    case "connected": return line("ok", <>
      <b>Connected to ChatGPT</b>{status.name || status.email ? <> as {status.name || status.email}{status.name && status.email ? <span className="bridge-status-soft"> ({status.email})</span> : null}</> : null}
    </>);
    case "signed-out": return line("warn", <>
      <b>Bridge installed, but ChatGPT is not signed in</b> in this browser. <a className="jobs-link" href="https://chatgpt.com/auth/login" target="_blank" rel="noopener noreferrer">Sign in to ChatGPT</a>, then come back. {again}
    </>);
    case "unknown": return line("warn", <>
      <b>Bridge installed</b> (version {status.version}), but ChatGPT did not say whether you are signed in. Open <a className="jobs-link" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">chatgpt.com</a> once, then {again}
    </>);
    case "outdated": return line("warn", <>
      <b>Bridge out of date</b> (version {status.version}): update it to {BRIDGE_LATEST}, which brings ChatGPT's answers back as soon as they are finished. {setUp("Update it")}
    </>);
    case "old": return line("warn", <>
      <b>Bridge out of date</b> (version {status.version}): update it to {BRIDGE_LATEST} for Auto mode and reading job descriptions. {setUp("Update it")}
    </>);
    default: return line("off", <>
      <b>ChatGPT bridge not installed</b> in this browser: KIASA cannot ask ChatGPT for you. {setUp("Install it")}
    </>);
  }
}

/** The KIASA ChatGPT Bridge: how it is connected, how to install or update
 * it, and a test (a one-line question to ChatGPT) to see it work. */
export function BridgeCard({ titled = true }: { titled?: boolean }) {
  const { status, check } = useBridgeStatus();
  const [testing, setTesting] = useState<BridgeProgress | null | "asking">(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const installed = !!status && status.state !== "missing";
  const stale = status?.state === "outdated" || status?.state === "old";
  const test = async () => {
    setResult(null);
    setTesting("asking");
    try {
      const answer = await askChatGPT(TEST, progress => setTesting(progress));
      setResult(/"ok"\s*:\s*true/.test(answer) ? { ok: true, text: "It works: ChatGPT answered, and KIASA read its answer." } : { ok: false, text: `ChatGPT answered, but not as asked: “${answer.slice(0, 160)}”` });
    } catch (error) {
      setResult({ ok: false, text: (error as Error).message });
    }
    setTesting(null);
    check();
  };

  return <div className="bridge-card">
    {titled && <p className="resume-folder-title">ChatGPT bridge</p>}
    <BridgeStatusLine status={status} check={check} />
    <p className="jobs-form-hint">With the KIASA ChatGPT Bridge, KIASA asks ChatGPT for you, in your own signed-in ChatGPT in this browser: <b>Ask ChatGPT for me</b> in each job&apos;s Tailor résumé, and <b>Auto mode</b> on Today, which makes a résumé for every job of the day, one after another. When KIASA has no description for a job, the bridge reads it off the job&apos;s page, as you would see it.</p>
    {status?.state === "missing" && <ol className="resume-steps">
      <li><a className="jobs-button" data-primary="" href="/jobs/bridge.zip" download><Download /> Download the bridge</a></li>
      <li>Unzip it (right-click the file, <b>Extract All</b>).</li>
      <li>In Chrome, open <b>chrome://extensions</b>, turn on <b>Developer mode</b> (top right), press <b>Load unpacked</b> and choose the <b>kiasa-chatgpt-bridge</b> folder. Chrome says it can read all websites: it opens only the pages of jobs on KIASA&apos;s list, to read their descriptions.</li>
      <li>Make sure you are signed in at <b>chatgpt.com</b> in this Chrome.</li>
      <li>Reload this page (F5), or <button type="button" className="jobs-link" onClick={check}>check again</button>.</li>
    </ol>}
    {stale && <div className="bridge-update">
      <p className="auto-note"><b>To update to version {BRIDGE_LATEST}:</b></p>
      <ol className="resume-steps">
        <li><a className="jobs-button" data-primary="" href="/jobs/bridge.zip" download><Download /> Download the bridge</a></li>
        <li>Unzip it over your old <b>kiasa-chatgpt-bridge</b> folder (replace the files).</li>
        <li>In <b>chrome://extensions</b>, press the reload arrow ↻ on <b>KIASA ChatGPT Bridge</b>.</li>
        <li>Reload this page (F5), or <button type="button" className="jobs-link" onClick={check}>check again</button>.</li>
      </ol>
    </div>}
    {installed && <div className="resume-folder-row">
      <button type="button" className="chat-pill" disabled={testing !== null} onClick={() => void test()}>{testing ? "Testing…" : "Test the bridge"}</button>
      {testing ? <span className="jobs-hint" role="status">{progressText(testing === "asking" ? null : testing)}</span>
        : <span className="jobs-hint">Sends ChatGPT a one-line question (one message), to see the whole way work.</span>}
    </div>}
    {result && <p className={result.ok ? "resume-path-kept" : "b-form-error"} role="status">{result.ok && <Check />}{result.text}</p>}
    {installed && <p className="jobs-hint">It opens ChatGPT in a small window of its own: leave it open while KIASA works. ChatGPT&apos;s own message limits still apply, and OpenAI&apos;s terms do not allow automated use of ChatGPT, so use it at your own risk to your ChatGPT account.</p>}
  </div>;
}

/** When Auto mode or "Ask ChatGPT for me" needs the bridge and it is not here. */
export function BridgeDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const box = dialog.current; if (box && !box.open) box.showModal(); }, []);
  return <dialog ref={dialog} className="chat-dialog jobs-dialog resume-dialog" data-wide="" aria-label="The ChatGPT bridge" onClose={onClose}>
    <p className="chat-dialog-title">The ChatGPT bridge</p>
    <BridgeCard titled={false} />
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose}>Close</button>
    </div>
  </dialog>;
}
