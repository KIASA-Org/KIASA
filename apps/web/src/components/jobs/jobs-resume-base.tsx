"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobsMe } from "@/lib/jobs/types";
import { checkGenerated, importPrompt, saveBaseResume, saveTailored, textForJob, type BaseStatus } from "@/lib/resume/actions";
import { parseImportedProfile } from "@/lib/resume/import-answer";
import { emptyProfile } from "@/lib/resume/profile-form";
import { ProfileSchema, type Profile } from "@/lib/resume/schema";
import { Confirm } from "../chat/chat-dialog";
import { Download, Pencil } from "../site/icons";
import { dayName, partsIn } from "./jobs-format";
import { CopyButton, ReportLists, downloadPdf } from "./jobs-resume-parts";
import { ResumeEditor } from "./jobs-resume-editor";

type Base = { profile: Profile; status: BaseStatus; updated_at: string };
type Tailored = { job_id: string; updated_at: string; edited: boolean; jobs: { title: string | null; company: string | null; url: string } | null };
type Posting = { id: string; title: string | null; company: string | null };
type Mode =
  | { kind: "edit"; profile: Profile; status: BaseStatus; banner?: ReactNode }
  | { kind: "tailored"; job: Tailored; profile: Profile }
  | { kind: "import" } | { kind: "generate" } | null;

const HOW: Record<BaseStatus, string> = { typed: "Typed in", imported: "Imported from your PDF", generated: "Written with the init prompt" };
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A member's base résumé (the one every job's résumé is made from), and the
 * résumés made for jobs. Made once: typed in, imported from a PDF they have
 * (with the import prompt, in a chat), or written fuller with the init prompt
 * for a kind of job. For each job of the day, "Tailor résumé" does the rest. */
