"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { STATUS_LABELS, type Job, type JobStatus, type Resume } from "@/lib/jobs/types";
import { ArrowLeft, Check, ChevronDown, Close, Copy, More, NewTab, Pencil, Trash } from "../site/icons";
import { Menu, type MenuItem, type MenuPlace } from "../chat/chat-menu";
import { HiredDialog, InterviewDialog, NoteDialog, ResumeDialog, type HiredForm, type InterviewForm } from "./jobs-dialogs";
import { clockIn, linkLabel } from "./jobs-format";
import { useTailor } from "./jobs-tailor";

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
// Each status as its dropdown offers it: the two that ask for details say so.
const CHOICES: Record<JobStatus, string> = { ...STATUS_LABELS, interview: "Interview…", hired: "I got the job…", skipped: "Skipped (not a fit)" };

/** One job, as a member works through the day's list: its link opens in a new
 * tab, and "Applied" marks it at once (with the résumé chosen above the list).
 * Its status is a dropdown: beside "Applied" before, and the status itself
 * after, with every other step and "Not applied" for a click made by mistake.
 * Interview and Hired ask for their details. `count`: show how many on the team
 * have applied. */
export function JobRow({ job, zone, resumes, resume, currency, today, act, count = true, posted = true }: {
  job: Job; zone: string; resumes: Resume[]; resume: string | null; currency: string; today: string; act: JobActions; count?: boolean; posted?: boolean;
}) {
  const [menu, setMenu] = useState<{ at: MenuPlace; kind: "status" | "more" } | null>(null);
  const [asking, setAsking] = useState<"interview" | "hired" | "note" | "resume" | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const title = job.title ?? linkLabel(job.url);
  const used = resumes.find(entry => entry.id === job.resume_id);
  const tailor = useTailor();
  const tailored = !!tailor?.made.has(job.id);

  const choose = (status: JobStatus) => {
    if (status === job.status) return;
    if (status === "interview") return setAsking("interview");
    if (status === "hired") return setAsking("hired");
    // Applied from the dropdown, as from its button: with the résumé chosen above the list.
    if (status === "applied" && !job.status) return void act.apply(job, resume);
    void act.status(job, status);
  };
  const statuses: MenuItem[] = [
    ...(job.status ? [{ label: job.status === "skipped" ? "Not skipped: back to To do" : "Not applied: back to To do", icon: <ArrowLeft />, onSelect: () => void act.undo(job) }] : []),
    ...STEPS.map(step => ({
      label: CHOICES[step], checked: job.status === step,
      icon: job.status === step ? <Check /> : <span className="chat-menu-blank" aria-hidden="true" />,
      onSelect: () => choose(step),
    })),
  ];
  // A résumé made for this job: made again from here (its button copies its path).
  const again: MenuItem[] = tailor && tailored ? [{ label: "Tailor the résumé again…", icon: <Pencil />, onSelect: () => tailor.open(job) }] : [];
  const copying = tailor?.copying?.job === job.id ? tailor.copying.state : null;
  const more: MenuItem[] = job.status
    ? [
      ...again,
      { label: "Interview…", icon: <Pencil />, onSelect: () => setAsking("interview") },
      { label: "I got the job…", icon: <Check />, onSelect: () => setAsking("hired") },
      { label: job.my_note ? "Change note" : "Add a note", icon: <Pencil />, onSelect: () => setAsking("note") },
      ...(resumes.length ? [{ label: "Résumé used…", icon: <Pencil />, onSelect: () => setAsking("resume") }] : []),
      { label: job.status === "skipped" ? "Not skipped after all" : "Not applied after all", icon: <Trash />, danger: true, onSelect: () => void act.undo(job) },
    ]
    // (A note is kept with an application, so a job not yet marked has none.)
    : [
      ...again,
      { label: "Skip (not a fit)", icon: <Close />, onSelect: () => void act.status(job, "skipped") },
      { label: "Interview…", icon: <Pencil />, onSelect: () => setAsking("interview") },
    ];
  const open = (kind: "status" | "more") => (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ at: { x: box.right, y: box.bottom + 6, end: true }, kind });
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
        {tailored && <span className="jobs-tailored">Résumé made for it</span>}
      </p>
      {job.my_note && <p className="jobs-row-note">{job.my_note}</p>}
    </div>
    <div className="jobs-row-actions">
      {tailor && job.status !== "skipped" && (tailored
        ? <button type="button" className="chat-pill jobs-tailor" data-done="" disabled={copying === "busy"} onClick={() => tailor.copyPath(job)}
          aria-label={`Copy the path of your résumé for ${title}`} title="Copy the résumé file's whole path, to paste in the application's file box">
          {copying === "done" ? <Check /> : <Copy />} {copying === "busy" ? "Saving…" : copying === "done" ? "Path copied" : "Copy résumé path"}
        </button>
        : <button type="button" className="chat-pill jobs-tailor" onClick={() => tailor.open(job)} aria-label={`Tailor résumé: ${title}`}><Pencil /> Tailor résumé</button>)}
      {!job.status
        ? <>
          <a className="jobs-button" href={job.url} target="_blank" rel="noopener noreferrer">Open <NewTab /></a>
          <span className="jobs-split">
            <button type="button" className="jobs-button" data-primary="" onClick={() => void act.apply(job, resume)} aria-label={`Applied: ${title}`}>
              <Check /> Applied
            </button>
            <button type="button" className="jobs-button jobs-split-more" data-primary="" aria-label={`Other status for ${title}`}
              aria-haspopup="menu" aria-expanded={menu?.kind === "status"} onClick={open("status")}><ChevronDown /></button>
          </span>
        </>
        : <button type="button" className="jobs-status" data-status={job.status} aria-haspopup="menu" aria-expanded={menu?.kind === "status"}
          aria-label={`Status of ${title}: ${STATUS_LABELS[job.status]}. Change it`} onClick={open("status")}>
          {job.status === "applied" && <Check />}{STATUS_LABELS[job.status]}<ChevronDown />
        </button>}
      <button type="button" className="chat-icon jobs-more" aria-label={`More for ${title}`} aria-haspopup="menu" onClick={open("more")}><More /></button>
    </div>
    {menu && <Menu at={menu.at} items={menu.kind === "status" ? statuses : more} label={menu.kind === "status" ? `Status of ${title}` : `Job: ${title}`} onClose={closeMenu} />}
    {asking === "interview" && <InterviewDialog job={job} zone={zone} today={today} onSave={form => act.interview(job, form)} onClose={() => setAsking(null)} />}
    {asking === "hired" && <HiredDialog job={job} currency={currency} onSave={form => act.hired(job, form)} onClose={() => setAsking(null)} />}
    {asking === "note" && <NoteDialog note={job.my_note} onSave={note => act.note(job, note)} onClose={() => setAsking(null)} />}
    {asking === "resume" && <ResumeDialog resumes={resumes} current={job.resume_id} onSave={value => act.resume(job, value)} onClose={() => setAsking(null)} />}
  </li>;
}
