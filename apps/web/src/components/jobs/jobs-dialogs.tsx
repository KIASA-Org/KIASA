"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { InterviewKind, Job, Position, Resume } from "@/lib/jobs/types";
import { addDays } from "./jobs-format";

/** A form in a dialog, as the chat asks things: a title, the fields, Cancel and
 * the action. It says what went wrong, if anything, and stays open. */
export function FormDialog({ title, action, busyAction, children, onSubmit, onClose, wide }: {
  title: string; action: string; busyAction?: string; children: ReactNode; wide?: boolean;
  onSubmit: (form: FormData) => Promise<string | null>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
    box?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const failed = await onSubmit(new FormData(event.currentTarget));
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  };
  return <dialog ref={dialog} className="chat-dialog jobs-dialog" data-wide={wide || undefined} aria-label={title} onClose={onClose}>
    <form onSubmit={submit}>
      <p className="chat-dialog-title">{title}</p>
      <div className="jobs-form">{children}</div>
      {error && <p className="b-form-error" role="alert">{error}</p>}
      <div className="chat-dialog-actions">
        <button type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="chat-dialog-button" disabled={busy}>{busy ? busyAction ?? "Saving…" : action}</button>
      </div>
    </form>
  </dialog>;
}

export type InterviewForm = {
  day: string; time: string; minutes: number; kind: InterviewKind; stage: string; place: string; note: string;
  job: string | null; company: string; title: string;
};
const KINDS: { id: InterviewKind; label: string }[] = [
  { id: "video", label: "Video call" }, { id: "phone", label: "Phone call" }, { id: "technical", label: "Technical" }, { id: "onsite", label: "On site" }, { id: "other", label: "Other" },
];

/** Scheduling an interview: for a job (from its row), or chosen here among one's
 * jobs, or one from elsewhere. The time is in the team's time zone. */
