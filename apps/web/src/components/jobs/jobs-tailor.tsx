"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job, JobsMe } from "@/lib/jobs/types";
import { tailorFromAnswer, textForJob, type TailorReport } from "@/lib/resume/actions";
import { Download } from "../site/icons";
import { linkLabel } from "./jobs-format";
import { CopyButton, ReportLists, downloadPdf } from "./jobs-resume-parts";

type Tailoring = { made: Set<string>; open: (job: Job) => void };
const TailorContext = createContext<Tailoring | null>(null);
/** For a job's row: whether a résumé was made for it, and how to make one. None for admins. */
export const useTailor = () => useContext(TailorContext);

/** A member's résumés made for jobs: which jobs have one, and the dialog that makes one. */
export function TailorProvider({ me, supabase, onMade, onNeedBase, children }: {
  me: JobsMe; supabase: SupabaseClient; onMade?: () => void; onNeedBase?: () => void; children: ReactNode;
}) {
  const [made, setMade] = useState<Set<string>>(() => new Set());
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    let stopped = false;
    void supabase.from("tailored_resumes").select("job_id").eq("user_id", me.id).order("updated_at", { ascending: false }).limit(2000).then(({ data }) => {
      if (!stopped) setMade(new Set((data ?? []).map(row => row.job_id as string)));
    });
    return () => { stopped = true; };
  }, [supabase, me.id]);
  return <TailorContext.Provider value={{ made, open: setJob }}>
    {children}
    {job && <TailorDialog job={job} before={made.has(job.id)} onClose={() => setJob(null)}
      onNeedBase={onNeedBase && (() => { setJob(null); onNeedBase(); })}
      onMade={() => { setMade(current => new Set(current).add(job.id)); onMade?.(); }} />}
  </TailorContext.Provider>;
}

/** Tailoring a résumé for one job: copy the prompt, the job's description and
 * the base résumé for ChatGPT; paste its answer; Load PDF applies the changes
 * to the base résumé, keeps the result for this job, and downloads the PDF. */
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
  const [result, setResult] = useState<{ saved: boolean; report: TailorReport; printed: string | null } | null>(null);
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
    });
  }, [job.id]);

  if (noBase) return <dialog ref={dialog} className="chat-dialog jobs-dialog resume-dialog" aria-label="First, your base résumé" onClose={onClose}>
    <p className="chat-dialog-title">First, your base résumé</p>
    <div className="chat-dialog-text resume-first">
      <p>Every job&apos;s résumé is made from your base résumé, so make that once first. It takes a few minutes:</p>
      <ul>
        <li><b>Import your PDF</b>: ChatGPT copies your résumé into a form, word for word, and you check it.</li>
        <li>Or <b>type it in</b> the form yourself.</li>
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
    const made = await textForJob(job.id, "tailor", description);
    if (made.text) { setText(made.text); setNeeds(false); } else setProblem(made.error ?? "That did not work. Please try again.");
  };
  const load = async () => {
    setStep("applying");
    setResult(null);
    const { saved, report } = await tailorFromAnswer(job.id, answer);
    if (!saved) { setStep("idle"); return setResult({ saved, report, printed: null }); }
    onMade();
    setStep("printing");
    const printed = await downloadPdf(`job=${job.id}`);
    setStep("idle");
    setResult({ saved, report, printed });
  };
  const again = async () => {
    setStep("printing");
    const printed = await downloadPdf(`job=${job.id}`);
    setStep("idle");
    setResult(current => current && { ...current, printed });
  };

  return <dialog ref={dialog} className="chat-dialog jobs-dialog resume-dialog" data-wide="" aria-label={`Tailor your résumé for ${title}`} onClose={onClose}>
    <p className="chat-dialog-title">Tailor your résumé</p>
    <p className="jobs-form-hint">{[title, job.company].filter(Boolean).join(" · ")}{before ? " · You made one for this job before; a new one takes its place." : ""}</p>
    <ol className="resume-steps">
      <li>
        <span>Copy this for ChatGPT: the tailoring prompt, the job&apos;s description and your base résumé (without your email and phone).</span>
        {text ? <CopyButton text={text} label="Copy for ChatGPT" /> : !problem && <span className="jobs-hint">Getting it ready…</span>}
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
    {result && <div className="resume-result" role="status">
      {result.saved
        ? <p className="resume-done">{result.printed ?? "Your résumé for this job is downloaded. It is also kept under Résumés, Made for jobs."}</p>
        : null}
      <ReportLists report={result.report} />
    </div>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={step !== "idle"}>{result?.saved ? "Done" : "Cancel"}</button>
      {result?.saved && <button type="button" className="chat-dialog-button" onClick={() => void again()} disabled={step !== "idle"}><Download /> Download again</button>}
      <button type="button" className="chat-dialog-button" onClick={() => void load()} disabled={step !== "idle" || !answer.trim()}>
        {step === "applying" ? "Applying…" : step === "printing" ? "Making the PDF…" : "Load PDF"}
      </button>
    </div>
  </dialog>;
}
