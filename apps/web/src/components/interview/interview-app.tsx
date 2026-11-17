"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown } from "../site/icons";
import { OPEN_APP, useLiveCapture } from "./live-capture";

/** The Interview page's live script (admins only): Windows Live Captions, read by a
 * small helper on the PC (apps/live-script), a button that turns the script
 * on and off, and the words as they come. The capture itself lives in the
 * LiveCaptureProvider (root layout), so it keeps running as the member moves around KIASA. */
export function InterviewApp() {
  const { phase, detail, problem, missing, hasText, on, outdated, turnOn, turnOff, dismissSetup, attachBox, scriptText } = useLiveCapture();
  const [copied, setCopied] = useState(false);
  const [behind, setBehind] = useState(false);
  const boxElement = useRef<HTMLDivElement | null>(null);

  // The box the words are drawn into: the provider keeps the words, this shows them.
  const box = useCallback((el: HTMLDivElement | null) => {
    boxElement.current = el;
    attachBox(el, setBehind);
  }, [attachBox]);
  const toNewest = () => {
    const el = boxElement.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scriptText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* The words stay on the page to select by hand. */ }
  };

  const connecting = phase === "connecting";
  const waiting = phase === "looking" || phase === "loading" || connecting;
  const said = problem ? problem
    : on ? (detail || "Listening")
    : phase === "looking" ? "Starting Windows Live Captions on this PC… If your browser asks, press Allow."
    : connecting ? (detail || "Connecting to Windows Live Captions…")
    : phase === "failed" ? "Windows Live Captions did not start. Turn it on again."
    : phase === "ready" ? "Ready"
    : detail || "Off";

  return <div className="interview wrap wrap-wide">
    <div className="interview-head">
      <div>
        <h1 className="interview-title">Live script</h1>
        <p className="bridge-status" data-state={on ? "ok" : problem || phase === "failed" ? "warn" : waiting ? "checking" : "off"} role="status">
          <span className="bridge-status-dot" aria-hidden="true" /><span>{said}</span>
        </p>
      </div>
      <div className="interview-actions">
        <span className="interview-source-name">Windows Live Captions</span>
        {hasText && <button type="button" className="jobs-button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>}
        {on || connecting
          ? <button type="button" className="jobs-button" onClick={turnOff}>Turn off live script</button>
          : <button type="button" className="jobs-button" data-primary="" onClick={turnOn} disabled={waiting && !missing}>Turn on live script</button>}
      </div>
    </div>

    {(missing || outdated) && <div className="jobs-card interview-setup">
      <p className="resume-folder-title">{outdated ? "The app needs updating" : "The app did not answer"}</p>
      <p className="jobs-form-hint">{outdated
        ? "Live Captions needs the newest Live Captions helper (KIASA Live Script 1.2.0) on this PC. Open it, then press Turn on live script again."
        : <>The small helper that reads Windows Live Captions for this page is not running. <a className="jobs-link" href={OPEN_APP}>Open it</a>, press Allow if the browser asks about this PC or your local network, then press <b>Turn on live script</b> again.</>}</p>
      <button type="button" className="jobs-link" onClick={dismissSetup}>Close</button>
    </div>}

    <div className="live-box">
      <div ref={box} className="interview-script" data-placeholder="The words appear here, as they are spoken." />
      {behind && <button type="button" className="jobs-button live-newest" data-primary="" onClick={toNewest}>Newest words <ChevronDown /></button>}
    </div>

    <p className="jobs-form-hint interview-note">It uses Windows Live Captions (Windows 11, version 22H2 or newer), which writes down what this PC plays, and your microphone only if you turned that on in its settings. The first time, Windows asks you to accept and to download its language files. While the live script is on, a KIASA admin can read it, on whatever KIASA page you are on, until you turn it off. A copy is saved on this PC when you turn it off. Use it on a call only if everyone on the call has agreed.</p>
  </div>;
}
