"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STATUS_LABELS, type Application, type Job, type TeamPerson } from "@/lib/jobs/types";
import { Avatar } from "../site/avatar";
import { ArrowLeft, Pencil, Search, Trash } from "../site/icons";
import { Confirm } from "../chat/chat-dialog";
import { Meter } from "./jobs-charts";
import { JobsBot } from "./jobs-bot";
import { JobrightBots } from "./jobs-jobright";
import { FormDialog } from "./jobs-dialogs";
import { addDays, clockIn, dayName, initialsOf, linkLabel } from "./jobs-format";
import { downloadPdf } from "./jobs-resume-parts";

/** The admins' job desk: the jobs bot, which takes the day's links as they are
 * pasted, the Jobright bot, which posts the jobs a KIASA computer saves from
 * Jobright, then the day's list with how far the team has got with each job, and
 * who is where. */
export function PostJobs({ supabase, realtime, zone, today, day, jobs, loading, team, onDay, version }: {
  supabase: SupabaseClient; realtime: { url: string; key: string }; zone: string; today: string; day: string; jobs: Job[]; loading: boolean; team: TeamPerson[];
  onDay: (day: string | null) => void; version: number;
}) {
  const [applications, setApplications] = useState<Pick<Application, "job_id" | "user_id" | "status">[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Job & { description: string | null }) | null>(null);
  // Who has a résumé made for which job (opened as a PDF from the Who list).
  const [tailored, setTailored] = useState<{ job_id: string; user_id: string }[]>([]);
  const [printing, setPrinting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Job | null>(null);

  const ids = jobs.map(job => job.id).join(",");
  useEffect(() => {
    if (!ids) return;
    let stopped = false;
    void supabase.from("applications").select("job_id, user_id, status").in("job_id", ids.split(",")).then(({ data }) => {
      if (!stopped) setApplications((data ?? []) as Pick<Application, "job_id" | "user_id" | "status">[]);
    });
    void supabase.from("tailored_resumes").select("job_id, user_id").in("job_id", ids.split(",")).then(({ data }) => {
      if (!stopped) setTailored((data ?? []) as { job_id: string; user_id: string }[]);
    });
    return () => { stopped = true; };
  }, [supabase, ids, version]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = jobs.filter(job => words.every(word => `${job.title ?? ""} ${job.company ?? ""} ${job.location ?? ""} ${job.url}`.toLowerCase().includes(word)));
  const of = (job: string) => applications.filter(row => row.job_id === job);

  return <div className="jobs-view">
    <JobsBot supabase={supabase} onPosted={() => onDay(null)} />
    <JobrightBots supabase={supabase} realtime={realtime} zone={zone} today={today} />

    <section className="jobs-card" aria-labelledby="jobs-desk-title">
      <div className="jobs-card-head">
        <div className="jobs-day-nav">
          <button type="button" className="chat-icon" aria-label="The day before" onClick={() => onDay(addDays(day, -1))}><ArrowLeft /></button>
          <h2 id="jobs-desk-title" className="jobs-card-title">{dayName(day, today)}&apos;s jobs</h2>
          <button type="button" className="chat-icon jobs-next" aria-label="The day after" disabled={day >= today} onClick={() => onDay(addDays(day, 1) >= today ? null : addDays(day, 1))}><ArrowLeft /></button>
          {day !== today && <button type="button" className="chat-pill" onClick={() => onDay(null)}>Today</button>}
        </div>
        <p className="jobs-card-sub">{jobs.length ? `${jobs.length} posted` : ""}</p>
      </div>
      <div className="jobs-toolbar">
        <label className="chat-search jobs-search">
          <Search />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the day's jobs" aria-label="Search the day's jobs" />
        </label>
      </div>
      <ul className="jobs-list" aria-busy={loading || undefined} aria-label={`${dayName(day, today)}'s jobs`}>
        {shown.map(job => {
          const rows = of(job.id);
          const applied = rows.filter(row => row.status !== "skipped").length;
          const tally = (["interview", "offer", "hired"] as const).map(status => [status, rows.filter(row => row.status === status).length] as const).filter(([, count]) => count > 0);
          const title = job.title ?? linkLabel(job.url);
          return <li key={job.id} className="jobs-row jobs-desk-row">
            <span className="jobs-logo" aria-hidden="true">{(job.company ?? title).trim()[0]?.toUpperCase() ?? "?"}</span>
            <div className="jobs-row-main">
              <a className="jobs-row-title" href={job.url} target="_blank" rel="noopener noreferrer">{title}</a>
              <p className="jobs-row-meta">
                {job.company && <span>{job.company}</span>}
                {job.location && <span>{job.location}</span>}
                <span>Posted {clockIn(zone, job.posted_at)}</span>
                {tally.map(([status, count]) => <span key={status} className="jobs-tally" data-status={status}>{count} {STATUS_LABELS[status].toLowerCase()}</span>)}
              </p>
              {open === job.id && <ul className="jobs-who" aria-label={`Who has done what with ${title}`}>
                {team.map(person => {
                  const row = rows.find(entry => entry.user_id === person.id);
                  return <li key={person.id}>
                    <Avatar initials={initialsOf(person.name)} photo={person.photo} className="jobs-avatar" who={person.id} />
                    <span>{person.name}</span>
                    <span className="jobs-chip" data-status={row?.status ?? "todo"}>{row ? STATUS_LABELS[row.status] : "Not yet"}</span>
                    {tailored.some(entry => entry.job_id === job.id && entry.user_id === person.id) && <button type="button" className="chat-pill jobs-who-resume"
                      disabled={printing === `${job.id}${person.id}`} onClick={async () => {
                        setPrinting(`${job.id}${person.id}`);
                        await downloadPdf(`job=${job.id}&user=${person.id}&inline=1`);
                        setPrinting(null);
                      }}>{printing === `${job.id}${person.id}` ? "Making…" : "Their résumé"}</button>}
                  </li>;
                })}
              </ul>}
            </div>
            <div className="jobs-row-actions">
              <Meter value={applied} target={team.length || null} label={`Applied to ${title}`} compact />
              <button type="button" className="chat-pill" aria-expanded={open === job.id} onClick={() => setOpen(open === job.id ? null : job.id)}>Who</button>
              <button type="button" className="chat-icon" aria-label={`Change ${title}`} title="Change" onClick={async () => {
                const { data } = await supabase.from("jobs").select("description").eq("id", job.id).maybeSingle();
                setEditing({ ...job, description: (data?.description as string | null) ?? null });
              }}><Pencil /></button>
              <button type="button" className="chat-icon" aria-label={`Remove ${title}`} title="Remove" onClick={() => setRemoving(job)}><Trash /></button>
            </div>
          </li>;
        })}
      </ul>
      {!loading && !shown.length && <p className="jobs-empty-line">{jobs.length ? `No job of the day matches “${query.trim()}”.` : day === today ? "Nothing posted yet today. Paste the links above." : `Nothing was posted on ${dayName(day, today)}.`}</p>}
      {loading && <p className="jobs-empty-line">Loading…</p>}
    </section>

    {editing && <FormDialog title="Change this job" action="Save" onClose={() => setEditing(null)} onSubmit={async form => {
      const text = (name: string) => String(form.get(name) ?? "").trim() || null;
      const { error } = await supabase.from("jobs").update({ title: text("title"), company: text("company"), location: text("location"), note: text("note"), description: text("description") }).eq("id", editing.id);
      return error ? "That did not save. Please try again." : null;
    }}>
      <label className="chat-field"><span>Title</span><input name="title" defaultValue={editing.title ?? ""} maxLength={200} /></label>
      <div className="jobs-form-pair">
        <label className="chat-field"><span>Company</span><input name="company" defaultValue={editing.company ?? ""} maxLength={120} /></label>
        <label className="chat-field"><span>Place</span><input name="location" defaultValue={editing.location ?? ""} maxLength={120} placeholder="Remote, Berlin…" /></label>
      </div>
      <label className="chat-field"><span>Note for the team (optional)</span><textarea name="note" rows={2} defaultValue={editing.note ?? ""} maxLength={500} /></label>
      <label className="chat-field"><span>Description (for the members&apos; tailored résumés)</span><textarea name="description" rows={8} defaultValue={editing.description ?? ""} maxLength={30000} placeholder="Read from the job's page, or brought by the Jobright bot. Paste it if it is missing." /></label>
    </FormDialog>}
    {removing && <Confirm title="Remove this job?" confirm="Remove"
      text={<>“{removing.title ?? linkLabel(removing.url)}” leaves everyone&apos;s list, with what the team has marked on it.</>}
      onClose={() => setRemoving(null)} onConfirm={async () => {
        const { error } = await supabase.from("jobs").delete().eq("id", removing.id);
        return error ? "That did not work. Please try again." : null;
      }} />}
  </div>;
}
