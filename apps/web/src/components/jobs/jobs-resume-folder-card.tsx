"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check } from "../site/icons";
import { canChooseFolder, chooseFolder, folderPath, forgetFolder, savedFolder, setFolderPath } from "./jobs-resume-folder";

/** Where the résumé PDFs go on this computer: a folder chosen once (Chrome and
 * Edge), and its path, so "Copy résumé path" can give a job application's file
 * box the whole path. Elsewhere: the Downloads folder, whose path can be given.
 * A browser never tells a page a folder's path, so the member gives it once:
 * until then, the card says so plainly, with how. */
export function ResumeFolder({ onReady }: { onReady?: () => void }) {
  const [supported, setSupported] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [path, setPath] = useState("");
  // The path as kept: none yet means one more step.
  const [kept, setKept] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let stopped = false;
    void savedFolder().then(handle => {
      if (stopped) return;
      setSupported(canChooseFolder());
      setFolder(handle?.name ?? null);
      setPath(folderPath());
      setKept(folderPath());
    });
    return () => { stopped = true; };
  }, []);

  const choose = async () => {
    const picked = await chooseFolder();
    if (!picked) return;
    setFolder(picked.name);
    setProblem("");
    // A new folder needs its own path.
    if (kept && !kept.replace(/[\\/]+$/, "").toLowerCase().endsWith(picked.name.toLowerCase())) { setFolderPath(""); setKept(""); setPath(""); }
  };
  const keepPath = (event: FormEvent) => {
    event.preventDefault();
    const clean = path.trim().replace(/^"|"$/g, "");
    if (!clean) return setProblem("Paste the folder's path first.");
    if (!/^([a-z]:[\\/]|\\\\|\/)/i.test(clean)) return setProblem("That is not a folder's whole path. It starts like C:\\Users\\…");
    if (supported && folder && !clean.replace(/[\\/]+$/, "").toLowerCase().endsWith(folder.toLowerCase())) {
      return setProblem(`That path does not end in “${folder}”, the folder you chose. Open that folder in File Explorer, then copy its address bar.`);
    }
    setFolderPath(clean);
    setKept(clean);
    setProblem("");
    onReady?.();
  };
  const stop = async () => {
    await forgetFolder();
    setFolder(null);
    setPath("");
    setKept("");
  };

  const needsPath = (folder || !supported) && !kept;
  return <div className="resume-folder">
    <p className="resume-folder-title">Where your résumé PDFs go</p>
    {supported
      ? <p className="jobs-form-hint">{folder
        ? <>Saved straight into <b>“{folder}”</b> on this computer: a folder for each day (2026-10-29), and in it one for each job (Docker - Data Engineer), with the résumé named as a recruiter should see it: <b>Your Name Resume.pdf</b>.</>
        : <>Choose a folder once (for example Documents\KIASA résumés): every résumé is then saved in it, in a folder for the day and one for the job, named simply <b>Your Name Resume.pdf</b>.</>}</p>
      : <p className="jobs-form-hint">This browser saves them to your Downloads folder. (In Chrome or Edge, you can choose a folder of your own.)</p>}
    <div className="resume-folder-row">
      {supported && <button type="button" className="chat-pill" onClick={() => void choose()}>{folder ? "Change folder" : "Choose a folder"}</button>}
      {supported && folder && <button type="button" className="chat-pill" data-danger="" onClick={() => void stop()}>Stop using it</button>}
    </div>
    {needsPath && <div className="resume-banner resume-path-needed">
      <p><b>One more step: its path.</b> Browsers keep a folder&apos;s place on the computer hidden from websites, so KIASA needs you to give it once:</p>
      <ol>
        <li>Open <b>File Explorer</b> and go into {supported && folder ? <b>“{folder}”</b> : <>your <b>Downloads</b> folder</>}.</li>
        <li>Click the <b>address bar</b> at the top: it shows the path as text. Press <b>Ctrl+C</b>.</li>
        <li>Paste it below (<b>Ctrl+V</b>) and press <b>Save path</b>.</li>
      </ol>
    </div>}
    {(folder || !supported) && <form className="resume-folder-row" onSubmit={keepPath}>
      <label className="chat-field resume-folder-path"><span>{supported ? `The path of “${folder}”` : "Your Downloads folder's path"}</span>
        <input value={path} onChange={event => { setPath(event.target.value); setProblem(""); }} placeholder="Paste it here (it starts like C:\Users\…)" spellCheck={false} />
      </label>
      <button type="submit" className="jobs-button" data-primary="" disabled={!path.trim() || path.trim() === kept}>Save path</button>
    </form>}
    {problem && <p className="b-form-error" role="alert">{problem}</p>}
    {kept && !needsPath && <p className="resume-path-kept" role="status"><Check /> Path saved: <code>{kept}</code>. “Copy résumé path” now gives each résumé&apos;s whole path.</p>}
  </div>;
}
