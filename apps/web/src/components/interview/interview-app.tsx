"use client";

import { useCallback, useState } from "react";
import { Download } from "../site/icons";
import { DOWNLOAD_URL, OPEN_APP, useLiveCapture, type Source } from "./live-capture";

const CAPTURES: { source: Source; name: string }[] = [
  { source: "kiasa", name: "KIASA live capture" },
  { source: "system", name: "System live capture" },
];

/** The Interview page's live script: a choice of capture (KIASA's own, or Windows'
 * Live Captions, which works the same from here on), a button that turns the script
 * on and off, and the words as they come. The capture itself lives in the
 * LiveCaptureProvider (root layout), so it keeps running as the member moves around KIASA. */
export function InterviewApp() {
  const { phase, detail, problem, missing, hasText, on, source, chooseSource, outdated, progress, turnOn, turnOff, dismissSetup, attachBox, scriptText } = useLiveCapture();
  const [copied, setCopied] = useState(false);

  // The box the words are drawn into: the provider keeps the words, this shows them.
  const box = useCallback((el: HTMLDivElement | null) => attachBox(el), [attachBox]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scriptText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* The words stay on the page to select by hand. */ }
  };

  const connecting = phase === "connecting";
  const waiting = phase === "looking" || phase === "loading" || connecting;
  const system = source === "system";
  const said = problem ? problem
    : on ? (detail || "Listening")
    : phase === "looking" ? "Opening the KIASA Live Script app on this PC… If your browser asks, press Allow."
    : connecting ? (detail || "Connecting to system live capture…")
    : phase === "loading" ? (detail || "Loading the speech model…")
    : phase === "failed" ? "The speech model did not load. Check the internet connection, then turn it on again."
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
        <div className="interview-source" role="radiogroup" aria-label="Live capture">
          {CAPTURES.map(capture => <button key={capture.source} type="button" role="radio" aria-checked={source === capture.source}
            disabled={on || waiting} onClick={() => chooseSource(capture.source)}>{capture.name}</button>)}
        </div>
        {hasText && <button type="button" className="jobs-button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>}
        {on || connecting
          ? <button type="button" className="jobs-button" onClick={turnOff}>Turn off live script</button>
          : <button type="button" className="jobs-button" data-primary="" onClick={turnOn} disabled={waiting && !missing}>Turn on live script</button>}
      </div>
    </div>

    {/* The first run downloads the speech model (about 660 MB): show how far it has got. */}
    {phase === "loading" && <div className="interview-progress" role="progressbar"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
      aria-label="Getting the speech model">
      <span className="interview-progress-fill" data-waiting={progress === null || undefined}
        style={progress === null ? undefined : { width: `${Math.max(2, Math.round(progress * 100))}%` }} />
    </div>}

    {(missing || outdated) && <div className="jobs-card interview-setup">
      <p className="resume-folder-title">{outdated ? "The app needs updating" : "The app did not answer"}</p>
      {outdated
        ? <p className="jobs-form-hint">System live capture needs the newest KIASA Live Script app. Get it the same way as before; it takes over from the old one when you open it.</p>
        : <p className="jobs-form-hint">The live script needs the KIASA Live Script app on this PC ({system ? "Windows 11" : "Windows 10 or 11"}). If it is installed, <a className="jobs-link" href={OPEN_APP}>open it</a>, and press Allow if the browser asks about this PC or your local network. If not:</p>}
      <ol className="resume-steps">
        <li><a className="jobs-button" data-primary="" href={DOWNLOAD_URL}><Download /> Download the app</a></li>
        <li>Unzip it (right-click the file, <b>Extract All</b>).</li>
        <li>In the folder, open <b>KIASA Live Script.exe</b>. If Windows says it protected your PC, press <b>More info</b>, then <b>Run anyway</b>.{!system && " The first time you use it, it downloads its speech model (about 660 MB)."}</li>
        <li>Come back here and press <b>Turn on live script</b>.</li>
      </ol>
      <button type="button" className="jobs-link" onClick={dismissSetup}>Close</button>
    </div>}

    <div ref={box} className="interview-script" data-placeholder="The words appear here, as they are spoken." />

    <p className="jobs-form-hint interview-note">{system
      ? "It uses Windows Live Captions (Windows 11, version 22H2 or newer), which writes down what this PC plays, and your microphone only if you turned that on in its settings. The first time, Windows asks you to accept and to download its language files."
      : "It writes down what this PC plays, not your microphone."} While the live script is on, a KIASA admin can read it, on whatever KIASA page you are on, until you turn it off. A copy is saved on this PC when you turn it off. Use it on a call only if everyone on the call has agreed.</p>
  </div>;
}
