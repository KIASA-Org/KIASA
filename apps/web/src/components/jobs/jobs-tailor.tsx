"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job, JobsMe } from "@/lib/jobs/types";
import { tailorFromAnswer, textForJob, type TailorReport } from "@/lib/resume/actions";
import { Copy, Download } from "../site/icons";
import { linkLabel } from "./jobs-format";
import { canChooseFolder, copyText, folderPath, hasFile, jobPlace, pathOf, savePdf, savedName, writableFolder, type Saved } from "./jobs-resume-folder";
import { ResumeFolder } from "./jobs-resume-folder-card";
import { CopyButton, LOST, ReportLists } from "./jobs-resume-parts";

/** Copying a job's résumé path: being saved first, copied (the path), or what went wrong. */
type Copying = { job: string; state: "busy" | "done" | "failed"; text?: string };
/** What copying a path needs of a job: which, and its company and title (for its folder). */
type JobNamed = Pick<Job, "id" | "company" | "title">;
type Tailoring = { made: Set<string>; open: (job: Job) => void; copyPath: (job: JobNamed) => void; copying: Copying | null };
const TailorContext = createContext<Tailoring | null>(null);
/** For a job's row: whether a résumé was made for it, how to make one, and
 * copying its file's path for the job's application. None for admins. */
export const useTailor = () => useContext(TailorContext);

/** A member's résumés made for jobs: which jobs have one, the dialog that makes
 * one, and "Copy résumé path": the job's résumé PDF, saved in their résumé
 * folder if it is not there yet, and its whole path copied, to paste in a job
 * application's file box. */
export function TailorProvider({ me, supabase, onMade, onNeedBase, children }: {
  me: JobsMe; supabase: SupabaseClient; onMade?: () => void; onNeedBase?: () => void; children: ReactNode;
}) {
  const [made, setMade] = useState<Set<string>>(() => new Set());
  const [job, setJob] = useState<Job | null>(null);
  const [copying, setCopying] = useState<Copying | null>(null);
  const [settingUp, setSettingUp] = useState<JobNamed | null>(null);
  const shown = useRef(0);
  useEffect(() => {
    let stopped = false;
    void supabase.from("tailored_resumes").select("job_id").eq("user_id", me.id).order("updated_at", { ascending: false }).limit(2000).then(({ data }) => {
      if (!stopped) setMade(new Set((data ?? []).map(row => row.job_id as string)));
    });
    return () => { stopped = true; };
  }, [supabase, me.id]);

  const say = (next: Copying) => {
    setCopying(next);
    const mine = ++shown.current;
    if (next.state !== "busy") window.setTimeout(() => { if (shown.current === mine) setCopying(null); }, next.state === "done" ? 6000 : 9000);
  };
  const copyPath = async (target: JobNamed) => {
    // Asked first, in the click: the browser may ask to allow the folder.
    const folder = await writableFolder();
    if (!folderPath() || (canChooseFolder() && !folder)) return setSettingUp(target);
    say({ job: target.id, state: "busy" });
    // Where it was saved, if it still is; else saved now, in today's folder for the job.
    let place = savedName(target.id);
    if (!place || (folder && !(await hasFile(folder, place)))) {
      const saved = await savePdf(`job=${target.id}`, folder, target.id, jobPlace(target));
      if (saved.error || !saved.place) return say({ job: target.id, state: "failed", text: saved.error ?? "The PDF could not be made." });
      place = saved.place;
    }
    const path = pathOf(place)!;
    say(await copyText(path)
      ? { job: target.id, state: "done", text: path }
      : { job: target.id, state: "failed", text: `Copy this path: ${path}` });
  };

  return <TailorContext.Provider value={{ made, open: setJob, copyPath: target => void copyPath(target), copying }}>
    {children}
    {job && <TailorDialog job={job} before={made.has(job.id)} onClose={() => setJob(null)}
      onNeedBase={onNeedBase && (() => { setJob(null); onNeedBase(); })}
      onMade={() => { setMade(current => new Set(current).add(job.id)); onMade?.(); }} />}
    {settingUp && <FolderDialog onClose={() => setSettingUp(null)} onReady={() => { const target = settingUp; setSettingUp(null); void copyPath(target); }} />}
    {copying && copying.state !== "busy" && <p className="resume-toast" data-state={copying.state} role="status">
      {copying.state === "done" ? <>Copied <b>{copying.text}</b>. On the job&apos;s application, click to upload, paste it into the <b>File name</b> box and press Enter.</> : copying.text}
    </p>}
  </TailorContext.Provider>;
}

