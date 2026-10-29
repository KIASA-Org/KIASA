"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardRow, Job, JobStatus, JobsMe, Plan, Resume } from "@/lib/jobs/types";
import { ArrowLeft, Search } from "../site/icons";
import { addDays, dayName } from "./jobs-format";
import { PlanStrip } from "./jobs-plans";
import { Pager, usePages } from "./jobs-pager";
import { JobRow, type JobActions } from "./jobs-row";

type Filter = "todo" | "applied" | "skipped" | "all";
const FILTERS: { id: Filter; label: string }[] = [{ id: "todo", label: "To do" }, { id: "applied", label: "Applied" }, { id: "skipped", label: "Skipped" }, { id: "all", label: "All" }];
const matches = (job: Pick<Job, "title" | "company" | "location" | "url">, words: string[]) =>
  words.every(word => `${job.title ?? ""} ${job.company ?? ""} ${job.location ?? ""} ${job.url}`.toLowerCase().includes(word));

/** A member's day: their plan, then the day's jobs to work through, newest
 * first. The résumé chosen here goes with each "Applied". Earlier days are a
 * click back, to catch up. */
export function TodayView({ me, zone, today, day, jobs, loading, resumes, plans, mine, currency, act, onDay, onResumes }: {
  me: JobsMe; zone: string; today: string; day: string; jobs: Job[]; loading: boolean; resumes: Resume[]; plans: Plan[];
  mine: BoardRow | null; currency: string; act: JobActions; onDay: (day: string | null) => void; onResumes?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("todo");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const resume = resumes.some(entry => entry.id === picked) ? picked : (resumes.find(entry => entry.is_default) ?? resumes[0])?.id ?? null;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const done = jobs.filter(job => job.status).length;
  const inFilter = (job: Job, id: Filter) => id === "todo" ? !job.status : id === "applied" ? !!job.status && job.status !== "skipped" : id === "skipped" ? job.status === "skipped" : true;
  const count = (id: Filter) => jobs.filter(job => inFilter(job, id)).length;
  // A job marked here stays in sight in this list (with its new status) until
  // the list changes, so a click made by mistake is put right from its dropdown.
  const view = `${filter}|${day}`;
  const [kept, setKept] = useState<{ view: string; ids: string[] }>({ view: "", ids: [] });
  const keep = (id: string) => setKept(current => ({ view, ids: current.view === view ? [...current.ids.filter(other => other !== id), id] : [id] }));
  const here: JobActions = {
    ...act,
    apply: async (job, chosen) => { keep(job.id); await act.apply(job, chosen); },
    status: async (job, status) => { keep(job.id); await act.status(job, status); },
    undo: async job => { keep(job.id); await act.undo(job); },
    interview: async (job, form) => { if (job) keep(job.id); return act.interview(job, form); },
    hired: async (job, form) => { keep(job.id); return act.hired(job, form); },
  };
  const stays = kept.view === view ? kept.ids : [];
  const shown = jobs.filter(job => (inFilter(job, filter) || stays.includes(job.id)) && matches(job, words));
  // Twenty at a time; back to the first page when the day, the filter or the search changes.
  const paging = usePages(shown, 20, `${filter}|${day}|${words.join(" ")}`);
  const top = useRef<HTMLElement>(null);

  return <div className="jobs-view">
    {me.member && <PlanStrip me={me} plans={plans} mine={mine} today={today} />}
    <section className="jobs-card" aria-labelledby="jobs-day-title" ref={top}>
      <div className="jobs-card-head">
        <div className="jobs-day-nav">
          <button type="button" className="chat-icon" aria-label="The day before" onClick={() => onDay(addDays(day, -1))}><ArrowLeft /></button>
          <h2 id="jobs-day-title" className="jobs-card-title">{dayName(day, today)}&apos;s jobs</h2>
          <button type="button" className="chat-icon jobs-next" aria-label="The day after" disabled={day >= today} onClick={() => onDay(addDays(day, 1) >= today ? null : addDays(day, 1))}><ArrowLeft /></button>
          {day !== today && <button type="button" className="chat-pill" onClick={() => onDay(null)}>Today</button>}
        </div>
        <p className="jobs-card-sub">{jobs.length ? `${done} of ${jobs.length} done` : ""}</p>
      </div>
      {jobs.length > 0 && <div className="jobs-progress" aria-hidden="true"><span style={{ width: `${(done / jobs.length) * 100}%` }} /></div>}
      <div className="jobs-toolbar">
        <label className="chat-search jobs-search">
          <Search />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the day's jobs" aria-label="Search the day's jobs" />
        </label>
        <div className="jobs-filters" role="group" aria-label="Show">
          {FILTERS.map(entry => <button key={entry.id} type="button" className="jobs-filter" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
            {entry.label} <span>{count(entry.id)}</span>
          </button>)}
        </div>
        {resumes.length > 0
          ? <label className="jobs-resume-pick"><span>Applying with</span>
            <select value={resume ?? ""} onChange={event => setPicked(event.target.value || null)}>
              {resumes.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
              <option value="">No résumé</option>
            </select>
          </label>
          : me.member && onResumes && <button type="button" className="chat-pill" onClick={onResumes}>Add your résumé</button>}
      </div>
      <ul className="jobs-list" aria-busy={loading || undefined} aria-label={`${dayName(day, today)}'s jobs`}>
        {paging.items.map(job => <JobRow key={job.id} job={job} zone={zone} resumes={resumes} resume={resume} currency={currency} today={today} act={here} />)}
      </ul>
      <Pager pages={paging} label={`Pages of ${dayName(day, today).toLowerCase()}'s jobs`} top={top} />
      {!loading && !shown.length && <p className="jobs-empty-line">
        {!jobs.length ? day === today ? "No jobs yet today. They appear here the moment an admin posts them." : `No jobs were posted ${dayName(day, today).toLowerCase() === "yesterday" ? "yesterday" : `on ${dayName(day, today)}`}.`
          : words.length ? `No job of the day matches “${query.trim()}”.`
            : filter === "todo" ? "Nothing left to do: every job of the day has a status." : "None here."}
      </p>}
      {loading && <p className="jobs-empty-line">Loading…</p>}
    </section>
  </div>;
}

type MineFilter = "active" | "applied" | "hired" | "rejected" | "all";
const MINE: { id: MineFilter; label: string }[] = [
  { id: "active", label: "Interviews & offers" }, { id: "applied", label: "Waiting to hear" }, { id: "hired", label: "Hired" }, { id: "rejected", label: "Rejected" }, { id: "all", label: "All" },
];
const PAGE = 50;
type MineRow = { status: JobStatus; applied_at: string | null; resume_id: string | null; note: string | null; job: Omit<Job, "status" | "applied_at" | "resume_id" | "my_note" | "applied"> | null };

/** Every job a member has applied to, across all days, the latest first, by
 * status: interviews and offers first, as they need doing; fifty at a time. */
export function MyJobs({ me, supabase, zone, today, resumes, currency, act, version }: {
  me: JobsMe; supabase: SupabaseClient; zone: string; today: string; resumes: Resume[]; currency: string; act: JobActions; version: number;
}) {
  const [rows, setRows] = useState<Job[] | null>(null);
  const [filter, setFilter] = useState<MineFilter>("active");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    let stopped = false;
    void supabase.from("applications").select("status, applied_at, resume_id, note, job:jobs(id, url, title, company, location, note, posted_at, posted_by)")
      .eq("user_id", me.id).neq("status", "skipped").order("updated_at", { ascending: false }).limit(1000)
      .then(({ data }) => {
        if (stopped) return;
        setRows(((data ?? []) as unknown as MineRow[]).filter(row => row.job).map(row => ({
          ...row.job!, status: row.status, applied_at: row.applied_at, resume_id: row.resume_id, my_note: row.note, applied: 0,
        })));
      });
    return () => { stopped = true; };
  }, [supabase, me.id, version]);

  // Changes show here at once; the list is asked for again behind them.
  const patch = (id: string, change: Partial<Job> | null) => setRows(current => current && (change ? current.map(row => row.id === id ? { ...row, ...change } : row) : current.filter(row => row.id !== id)));
  const local: JobActions = {
    ...act,
    status: async (job, status) => { patch(job.id, { status }); await act.status(job, status); },
    undo: async job => { patch(job.id, null); await act.undo(job); },
    note: async (job, note) => { const failed = await act.note(job, note); if (!failed) patch(job.id, { my_note: note || null }); return failed; },
    resume: async (job, resume) => { const failed = await act.resume(job, resume); if (!failed) patch(job.id, { resume_id: resume }); return failed; },
  };
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = rows ?? [];
  const fits = (job: Job, id: MineFilter) => id === "all" || (id === "active" ? job.status === "interview" || job.status === "offer" : job.status === id);
  const shown = all.filter(job => fits(job, filter) && matches(job, words));

  return <div className="jobs-view">
    <section className="jobs-card" aria-labelledby="jobs-mine-title">
      <div className="jobs-card-head">
        <h2 id="jobs-mine-title" className="jobs-card-title">My jobs</h2>
        <p className="jobs-card-sub">{rows ? `${all.length} applied to` : ""}</p>
      </div>
      <div className="jobs-toolbar">
        <label className="chat-search jobs-search">
          <Search />
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE); }} placeholder="Search my jobs" aria-label="Search my jobs" />
        </label>
        <div className="jobs-filters" role="group" aria-label="Show">
          {MINE.map(entry => <button key={entry.id} type="button" className="jobs-filter" aria-pressed={filter === entry.id} onClick={() => { setFilter(entry.id); setLimit(PAGE); }}>
            {entry.label} <span>{all.filter(job => fits(job, entry.id)).length}</span>
          </button>)}
        </div>
      </div>
      <ul className="jobs-list" aria-label="My jobs">
        {shown.slice(0, limit).map(job => <JobRow key={job.id} job={job} zone={zone} resumes={resumes} resume={job.resume_id} currency={currency} today={today} act={local} count={false} posted={false} />)}
      </ul>
      {shown.length > limit && <div className="jobs-more-row">
        <button type="button" className="jobs-button" onClick={() => setLimit(value => value + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</button>
        <span className="jobs-hint">{shown.length - limit} not shown yet</span>
      </div>}
      {!rows && <p className="jobs-empty-line">Loading…</p>}
      {rows && !shown.length && <p className="jobs-empty-line">{all.length
        ? words.length ? `No job here matches “${query.trim()}”.` : filter === "active" ? "No interviews or offers right now. Jobs move here when you mark them Interview or Offer." : "None here."
        : "Nothing yet: jobs you mark Applied gather here, with their status."}</p>}
    </section>
  </div>;
}