export function BaseResume({ me, supabase, zone, today, onEditing }: { me: JobsMe; supabase: SupabaseClient; zone: string; today: string; onEditing?: (editing: boolean) => void }) {
  const [base, setBase] = useState<Base | null | undefined>(undefined);
  const [tailored, setTailored] = useState<Tailored[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [said, setSaid] = useState("");
  const [removing, setRemoving] = useState<Tailored | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [found, made] = await Promise.all([
      supabase.from("resume_profiles").select("profile, status, updated_at").eq("user_id", me.id).maybeSingle(),
      supabase.from("tailored_resumes").select("job_id, updated_at, edited, jobs(title, company, url)").eq("user_id", me.id).order("updated_at", { ascending: false }).limit(100),
    ]);
    const parsed = ProfileSchema.safeParse(found.data?.profile);
    return {
      base: parsed.success ? { profile: parsed.data, status: found.data!.status as BaseStatus, updated_at: found.data!.updated_at as string } : null,
      tailored: (made.data ?? []) as unknown as Tailored[],
    };
  }, [supabase, me.id]);
  const load = useCallback(() => fetchAll().then(got => { setBase(got.base); setTailored(got.tailored); }), [fetchAll]);
  useEffect(() => {
    let stopped = false;
    void fetchAll().then(got => { if (!stopped) { setBase(got.base); setTailored(got.tailored); } });
    return () => { stopped = true; };
  }, [fetchAll]);
  const editing = mode?.kind === "edit" || mode?.kind === "tailored";
  useEffect(() => { onEditing?.(editing); }, [editing, onEditing]);

  const pdf = async (query: string, key: string) => {
    setPrinting(key);
    setSaid("");
    const failed = await downloadPdf(query);
    setPrinting(null);
    if (failed) setSaid(failed);
  };
  const editTailored = async (job: Tailored) => {
    const { data } = await supabase.from("tailored_resumes").select("profile").eq("job_id", job.job_id).eq("user_id", me.id).maybeSingle();
    const parsed = ProfileSchema.safeParse(data?.profile);
    if (parsed.success) setMode({ kind: "tailored", job, profile: parsed.data });
  };
  const keepBase = (status: BaseStatus) => async (profile: Profile) => {
    const { errors } = await saveBaseResume(profile, status);
    if (errors?.length) return errors;
    setMode(null);
    setSaid("Your base résumé is saved. Every job's résumé starts from it.");
    await load();
    return null;
  };

  if (mode?.kind === "edit") return <ResumeEditor initial={mode.profile} title="Your base résumé" banner={mode.banner} saveLabel="Save base résumé"
    note="Each job's résumé is made from this one." onSave={keepBase(mode.status)} onBack={() => setMode(null)} />;
  if (mode?.kind === "tailored") return <ResumeEditor initial={mode.profile} title={`Résumé for ${[mode.job.jobs?.title, mode.job.jobs?.company].filter(Boolean).join(" at ") || "this job"}`}
    saveLabel="Save this résumé" note="Only this job's résumé changes; your base résumé stays as it is."
    onSave={async profile => {
      const { errors } = await saveTailored(mode.job.job_id, profile);
      if (errors?.length) return errors;
      setMode(null);
      setSaid("Saved. Its PDF is made from what you saved.");
      await load();
      return null;
    }} onBack={() => setMode(null)} />;

  const roles = base?.profile.experience.length ?? 0;
  const skills = base?.profile.skills.reduce((sum, group) => sum + group.skills.length, 0) ?? 0;
  return <>
    <section className="jobs-card resume-base" aria-labelledby="resume-base-title">
      <h2 id="resume-base-title" className="jobs-card-title">Your base résumé</h2>
      <p className="jobs-card-sub">Made once. For each job of the day, <b>Tailor résumé</b> copies the job&apos;s description, this résumé and the tailoring prompt for ChatGPT; paste its answer back and you get a PDF made for that job.</p>
      {base === undefined ? <p className="jobs-empty-line">Loading…</p> : base ? <div className="resume-base-now">
        <div>
          <p className="jobs-ledger-title">{base.profile.info.name}{base.profile.info.title && <span className="resume-headline"> · {base.profile.info.title}</span>}</p>
          <p className="jobs-row-meta">
            <span>{plural(roles, "role")}</span><span>{plural(base.profile.education.length, "school")}</span><span>{plural(skills, "skill")}</span>
            <span>{HOW[base.status]}</span><span>Saved {dayName(partsIn(zone, base.updated_at).day, today)}</span>
          </p>
        </div>
        <div className="jobs-row-actions">
          <button type="button" className="chat-pill" onClick={() => setMode({ kind: "edit", profile: base.profile, status: base.status })}><Pencil /> Edit</button>
          <button type="button" className="chat-pill" disabled={printing === "base"} onClick={() => void pdf("base=1", "base")}><Download /> {printing === "base" ? "Making…" : "PDF"}</button>
        </div>
      </div> : null}
      {base !== undefined && !mode && <div className="resume-ways">
        <button type="button" className="resume-way" onClick={() => setMode({ kind: "edit", profile: base?.profile ?? emptyProfile(), status: base?.status ?? "typed" })}>
          <b>{base ? "Change it by hand" : "Type it in"}</b><span>A form: contact, summary, roles, schools, skills, certifications.</span>
        </button>
        <button type="button" className="resume-way" onClick={() => setMode({ kind: "import" })}>
          <b>{base ? "Import a PDF again" : "Import your PDF"}</b><span>ChatGPT copies your résumé into the form, word for word; you check it.</span>
        </button>
        <button type="button" className="resume-way" disabled={!base} onClick={() => setMode({ kind: "generate" })}>
          <b>Write it fuller</b><span>{base ? "The init prompt writes a complete résumé from yours and a kind of job you want." : "After you have typed or imported yours."}</span>
        </button>
      </div>}
      {mode?.kind === "import" && <ImportFlow onBack={() => setMode(null)} onRead={(profile, warnings) => setMode({
        kind: "edit", profile, status: "imported",
        banner: <p className="resume-banner">Check it against your PDF, then save.{warnings.length ? ` ${warnings.join(" ")}` : ""}</p>,
      })} />}
      {mode?.kind === "generate" && base && <GenerateFlow supabase={supabase} onBack={() => setMode(null)} onChecked={(profile, notes) => setMode({ kind: "edit", profile, status: "generated", banner: notes })} />}
      {said && <p className="jobs-hint" role="status">{said}</p>}
    </section>

    {tailored.length > 0 && <section className="jobs-card" aria-labelledby="resume-made-title">
      <h2 id="resume-made-title" className="jobs-card-title">Made for jobs</h2>
      <p className="jobs-card-sub">Each made from your base résumé for one job. The PDF is made again each time, from what is kept.</p>
      <ul className="jobs-ledger">
        {tailored.map(job => <li key={job.job_id}>
          <div className="jobs-ledger-main">
            <p className="jobs-ledger-title">{job.jobs?.title ?? "A job"}{job.edited && <span className="jobs-you">Edited</span>}</p>
            <p className="jobs-row-meta">{job.jobs?.company && <span>{job.jobs.company}</span>}<span>{dayName(partsIn(zone, job.updated_at).day, today)}</span></p>
          </div>
          <div className="jobs-row-actions">
            <button type="button" className="chat-pill" disabled={printing === job.job_id} onClick={() => void pdf(`job=${job.job_id}`, job.job_id)}><Download /> {printing === job.job_id ? "Making…" : "PDF"}</button>
            <button type="button" className="chat-pill" onClick={() => void editTailored(job)}><Pencil /> Edit</button>
            <button type="button" className="chat-pill" data-danger="" onClick={() => setRemoving(job)}>Remove</button>
          </div>
        </li>)}
      </ul>
    </section>}
    {removing && <Confirm title="Remove this résumé?" confirm="Remove" text={<>The résumé made for “{removing.jobs?.title ?? "this job"}” goes. Your base résumé stays.</>}
      onClose={() => setRemoving(null)} onConfirm={async () => {
        const { error } = await supabase.from("tailored_resumes").delete().eq("job_id", removing.job_id).eq("user_id", me.id);
        if (error) return "That did not work. Please try again.";
        await load();
        return null;
      }} />}
  </>;
}