/** First time copying a path: where the résumé PDFs go, chosen once. */
function FolderDialog({ onReady, onClose }: { onReady: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const box = dialog.current; if (box && !box.open) box.showModal(); }, []);
  return <dialog ref={dialog} className="chat-dialog jobs-dialog resume-dialog" data-wide="" aria-label="Your résumé folder" onClose={onClose}>
    <p className="chat-dialog-title">Your résumé folder</p>
    <p className="jobs-form-hint">To copy a résumé&apos;s whole path for a job application, KIASA saves each one in a folder of yours. Set it once; it stays for this browser.</p>
    <ResumeFolder onReady={onReady} />
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose}>Close</button>
    </div>
  </dialog>;
}

/** Tailoring a résumé for one job: copy the prompt, the job's description and
 * the base résumé for ChatGPT; paste its answer; Load PDF applies the changes
 * to the base résumé, keeps the result for this job, and saves the PDF (in the
 * member's résumé folder, or downloads it), with its path to copy. */
function TailorDialog({ job, before, onMade, onNeedBase, onClose }: { job: Job; before: boolean; onMade: () => void; onNeedBase?: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [needs, setNeeds] = useState(false);
  // No base résumé yet: the way to make one, instead of the steps.
  const [noBase, setNoBase] = useState(false);
  const [description, setDescription] = useState("");
  const [answer, setAnswer] = useState("");
  const [step, setStep] = useState<"idle" | "applying" | "printing">("idle");
  const [result, setResult] = useState<{ saved: boolean; report: TailorReport; file: Saved | null } | null>(null);
  const title = job.title ?? linkLabel(job.url);
  // Opened as a modal, and again when it turns into "First, your base résumé".
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, [noBase]);
  useEffect(() => {
    void textForJob(job.id, "tailor").then(made => {
      if (made.text) setText(made.text);
      else if (made.needsBase) setNoBase(true);
      else { setProblem(made.error ?? "That did not work. Please try again."); setNeeds(!!made.needsDescription); }
    }, () => setProblem(LOST));
  }, [job.id]);

  if (noBase) return <dialog ref={dialog} className="chat-dialog jobs-dialog resume-dialog" aria-label="First, your base résumé" onClose={onClose}>
    <p className="chat-dialog-title">First, your base résumé</p>
    <div className="chat-dialog-text resume-first">
      <p>Every job&apos;s résumé is tailored from your base résumé, so make that once first, in two steps:</p>
      <ul>
        <li><b>Your facts</b>: copied from your PDF into a form (or typed in), and checked by you.</li>
        <li><b>Your init prompt</b> writes your base résumé from them, for the kind of job you want.</li>
      </ul>
      <p>Then come back to this job and press Tailor résumé again.</p>
    </div>
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose}>Later</button>
      {onNeedBase && <button type="button" className="chat-dialog-button" onClick={onNeedBase}>Make your base résumé</button>}
    </div>
  </dialog>;

  const withDescription = async () => {
    setProblem("");
    const made = await textForJob(job.id, "tailor", description).catch(() => ({ text: undefined, error: LOST }));
    if (made.text) { setText(made.text); setNeeds(false); } else setProblem(made.error ?? "That did not work. Please try again.");
  };
  const load = async () => {
    // The résumé folder, asked for first, while the click still counts.
    const folder = await writableFolder();
    setStep("applying");
    setResult(null);
    // A call that fails (the connection, or a page from before an update) says so, instead of waiting for ever.
    const { saved, report } = await tailorFromAnswer(job.id, answer)
      .catch(() => ({ saved: false, report: { ok: false, applied: [], unmatched: [], rejected: [], warnings: [], errors: [LOST] } as TailorReport }));
    if (!saved) { setStep("idle"); return setResult({ saved, report, file: null }); }
    onMade();
    setStep("printing");
    const file = await savePdf(`job=${job.id}`, folder, job.id, jobPlace(job));
    setStep("idle");
    setResult({ saved, report, file });
  };
  const again = async () => {
    const folder = await writableFolder();
    setStep("printing");
    const file = await savePdf(`job=${job.id}`, folder, job.id, jobPlace(job));
    setStep("idle");
    setResult(current => current && { ...current, file });
  };
  const file = result?.file;

  return <dialog ref={dialog} className="chat-dialog jobs-dialog resume-dialog" data-wide="" aria-label={`Tailor your résumé for ${title}`} onClose={onClose}>
    <p className="chat-dialog-title">Tailor your résumé</p>
    <p className="jobs-form-hint">{[title, job.company].filter(Boolean).join(" · ")}{before ? " · You made one for this job before; a new one takes its place." : ""}</p>
    <ol className="resume-steps">
      <li>
        <span>Copy this for ChatGPT: the tailoring prompt, the job&apos;s description and your base résumé (without your email and phone).</span>
        {text ? <CopyButton text={text} label="Copy for ChatGPT" /> : !problem && <span className="jobs-hint">Getting it ready… (if KIASA has no description for this job yet, it reads it from the job&apos;s page, which can take a few seconds)</span>}
        {needs && <div className="resume-flow">
          <label className="chat-field"><span>The job&apos;s description, from its page</span><textarea rows={6} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <button type="button" className="jobs-button" disabled={description.trim().length < 80} onClick={() => void withDescription()}>Use this description</button>
        </div>}
        {problem && <p className="b-form-error" role="alert">{problem}</p>}
      </li>
      <li><span>Paste it in a <b>new chat</b> in ChatGPT and send it. Copy its whole answer.</span></li>
      <li>
        <label className="chat-field"><span>Paste the answer here</span>
          <textarea rows={7} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="ChatGPT's whole answer" />
        </label>
      </li>
    </ol>
    {step === "printing" && <p className="jobs-hint" role="status">Applied and kept. Now making the PDF: usually a few seconds, up to about 20 when it is the first in a while.</p>}
    {result && <div className="resume-result" role="status">
      {result.saved && file && (file.error
        ? <p className="b-form-error">{file.error}</p>
        : <div className="resume-saved">
          <p className="resume-done">{file.where === "folder" ? "Saved in your résumé folder" : "Downloaded"}: {file.where === "folder" ? file.place?.split("/").join(" › ") : file.name}</p>
          {file.path
            ? <span className="resume-path"><code>{file.path}</code><button type="button" className="chat-pill" onClick={() => void copyText(file.path!)}><Copy /> Copy path</button></span>
            : <p className="jobs-hint">Choose a résumé folder under Résumés, and each PDF is saved there with its whole path to copy for applications.</p>}
          <p className="jobs-hint">It is also kept under Résumés, Made for jobs.</p>
        </div>)}
      <ReportLists report={result.report} />
    </div>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={step !== "idle"}>{result?.saved ? "Done" : "Cancel"}</button>
      {result?.saved && <button type="button" className="chat-dialog-button" onClick={() => void again()} disabled={step !== "idle"}><Download /> Save again</button>}
      <button type="button" className="chat-dialog-button" onClick={() => void load()} disabled={step !== "idle" || !answer.trim()}>
        {step === "applying" ? "Applying…" : step === "printing" ? "Making the PDF…" : "Load PDF"}
      </button>
    </div>
  </dialog>;
}