export function InterviewDialog({ job, jobs, zone, today, onSave, onClose }: {
  job: Job | null; jobs?: Pick<Job, "id" | "title" | "company" | "url">[]; zone: string; today: string;
  onSave: (form: InterviewForm) => Promise<string | null>; onClose: () => void;
}) {
  const [which, setWhich] = useState(job?.id ?? jobs?.[0]?.id ?? "");
  return <FormDialog title={job ? `Interview: ${job.title ?? job.company ?? "this job"}` : "Add an interview"} action="Save interview" onClose={onClose} wide
    onSubmit={async form => {
      const text = (name: string) => String(form.get(name) ?? "").trim();
      const chosen = job?.id ?? (which === "elsewhere" ? null : which || null);
      if (!chosen && !text("company")) return "Say which company the interview is with.";
      return onSave({
        day: text("day"), time: text("time"), minutes: Number(text("minutes")) || 60, kind: text("kind") as InterviewKind,
        stage: text("stage"), place: text("place"), note: text("note"), job: chosen, company: text("company"), title: text("title"),
      });
    }}>
    {!job && jobs && <label className="chat-field"><span>Job</span>
      <select value={which} onChange={event => setWhich(event.target.value)}>
        {jobs.map(entry => <option key={entry.id} value={entry.id}>{[entry.title, entry.company].filter(Boolean).join(" · ") || entry.url}</option>)}
        <option value="elsewhere">Somewhere not on the list…</option>
      </select>
    </label>}
    {!job && (which === "elsewhere" || !jobs?.length) && <div className="jobs-form-pair">
      <label className="chat-field"><span>Company</span><input name="company" maxLength={120} required /></label>
      <label className="chat-field"><span>Role (optional)</span><input name="title" maxLength={200} /></label>
    </div>}
    <div className="jobs-form-pair">
      <label className="chat-field"><span>Date</span><input type="date" name="day" defaultValue={addDays(today, 1)} required /></label>
      <label className="chat-field"><span>Time ({zone})</span><input type="time" name="time" defaultValue="10:00" required /></label>
    </div>
    <div className="jobs-form-pair">
      <label className="chat-field"><span>Length</span>
        <select name="minutes" defaultValue="60">{[15, 30, 45, 60, 90, 120, 180].map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</option>)}</select>
      </label>
      <label className="chat-field"><span>Kind</span>
        <select name="kind" defaultValue="video">{KINDS.map(kind => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select>
      </label>
    </div>
    <label className="chat-field"><span>Stage (optional)</span><input name="stage" maxLength={80} placeholder="For example: first call, technical round 2" /></label>
    <label className="chat-field"><span>Link or place (optional)</span><input name="place" maxLength={500} placeholder="https://meet.google.com/… or an address" /></label>
    <label className="chat-field"><span>Note (optional)</span><textarea name="note" rows={2} maxLength={1000} /></label>
  </FormDialog>;
}

export type HiredForm = { company: string; title: string; salary: number; started: string | null };

/** "I got the job": what it is and pays a month; it counts once an admin confirms it. */
export function HiredDialog({ job, position, currency, onSave, onClose }: {
  job?: Pick<Job, "title" | "company"> | null; position?: Position | null; currency: string;
  onSave: (form: HiredForm) => Promise<string | null>; onClose: () => void;
}) {
  return <FormDialog title={position ? "Change this job" : job ? "You got the job" : "Add a job you got"} action={position ? "Save" : "Send for confirming"} onClose={onClose}
    onSubmit={async form => {
      const salary = Number(String(form.get("salary") ?? "").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(salary) || salary <= 0) return "Give the monthly salary as a number.";
      return onSave({ company: String(form.get("company") ?? "").trim(), title: String(form.get("title") ?? "").trim(), salary, started: String(form.get("started") ?? "") || null });
    }}>
    <div className="jobs-form-pair">
      <label className="chat-field"><span>Company</span><input name="company" defaultValue={position?.company ?? job?.company ?? ""} maxLength={120} required /></label>
      <label className="chat-field"><span>Role</span><input name="title" defaultValue={position?.title ?? job?.title ?? ""} maxLength={200} required /></label>
    </div>
    <div className="jobs-form-pair">
      <label className="chat-field"><span>Monthly salary ({currency})</span><input name="salary" inputMode="decimal" defaultValue={position?.monthly_salary ?? ""} required /></label>
      <label className="chat-field"><span>Start date (optional)</span><input type="date" name="started" defaultValue={position?.started_on ?? ""} /></label>
    </div>
    <p className="jobs-form-hint">It counts on the leaderboard once an admin confirms it. Changing it later asks them again.</p>
  </FormDialog>;
}

export type PaymentForm = { amount: number; paid: string; position: string | null; note: string };

/** Pay received: how much, when, and for which job; counted once an admin confirms it. */
export function PaymentDialog({ positions, currency, today, onSave, onClose }: {
  positions: Position[]; currency: string; today: string; onSave: (form: PaymentForm) => Promise<string | null>; onClose: () => void;
}) {
  return <FormDialog title="Pay received" action="Send for confirming" onClose={onClose}
    onSubmit={async form => {
      const amount = Number(String(form.get("amount") ?? "").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) return "Give the amount as a number.";
      return onSave({ amount, paid: String(form.get("paid") ?? today), position: String(form.get("position") ?? "") || null, note: String(form.get("note") ?? "").trim() });
    }}>
    <div className="jobs-form-pair">
      <label className="chat-field"><span>Amount ({currency})</span><input name="amount" inputMode="decimal" required /></label>
      <label className="chat-field"><span>Paid on</span><input type="date" name="paid" defaultValue={today} max={today} required /></label>
    </div>
    <label className="chat-field"><span>For the job</span>
      <select name="position" defaultValue={positions[0]?.id ?? ""}>
        {positions.map(position => <option key={position.id} value={position.id}>{position.title} · {position.company}</option>)}
        <option value="">Not one of these</option>
      </select>
    </label>
    <label className="chat-field"><span>Note (optional)</span><input name="note" maxLength={300} /></label>
    <p className="jobs-form-hint">It counts once an admin confirms it.</p>
  </FormDialog>;
}

export function NoteDialog({ note, onSave, onClose }: { note: string | null; onSave: (note: string) => Promise<string | null>; onClose: () => void }) {
  return <FormDialog title="Note on this job" action="Save note" onClose={onClose} onSubmit={form => onSave(String(form.get("note") ?? "").trim())}>
    <label className="chat-field"><span>Only you and admins see it</span><textarea name="note" rows={3} maxLength={500} defaultValue={note ?? ""} /></label>
  </FormDialog>;
}

export function ResumeDialog({ resumes, current, onSave, onClose }: {
  resumes: Resume[]; current: string | null; onSave: (resume: string | null) => Promise<string | null>; onClose: () => void;
}) {
  return <FormDialog title="Résumé used" action="Save" onClose={onClose} onSubmit={form => onSave(String(form.get("resume") ?? "") || null)}>
    <label className="chat-field"><span>Which résumé went with this application</span>
      <select name="resume" defaultValue={current ?? ""}>
        {resumes.map(resume => <option key={resume.id} value={resume.id}>{resume.title}</option>)}
        <option value="">None of these</option>
      </select>
    </label>
  </FormDialog>;
}
