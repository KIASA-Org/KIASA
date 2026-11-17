"use client";

import { useEffect, useRef, useState } from "react";
import { tailorAnyJob, textForAnyJob, type TailorReport } from "@/lib/resume/actions";
import type { Profile } from "@/lib/resume/schema";
import { Copy, Download, Pencil } from "../site/icons";
import { askChatGPT, bridgeVersion, progressText, type BridgeProgress } from "./jobs-bridge";
import { copyText, jobPlace, savePdf, writableFolder, type Saved } from "./jobs-resume-folder";
import { FIX_ROUNDS, PASS_SCORE } from "@/lib/resume/score";
import { CopyButton, LOST, ReportLists, ScoreView } from "./jobs-resume-parts";

/** "Tailor for any job" on Today: a job found elsewhere, not on KIASA's list. */
export function AnyJobButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="chat-pill" onClick={() => setOpen(true)}><Pencil /> Tailor for any job</button>
    {open && <AnyJobDialog onClose={() => setOpen(false)} />}
  </>;
}

/** A résumé tailored for a job not on KIASA's list: its description pasted
 * (and its company, title and link, if given), ChatGPT asked (by the bridge,
 * or by hand), the answer applied to the base résumé, and the PDF saved in the
 * résumé folder (or downloaded). Nothing is kept on KIASA: the job does not
 * join the list, and the résumé is gone when the dialog closes. */
function AnyJobDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [job, setJob] = useState({ jd: "", company: "", title: "", link: "" });
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [answer, setAnswer] = useState("");
  const [step, setStep] = useState<"idle" | "preparing" | "applying" | "printing">("idle");
  const [result, setResult] = useState<{ report: TailorReport; profile: Profile | null; file: Saved | null } | null>(null);
  // Under the match score: the answers so far, and the next fix round's text for ChatGPT.
  const [answers, setAnswers] = useState<string[]>([]);
  const [fix, setFix] = useState<string | null>(null);
  const [bridge, setBridge] = useState<string | null>(null);
  const [asking, setAsking] = useState<BridgeProgress | "asking" | null>(null);
  const control = useRef<AbortController | null>(null);
  // One key for this résumé's place in the folder (to copy its path).
  const key = useRef(`any-${crypto.randomUUID()}`);
  useEffect(() => { const box = dialog.current; if (box && !box.open) box.showModal(); }, []);
  useEffect(() => {
    let stopped = false;
    void bridgeVersion().then(found => { if (!stopped) setBridge(found); });
    return () => { stopped = true; control.current?.abort(); };
  }, []);

  const edit = (part: keyof typeof job) => (event: { target: { value: string } }) => {
    setJob(current => ({ ...current, [part]: event.target.value }));
    // A change to the job: its text is made again, and any fix round dropped.
    setText(null);
    setAnswers([]);
    setFix(null);
  };
  const place = () => jobPlace({ id: key.current.slice(4), company: job.company || null, title: job.title || null });

  /** The text for ChatGPT, made from the job as it is now. */
  const prepare = async (): Promise<string | null> => {
    setProblem("");
    setStep("preparing");
    const made = await textForAnyJob(job).catch(() => ({ text: undefined, error: LOST }));
    setStep("idle");
    if (!made.text) { setProblem(made.error ?? "That did not work. Please try again."); return null; }
    setText(made.text);
    return made.text;
  };
  /** An answer applied (after the answers before it, in a fix round) and
   * scored: printed when it reaches the match score; else the next fix
   * round's text, returned (or, with no rounds left, rejected). */
  const load = async (given = answer, asked?: Awaited<ReturnType<typeof writableFolder>>, before = answers): Promise<string | null> => {
    const folder = asked === undefined ? await writableFolder() : asked;
    setStep("applying");
    setResult(null);
    const sent = [...before, given];
    const outcome = await tailorAnyJob(job, sent)
      .catch(() => ({ profile: undefined, fix: undefined, report: { ok: false, applied: [], unmatched: [], rejected: [], warnings: [], errors: [LOST] } as TailorReport }));
    const { profile, report } = outcome;
    if (outcome.fix) {
      setAnswers(sent);
      setFix(outcome.fix);
      setAnswer("");
      setStep("idle");
      setResult({ report, profile: null, file: null });
      return outcome.fix;
    }
    setAnswers([]);
    setFix(null);
    if (!profile) { setStep("idle"); setResult({ report, profile: null, file: null }); return null; }
    setStep("printing");
    const file = await savePdf({ profile }, folder, key.current, place());
    setStep("idle");
    setResult({ report, profile, file });
    return null;
  };
  /** Steps 2 and 3 by the bridge: ChatGPT asked in a new chat, then Load PDF; under the match score, each fix round too. */
  const askForMe = async () => {
    const folder = await writableFolder();
    const ready = text ?? await prepare();
    if (!ready) return;
    const stop = new AbortController();
    control.current = stop;
    setResult(null);
    setAsking("asking");
    try {
      // A fix round already waiting carries on from it.
      let question = fix ?? ready;
      let before = fix ? answers : [];
      for (;;) {
        const said = await askChatGPT(question, progress => setAsking(progress), stop.signal);
        setAnswer(said);
        setAsking(null);
        const next = await load(said, folder, before);
        if (!next || stop.signal.aborted) break;
        before = [...before, said];
        question = next;
        setAsking("asking");
      }
    } catch (error) {
      setAsking(null);
      if (!stop.signal.aborted) setProblem((error as Error).message);
    } finally {
      control.current = null;
    }
  };
  const again = async () => {
    if (!result?.profile) return;
    const folder = await writableFolder();
    setStep("printing");
    const file = await savePdf({ profile: result.profile }, folder, key.current, place());
    setStep("idle");
    setResult(current => current && { ...current, file });
  };
  const described = job.jd.trim().length >= 80;
  const busy = step !== "idle" || asking !== null;
  const file = result?.file;

  return <dialog ref={dialog} className="chat-dialog jobs-dialog resume-dialog" data-wide="" aria-label="Tailor for any job" onClose={onClose}>
    <p className="chat-dialog-title">Tailor for any job</p>
    <p className="jobs-form-hint">For a job you found elsewhere. Nothing is kept on KIASA: the job does not join the list, and only the PDF stays, in your résumé folder (or downloads).</p>
    <ol className="resume-steps">
      <li>
        <span>The job:</span>
        <div className="resume-flow">
          <label className="chat-field"><span>Its description (paste the whole of it)</span><textarea rows={7} value={job.jd} onChange={edit("jd")} disabled={busy} /></label>
          <div className="any-job-row">
            <label className="chat-field"><span>Company (optional)</span><input value={job.company} onChange={edit("company")} maxLength={120} disabled={busy} /></label>
            <label className="chat-field"><span>Title (optional)</span><input value={job.title} onChange={edit("title")} maxLength={200} disabled={busy} /></label>
          </div>
          <label className="chat-field"><span>Link (optional)</span><input type="url" value={job.link} onChange={edit("link")} placeholder="https://" disabled={busy} /></label>
        </div>
      </li>
      <li>
        <span>Ask ChatGPT: the tailoring prompt, this job and your base résumé (without your email and phone).</span>
        <div className="bridge-ask">
          {bridge && <button type="button" className="jobs-button" data-primary="" disabled={!described || busy} onClick={() => void askForMe()}>Ask ChatGPT for me</button>}
          {asking
            ? <><span className="jobs-hint" role="status">{progressText(asking === "asking" ? null : asking)}</span>
              <button type="button" className="chat-pill" onClick={() => control.current?.abort()}>Stop</button></>
            : text ? <CopyButton text={text} label="Copy for ChatGPT" />
              : <button type="button" className="chat-pill" disabled={!described || busy} onClick={() => void prepare()}><Copy /> {step === "preparing" ? "Getting it ready…" : bridge ? "Or copy it, to paste yourself" : "Make it, to copy for ChatGPT"}</button>}
        </div>
        {problem && <p className="b-form-error" role="alert">{problem}</p>}
      </li>
      <li>
        <label className="chat-field"><span>ChatGPT&apos;s whole answer (filled in for you with Ask ChatGPT for me)</span>
          <textarea rows={6} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Paste it in a new chat in ChatGPT, send it, and paste its whole answer here" disabled={busy} />
        </label>
      </li>
    </ol>
    {fix && <div className="resume-fix">
      <p className="jobs-hint">Fix round {answers.length} of {FIX_ROUNDS}: its match score is under {PASS_SCORE}. {bridge
        ? <>Ask ChatGPT for me carries on, or do it yourself: copy</> : <>Copy</>} this for ChatGPT, send it in a <b>new chat</b>, paste its whole answer in step 3 and press Load PDF.</p>
      <span className="resume-folder-row"><CopyButton text={fix} label="Copy the fix for ChatGPT" />
        <button type="button" className="chat-pill" disabled={busy} onClick={() => { setAnswers([]); setFix(null); setResult(null); setAnswer(""); }}>Start over</button></span>
    </div>}
    {step === "printing" && <p className="jobs-hint" role="status">Applied and scored. Now making the PDF: usually a few seconds.</p>}
    {result && <div className="resume-result" role="status">
      {result.report.score && <ScoreView score={result.report.score} fixing={fix ? answers.length : undefined} />}
      {result.profile && file && (file.error
        ? <p className="b-form-error">{file.error}</p>
        : <div className="resume-saved">
          <p className="resume-done">{file.where === "folder" ? "Saved in your résumé folder" : "Downloaded"}: {file.where === "folder" ? file.place?.split("/").join(" › ") : file.name}</p>
          {file.path
            ? <span className="resume-path"><code>{file.path}</code><button type="button" className="chat-pill" onClick={() => void copyText(file.path!)}><Copy /> Copy path</button></span>
            : <p className="jobs-hint">Choose a résumé folder under Résumés, and each PDF is saved there with its whole path to copy for applications.</p>}
          <p className="jobs-hint">Not kept on KIASA: to change it, tailor it again.</p>
        </div>)}
      <ReportLists report={result.report} />
    </div>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={step !== "idle"}>{result?.profile ? "Done" : "Cancel"}</button>
      {result?.profile && <button type="button" className="chat-dialog-button" onClick={() => void again()} disabled={busy}><Download /> Save again</button>}
      <button type="button" className="chat-dialog-button" onClick={() => void load()} disabled={busy || !answer.trim()}>
        {step === "applying" ? "Applying…" : step === "printing" ? "Making the PDF…" : "Load PDF"}
      </button>
    </div>
  </dialog>;
}
