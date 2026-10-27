"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { STATUS_LABELS, type Job, type JobStatus, type Resume } from "@/lib/jobs/types";
import { Check, Close, More, NewTab, Pencil, Trash } from "../site/icons";
import { Menu, type MenuItem, type MenuPlace } from "../chat/chat-menu";
import { HiredDialog, InterviewDialog, NoteDialog, ResumeDialog, type HiredForm, type InterviewForm } from "./jobs-dialogs";
import { clockIn, linkLabel } from "./jobs-format";

/** What a member does with a job; each says what went wrong, if anything. */
export type JobActions = {
  apply: (job: Job, resume: string | null) => Promise<void>;
  status: (job: Job, status: JobStatus) => Promise<void>;
  undo: (job: Job) => Promise<void>;
  note: (job: Job, note: string) => Promise<string | null>;
  resume: (job: Job, resume: string | null) => Promise<string | null>;
  interview: (job: Job | null, form: InterviewForm) => Promise<string | null>;
  hired: (job: Job, form: HiredForm) => Promise<string | null>;
};

const STEPS: JobStatus[] = ["applied", "interview", "offer", "hired", "rejected", "skipped"];

/** One job, as a member works through the day's list: its link opens in a new
 * tab, "Applied" marks it at once (with the résumé chosen above the list), and
 * from then on its status is a click away; Interview and Hired ask for their
 * details. `count`: show how many on the team have applied. */
export function JobRow({ job, zone, resumes, resume, currency, today, act, count = true, posted = true }: {
  job: Job; zone: string; resumes: Resume[]; resume: string | null; currency: string; today: string; act: JobActions; count?: boolean; posted?: boolean;
}) {
  const [menu, setMenu] = useState<MenuPlace | null>(null);
  const [asking, setAsking] = useState<"interview" | "hired" | "note" | "resume" | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const title = job.title ?? linkLabel(job.url);
  const used = resumes.find(entry => entry.id === job.resume_id);

  const choose = (status: JobStatus) => {
    if (status === "interview") return setAsking("interview");
    if (status === "hired") return setAsking("hired");
    void act.status(job, status);
  };
  const items: MenuItem[] = job.status
    ? [
      { label: "Interview…", icon: <Pencil />, onSelect: () => setAsking("interview") },
      { label: "I got the job…", icon: <Check />, onSelect: () => setAsking("hired") },
      { label: job.my_note ? "Change note" : "Add a note", icon: <Pencil />, onSelect: () => setAsking("note") },
      ...(resumes.length ? [{ label: "Résumé used…", icon: <Pencil />, onSelect: () => setAsking("resume") }] : []),
      { label: job.status === "skipped" ? "Not skipped after all" : "Not applied after all", icon: <Trash />, danger: true, onSelect: () => void act.undo(job) },
    ]
    // (A note is kept with an application, so a job not yet marked has none.)
    : [
      { label: "Skip (not a fit)", icon: <Close />, onSelect: () => void act.status(job, "skipped") },
      { label: "Interview…", icon: <Pencil />, onSelect: () => setAsking("interview") },
    ];
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ x: box.right, y: box.bottom + 6, end: true });
  };

  return <li className="jobs-row" data-status={job.status ?? "todo"}>
    <span className="jobs-logo" aria-hidden="true">{(job.company ?? title).trim()[0]?.toUpperCase() ?? "?"}</span>
    <div className="jobs-row-main">
      <a className="jobs-row-title" href={job.url} target="_blank" rel="noopener noreferrer">{title}</a>
      <p className="jobs-row-meta">
        {job.company && <span>{job.company}</span>}
        {job.location && <span>{job.location}</span>}
        {posted && <span>Posted {clockIn(zone, job.posted_at)}</span>}
        {count && <span>{job.applied === 1 ? "1 on the team applied" : `${job.applied} on the team applied`}</span>}
        {used && job.status && job.status !== "skipped" && <span>With {used.title}</span>}
      </p>
      {job.my_note && <p className="jobs-row-note">{job.my_note}</p>}
    </div>
    <div className="jobs-row-actions">
      {!job.status
        ? <>
          <a className="jobs-button" href={job.url} target="_blank" rel="noopener noreferrer">Open <NewTab /></a>
          <button type="button" className="jobs-button" data-primary="" onClick={() => void act.apply(job, resume)} aria-label={`Applied: ${title}`}>
            <Check /> Applied
          </button>
        </>
        : <label className="jobs-status" data-status={job.status}>
          <span className="jobs-hidden">Status of {title}</span>
          <select value={job.status} onChange={event => choose(event.target.value as JobStatus)}>
            {STEPS.map(step => <option key={step} value={step}>{STATUS_LABELS[step]}</option>)}
          </select>
        </label>}
      <button type="button" className="chat-icon jobs-more" aria-label={`More for ${title}`} aria-haspopup="menu" onClick={openMenu}><More /></button>
    </div>
    {menu && <Menu at={menu} items={items} label={`Job: ${title}`} onClose={closeMenu} />}
    {asking === "interview" && <InterviewDialog job={job} zone={zone} today={today} onSave={form => act.interview(job, form)} onClose={() => setAsking(null)} />}
    {asking === "hired" && <HiredDialog job={job} currency={currency} onSave={form => act.hired(job, form)} onClose={() => setAsking(null)} />}
    {asking === "note" && <NoteDialog note={job.my_note} onSave={note => act.note(job, note)} onClose={() => setAsking(null)} />}
    {asking === "resume" && <ResumeDialog resumes={resumes} current={job.resume_id} onSave={value => act.resume(job, value)} onClose={() => setAsking(null)} />}
  </li>;
}