/** Importing a résumé the member has: the import prompt and their PDF in a new
 * chat; the answer, pasted back, fills the form for them to check. */
function ImportFlow({ onRead, onBack }: { onRead: (profile: Profile, warnings: string[]) => void; onBack: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => { void importPrompt().then(setText); }, []);
  const read = () => {
    const result = parseImportedProfile(answer);
    if (!result.ok) return setProblem(result.error);
    onRead(result.profile, result.warnings);
  };
  return <div className="resume-flow">
    <ol className="resume-steps">
      <li>Open a <b>new chat</b> in ChatGPT, and attach your résumé (the PDF).</li>
      <li>Copy this prompt, paste it as the message, and send it. {text ? <CopyButton text={text} label="Copy the import prompt" /> : <span className="jobs-hint">Loading…</span>}</li>
      <li>Copy the whole answer and paste it here.</li>
    </ol>
    <label className="chat-field"><span>ChatGPT&apos;s answer</span><textarea rows={8} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Paste the whole answer here." /></label>
    {problem && <p className="b-form-error" role="alert">{problem}</p>}
    <div className="resume-save">
      <button type="button" className="chat-pill" onClick={onBack}>Cancel</button>
      <button type="button" className="jobs-button" data-primary="" disabled={!answer.trim()} onClick={read}>Read it into the form</button>
    </div>
  </div>;
}

/** Writing the base résumé fuller with the init prompt, for one kind of job:
 * the prompt, a job with its description, and the résumé as it is; the answer
 * is checked (every fact put back as it was) and opens in the form. */
function GenerateFlow({ supabase, onChecked, onBack }: { supabase: SupabaseClient; onChecked: (profile: Profile, notes: ReactNode) => void; onBack: () => void }) {
  const [jobs, setJobs] = useState<Posting[] | null>(null);
  const [job, setJob] = useState("");
  const [description, setDescription] = useState("");
  const [needs, setNeeds] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabase.from("jobs").select("id, title, company").order("posted_at", { ascending: false }).limit(60).then(({ data }) => {
      const list = (data ?? []) as Posting[];
      setJobs(list);
      setJob(list[0]?.id ?? "");
    });
  }, [supabase]);
  const build = async () => {
    setBusy(true);
    setProblem("");
    const made = await textForJob(job, "init", needs ? description : undefined);
    setBusy(false);
    if (made.needsDescription) setNeeds(true);
    if (made.text) setText(made.text);
    else setProblem(made.error ?? "That did not work. Please try again.");
  };
  const check = async () => {
    setBusy(true);
    const result = await checkGenerated(answer);
    setBusy(false);
    if (!result.profile) return setProblem(result.errors.join(" ") || "That answer could not be used.");
    onChecked(result.profile, <div className="resume-banner">
      <p>Written by the init prompt. Your employers, dates and schools were kept as they are{result.repairs.length ? ` (${plural(result.repairs.length, "change")} put back)` : ""}. Read it through, then save.</p>
      <ReportLists report={{ applied: [], unmatched: [], rejected: [], warnings: result.warnings, errors: [] }} />
    </div>);
  };
  return <div className="resume-flow">
    <ol className="resume-steps">
      <li>Choose a job like the ones you want.
        <select className="resume-select" value={job} onChange={event => { setJob(event.target.value); setText(null); setNeeds(false); }} aria-label="A job like the ones you want">
          {(jobs ?? []).map(entry => <option key={entry.id} value={entry.id}>{[entry.title, entry.company].filter(Boolean).join(" · ") || "A job"}</option>)}
        </select>
      </li>
      {needs && <li><label className="chat-field"><span>Its description (from the job&apos;s page)</span><textarea rows={6} value={description} onChange={event => setDescription(event.target.value)} /></label></li>}
      <li>Copy the text for ChatGPT, and send it in a <b>new chat</b>. {text ? <CopyButton text={text} label="Copy for ChatGPT" /> : <button type="button" className="jobs-button" data-primary="" disabled={busy || !job} onClick={() => void build()}>{busy ? "Getting it…" : "Make the text"}</button>}</li>
      <li>Paste its whole answer here.</li>
    </ol>
    <label className="chat-field"><span>ChatGPT&apos;s answer</span><textarea rows={8} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Paste the whole answer here." /></label>
    {problem && <p className="b-form-error" role="alert">{problem}</p>}
    <div className="resume-save">
      <button type="button" className="chat-pill" onClick={onBack}>Cancel</button>
      <button type="button" className="jobs-button" data-primary="" disabled={busy || !answer.trim()} onClick={() => void check()}>{busy ? "Checking…" : "Check it"}</button>
    </div>
  </div>;
}

