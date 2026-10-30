"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job, JobsMe } from "@/lib/jobs/types";
import { baseResumeFor, tailorFromAnswer, textForJob, type TailorReport } from "@/lib/resume/actions";
import { Copy, Download } from "../site/icons";
import { BridgeDialog, BridgeStatusLine } from "./jobs-bridge-card";
import { askChatGPT, bridgeVersion, canRead, progressText, readJobPage, useBridgeStatus, type BridgeProgress } from "./jobs-bridge";
import { linkLabel } from "./jobs-format";
import { canChooseFolder, copyText, folderPath, hasFile, jobPlace, pathOf, savePdf, savedName, writableFolder, type Saved } from "./jobs-resume-folder";
import { ResumeFolder } from "./jobs-resume-folder-card";
import { CopyButton, LOST, ReportLists } from "./jobs-resume-parts";

/** Copying a job's résumé path: being saved first, copied (the path), or what went wrong. */
type Copying = { job: string; state: "busy" | "done" | "failed"; text?: string };
/** What copying a path needs of a job: which, and its company and title (for its folder). */
type JobNamed = Pick<Job, "id" | "company" | "title">;
/** Auto mode: every job of the day without a résumé made for it, one after
 * another, through the KIASA ChatGPT Bridge. `based`: of those `done`, how
 * many have the base résumé (no description anywhere). `note`: why it
 * stopped, or waits. */
export type AutoState = {
  on: boolean; job: JobNamed | null; progress: BridgeProgress | null; done: number; based: number;
  failed: { title: string; why: string }[]; note: string;
};
/** `plain`: of the jobs with a résumé, those whose is the base résumé as it is. */
type Tailoring = {
  made: Set<string>; plain: Set<string>; open: (job: Job) => void; copyPath: (job: JobNamed) => void; copying: Copying | null;
  auto: AutoState; startAuto: () => void; stopAuto: () => void;
};
const IDLE: AutoState = { on: false, job: null, progress: null, done: 0, based: 0, failed: [], note: "" };
const LOST_REPORT: TailorReport = { ok: false, applied: [], unmatched: [], rejected: [], warnings: [], errors: [LOST] };
const TailorContext = createContext<Tailoring | null>(null);
/** For a job's row: whether a résumé was made for it, how to make one, and
 * copying its file's path for the job's application. None for admins. */
export const useTailor = () => useContext(TailorContext);

/** A member's résumés made for jobs: which jobs have one, the dialog that makes
 * one, and "Copy résumé path": the job's résumé PDF, saved in their résumé
 * folder if it is not there yet, and its whole path copied, to paste in a job
 * application's file box. */
