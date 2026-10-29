"use client";

import { useEffect, useState } from "react";
import { canChooseFolder, chooseFolder, folderPath, forgetFolder, savedFolder, setFolderPath } from "./jobs-resume-folder";

/** Where the résumé PDFs go on this computer: a folder chosen once (Chrome and
 * Edge), and its path, so "Copy résumé path" can give a job application's file
 * box the whole path. Elsewhere: the Downloads folder, whose path can be given. */
export function ResumeFolder({ onReady }: { onReady?: () => void }) {
  const [supported, setSupported] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [said, setSaid] = useState("");
  useEffect(() => {
    let stopped = false;
    void savedFolder().then(handle => {
      if (stopped) return;
      setSupported(canChooseFolder());
      setFolder(handle?.name ?? null);
      setPath(folderPath());
    });
    return () => { stopped = true; };
  }, []);

  const choose = async () => {
    const picked = await chooseFolder();
    if (!picked) return;
    setFolder(picked.name);
    setSaid(`Chosen: “${picked.name}”. Now paste its path below (File Explorer: open the folder, click the address bar, copy).`);
  };
  const keepPath = () => {
    const clean = path.trim().replace(/^"|"$/g, "");
    if (supported && folder && !clean.replace(/[\\/]+$/, "").toLowerCase().endsWith(folder.toLowerCase())) {
      return setSaid(`That path does not end in “${folder}”, the folder you chose. Copy it from File Explorer's address bar with that folder open.`);
    }
    setFolderPath(clean);
    setSaid(clean ? "Saved. “Copy résumé path” now gives each résumé's whole path." : "");
    if (clean) onReady?.();
  };
  const stop = async () => {
    await forgetFolder();
    setFolder(null);
    setPath("");
    setSaid("Résumé PDFs go to your Downloads folder again.");
  };

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
    {(folder || !supported) && <div className="resume-folder-row">
      <label className="chat-field resume-folder-path"><span>{supported ? "Its path on this computer" : "Your Downloads folder's path"}</span>
        <input value={path} onChange={event => setPath(event.target.value)} placeholder={supported ? `C:\\Users\\you\\Documents\\${folder ?? "KIASA résumés"}` : "C:\\Users\\you\\Downloads"} />
      </label>
      <button type="button" className="jobs-button" data-primary="" onClick={keepPath}>Save path</button>
    </div>}
    {said && <p className="jobs-hint" role="status">{said}</p>}
  </div>;
}