export function TailorProvider({ me, supabase, today, onMade, onNeedBase, children }: {
  me: JobsMe; supabase: SupabaseClient; today: string; onMade?: () => void; onNeedBase?: () => void; children: ReactNode;
}) {
  const [made, setMade] = useState<Set<string>>(() => new Set());
  const [plain, setPlain] = useState<Set<string>>(() => new Set());
  const [job, setJob] = useState<Job | null>(null);
  const [copying, setCopying] = useState<Copying | null>(null);
  const [settingUp, setSettingUp] = useState<JobNamed | null>(null);
  const [auto, setAuto] = useState<AutoState>(IDLE);
  const [needBridge, setNeedBridge] = useState(false);
  const shown = useRef(0);
  // For Auto mode, which runs on beyond any one render.
  const madeNow = useRef(made);
  const running = useRef<AbortController | null>(null);
  useEffect(() => { madeNow.current = made; }, [made]);
  useEffect(() => {
    let stopped = false;
    void supabase.from("tailored_resumes").select("job_id, base:report->base").eq("user_id", me.id).order("updated_at", { ascending: false }).limit(2000).then(({ data }) => {
      if (stopped) return;
      const rows = (data ?? []) as { job_id: string; base: unknown }[];
      setMade(new Set(rows.map(row => row.job_id)));
      setPlain(new Set(rows.filter(row => row.base === true).map(row => row.job_id)));
    });
    return () => { stopped = true; };
  }, [supabase, me.id]);
  // Leaving the job desk stops Auto mode.
  useEffect(() => () => running.current?.abort(), []);
  /** A job's résumé made: tailored, or (`base`) the base résumé as it is. */
  const madeFor = (id: string, base: boolean) => {
    setMade(current => new Set(current).add(id));
    setPlain(current => { const next = new Set(current); if (base) next.add(id); else next.delete(id); return next; });
    onMade?.();
  };

  const startAuto = async () => {
    if (running.current) return;
    // (A bridge from before it could read a job's page is updated first.)
    if (!canRead(await bridgeVersion())) return setNeedBridge(true);
    // The résumé folder, asked for now, in the click: each PDF is saved into it.
    const folder = await writableFolder();
    const control = new AbortController();
    running.current = control;
    const tried = new Set<string>();
    const update = (patch: Partial<AutoState>) => setAuto(current => ({ ...current, ...patch }));
    const fail = (target: JobNamed, why: string) => {
      tried.add(target.id);
      setAuto(current => ({ ...current, failed: [...current.failed, { title: [target.title, target.company].filter(Boolean).join(" · ") || "A job", why }] }));
    };
    setAuto({ ...IDLE, on: true, note: "Starting…" });
    const pause = (ms: number) => new Promise<void>(resolve => {
      const timer = window.setTimeout(resolve, ms);
      control.signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
    });
    try {
      while (!control.signal.aborted) {
        // The day's jobs as they are now (new ones join as they are posted).
        const { data } = await supabase.rpc("jobs_on", { on_day: today });
        const next = ((data ?? []) as Job[]).find(entry => entry.status !== "skipped" && !madeNow.current.has(entry.id) && !tried.has(entry.id));
        if (!next) {
          update({ job: null, progress: null, note: "Every job of the day has its résumé. Waiting for new jobs…" });
          await pause(60_000);
          continue;
        }
        update({ job: next, progress: null, note: "" });
        const lost = () => ({ text: undefined, error: LOST, needsBase: false, needsDescription: false });
        let text = await textForJob(next.id, "tailor").catch(lost);
        // No description on KIASA: read off the job's page in this browser.
        if (!text.text && text.needsDescription) {
          let found: { text: string; form: boolean };
          try {
            found = await readJobPage(next.id, progress => update({ progress }), control.signal);
          } catch (error) {
            if (control.signal.aborted) break;
            fail(next, (error as Error).message);
            continue;
          }
          if (found.text) text = await textForJob(next.id, "tailor", found.text).catch(lost);
          // None there either (often only an application form): the base résumé, as it is.
          if (!text.text && text.needsDescription) {
            const { errors } = await baseResumeFor(next.id).catch(() => ({ errors: [LOST] }));
            if (errors?.length) { fail(next, errors[0]); continue; }
            madeFor(next.id, true);
            if (folder) {
              const file = await savePdf(`job=${next.id}`, folder, next.id, jobPlace(next));
              if (file.error) fail(next, `Its PDF: ${file.error}`);
            }
            setAuto(current => ({ ...current, done: current.done + 1, based: current.based + 1 }));
            continue;
          }
        }
        if (!text.text) {
          if (text.needsBase) { update({ note: "Make your base résumé first (Résumés tab): every job's résumé is made from it." }); break; }
          fail(next, text.error ?? "Its text could not be made.");
          continue;
        }
        let answer: string;
        try {
          answer = await askChatGPT(text.text, progress => update({ progress }), control.signal);
        } catch (error) {
          const why = (error as Error).message;
          if (control.signal.aborted) break;
          if (/usage limit|not signed in|message box|bridge/i.test(why)) { update({ note: why }); break; }
          fail(next, why);
          continue;
        }
        const { saved, report } = await tailorFromAnswer(next.id, answer).catch(() => ({ saved: false, report: LOST_REPORT }));
        if (!saved) { fail(next, report.errors[0] ?? "ChatGPT's answer could not be used."); continue; }
        madeFor(next.id, false);
        // Into the résumé folder; with none, kept on KIASA only (a page cannot download dozens of files unasked).
        if (folder) {
          const file = await savePdf(`job=${next.id}`, folder, next.id, jobPlace(next));
          if (file.error) fail(next, `Made, but its PDF: ${file.error}`);
        }
        setAuto(current => ({ ...current, done: current.done + 1 }));
      }
    } finally {
      running.current = null;
      setAuto(current => ({ ...current, on: false, job: null, progress: null, note: current.note && !/^Starting|Waiting/.test(current.note) ? current.note : control.signal.aborted ? "Stopped." : current.note }));
    }
  };
  const stopAuto = () => running.current?.abort();

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

  return <TailorContext.Provider value={{ made, plain, open: setJob, copyPath: target => void copyPath(target), copying, auto, startAuto: () => void startAuto(), stopAuto }}>
    {children}
    {needBridge && <BridgeDialog onClose={() => setNeedBridge(false)} />}
    {job && <TailorDialog job={job} before={made.has(job.id)} onClose={() => setJob(null)}
      onNeedBase={onNeedBase && (() => { setJob(null); onNeedBase(); })}
      onMade={base => madeFor(job.id, base)} />}
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
function TailorDialog({ job, before, onMade, onNeedBase, onClose }: { job: Job; before: boolean; onMade: (base: boolean) => void; onNeedBase?: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [needs, setNeeds] = useState(false);
  // What reading the job's page found, when it found no description.
  const [pageSaid, setPageSaid] = useState("");
  // No base résumé yet: the way to make one, instead of the steps.
  const [noBase, setNoBase] = useState(false);
  const [description, setDescription] = useState("");
  const [answer, setAnswer] = useState("");
  const [step, setStep] = useState<"idle" | "applying" | "printing">("idle");
  const [result, setResult] = useState<{ saved: boolean; report: TailorReport; file: Saved | null } | null>(null);
  // The ChatGPT bridge, when installed: "Ask ChatGPT for me" does steps 1 to 3.
  const [bridge, setBridge] = useState<string | null>(null);
  const [asking, setAsking] = useState<BridgeProgress | "asking" | null>(null);
  const askingControl = useRef<AbortController | null>(null);
  const title = job.title ?? linkLabel(job.url);
  useEffect(() => () => askingControl.current?.abort(), []);
  // Opened as a modal, and again when it turns into "First, your base résumé".
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, [noBase]);
  // The text for ChatGPT; with no description on KIASA, read off the job's
  // page by the bridge (when it can), else pasted by the member.
  useEffect(() => {
    let stopped = false;
    void (async () => {
      const lost = () => ({ text: undefined, error: LOST, needsBase: false, needsDescription: false });
      const [first, version] = await Promise.all([textForJob(job.id, "tailor").catch(lost), bridgeVersion()]);
      if (stopped) return;
      setBridge(version);
      let made = first;
      if (!made.text && made.needsDescription && canRead(version)) {
        const control = new AbortController();
        askingControl.current = control;
        setAsking({ step: "reading" });
        const found = await readJobPage(job.id, () => {}, control.signal).catch(() => null);
        askingControl.current = null;
        if (stopped) return;
        setAsking(null);
        if (found?.text) made = await textForJob(job.id, "tailor", found.text).catch(lost);
        else if (found) setPageSaid(found.form
          ? "Its page has no description: it seems to be only an application form."
          : "No description was found on its page either.");
      }
      if (stopped) return;
      if (made.text) setText(made.text);
      else if (made.needsBase) setNoBase(true);
      else { setProblem(made.needsDescription ? "" : made.error ?? "That did not work. Please try again."); setNeeds(!!made.needsDescription); }
    })();
    return () => { stopped = true; };
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
  const load = async (given = answer, asked?: Awaited<ReturnType<typeof writableFolder>>) => {
    // The résumé folder, asked for first, while the click still counts.
    const folder = asked === undefined ? await writableFolder() : asked;
    setStep("applying");
    setResult(null);
    // A call that fails (the connection, or a page from before an update) says so, instead of waiting for ever.
    const { saved, report } = await tailorFromAnswer(job.id, given).catch(() => ({ saved: false, report: LOST_REPORT }));
    if (!saved) { setStep("idle"); return setResult({ saved, report, file: null }); }
    onMade(false);
    setStep("printing");
    const file = await savePdf(`job=${job.id}`, folder, job.id, jobPlace(job));
    setStep("idle");
    setResult({ saved, report, file });
  };
  /** Steps 1 to 3 by the bridge: ChatGPT asked in a new chat, its answer pasted here, then Load PDF. */
  const askForMe = async () => {
    if (!text) return;
    const folder = await writableFolder();
    const control = new AbortController();
    askingControl.current = control;
    setResult(null);
    setProblem("");
    setAsking("asking");
    try {
      const said = await askChatGPT(text, progress => setAsking(progress), control.signal);
      setAnswer(said);
      setAsking(null);
      await load(said, folder);
    } catch (error) {
      setAsking(null);
      if (!control.signal.aborted) setProblem((error as Error).message);
    } finally {
      askingControl.current = null;
    }
  };
  /** No description anywhere: the base résumé, as it is, is this job's résumé. */
  const takeBase = async () => {
    const folder = await writableFolder();
    setStep("applying");
    setResult(null);
    const { errors } = await baseResumeFor(job.id).catch(() => ({ errors: [LOST] }));
    const report: TailorReport = { ok: !errors?.length, applied: [], unmatched: [], rejected: [], warnings: [], errors: errors ?? [], base: true };
    if (errors?.length) { setStep("idle"); return setResult({ saved: false, report, file: null }); }
    onMade(true);
    setStep("printing");
    const file = await savePdf(`job=${job.id}`, folder, job.id, jobPlace(job));
    setStep("idle");
    setResult({ saved: true, report, file });
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
        {text && bridge && <div className="bridge-ask">
          <button type="button" className="jobs-button" data-primary="" disabled={asking !== null || step !== "idle"} onClick={() => void askForMe()}>Ask ChatGPT for me</button>
          {asking && <><span className="jobs-hint" role="status">{progressText(asking === "asking" ? null : asking)}</span>
            <button type="button" className="chat-pill" onClick={() => askingControl.current?.abort()}>Stop</button></>}
          {!asking && <span className="jobs-hint">or do it yourself:</span>}
        </div>}
        {text ? <CopyButton text={text} label="Copy for ChatGPT" />
          : asking ? <span className="bridge-ask"><span className="jobs-hint" role="status">{progressText(asking === "asking" ? null : asking)}</span>
            <button type="button" className="chat-pill" onClick={() => askingControl.current?.abort()}>Stop</button></span>
          : !problem && !needs && <span className="jobs-hint">Getting it ready… (if KIASA has no description for this job yet, it reads it from the job&apos;s page, which can take a few seconds)</span>}
        {needs && !asking && <div className="resume-flow">
          <p className="jobs-hint">{pageSaid
            ? <>{pageSaid} If you find one elsewhere, paste it; else use your base résumé as it is.</>
            : <>KIASA has no description for this job yet. Paste one from the job&apos;s page, or, when there is none (only an application form), use your base résumé as it is.</>}</p>
          <label className="chat-field"><span>The job&apos;s description, from its page</span><textarea rows={6} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <div className="resume-folder-row">
            <button type="button" className="jobs-button" disabled={description.trim().length < 80 || step !== "idle"} onClick={() => void withDescription()}>Use this description</button>
            <button type="button" className="chat-pill" disabled={step !== "idle" || !!result?.saved} onClick={() => void takeBase()}>Use my base résumé for this job</button>
          </div>
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
      {result.report.base && result.saved && <p className="jobs-hint">Your base résumé, as it is, is this job&apos;s résumé (there is no description to tailor it to).</p>}
      <ReportLists report={result.report} />
    </div>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={step !== "idle"}>{result?.saved ? "Done" : "Cancel"}</button>
      {result?.saved && <button type="button" className="chat-dialog-button" onClick={() => void again()} disabled={step !== "idle"}><Download /> Save again</button>}
      <button type="button" className="chat-dialog-button" onClick={() => void load()} disabled={step !== "idle" || asking !== null || !answer.trim()}>
        {step === "applying" ? "Applying…" : step === "printing" ? "Making the PDF…" : "Load PDF"}
      </button>
    </div>
  </dialog>;
}

/** Auto mode on Today: off, a switch, what it does and how KIASA and ChatGPT
 * are connected; on, how far it has got, the job it is on and how ChatGPT is
 * doing, and Stop. What it could not do is listed, to do by hand. */
export function AutoBar() {
  const tailor = useTailor();
  const { status, check } = useBridgeStatus();
  const [settingUp, setSettingUp] = useState(false);
  if (!tailor) return null;
  const { auto, startAuto, stopAuto } = tailor;
  // No bridge, or one too old for Auto mode: its steps first.
  const start = () => status?.state === "missing" || status?.state === "old" ? setSettingUp(true) : startAuto();
  return <div className="auto-bar" data-on={auto.on || undefined}>
    {auto.on
      ? <>
        <span className="auto-dot" aria-hidden="true" />
        <p className="auto-text" role="status">
          <b>Auto mode</b> · {auto.done} made{auto.based ? ` (${auto.based} with your base résumé)` : ""}
          {auto.job ? <> · now: {[auto.job.title, auto.job.company].filter(Boolean).join(" · ")} · {progressText(auto.progress)}</> : auto.note ? <> · {auto.note}</> : null}
        </p>
        <button type="button" className="chat-pill" data-danger="" onClick={stopAuto}>Stop</button>
      </>
      : <>
        <p className="auto-text"><b>Auto mode</b>: ChatGPT makes a résumé for every job of the day without one, one after another (through the ChatGPT bridge), and saves each PDF in your résumé folder. A job with no description anywhere (only an application form) gets your base résumé.{auto.note && <> <span className="auto-note">{auto.done ? `${auto.done} made${auto.based ? ` (${auto.based} with your base résumé)` : ""}. ` : ""}{auto.note}</span></>}</p>
        <button type="button" className="jobs-button" data-primary="" onClick={start}>Start auto mode</button>
        <div className="auto-status"><BridgeStatusLine status={status} check={check} onSetUp={() => setSettingUp(true)} /></div>
      </>}
    {settingUp && <BridgeDialog onClose={() => { setSettingUp(false); check(); }} />}
    {auto.failed.length > 0 && <details className="auto-failed">
      <summary>{auto.failed.length === 1 ? "1 job" : `${auto.failed.length} jobs`} to do by hand</summary>
      <ul>{auto.failed.map((entry, index) => <li key={index}><b>{entry.title}</b>: {entry.why}</li>)}</ul>
    </details>}
  </div>;
}
