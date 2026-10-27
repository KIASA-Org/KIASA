"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Interview, InterviewOutcome, Job, JobsMe, TeamPerson } from "@/lib/jobs/types";
import { Avatar } from "../site/avatar";
import { ArrowLeft, Plus } from "../site/icons";
import { InterviewDialog, type InterviewForm } from "./jobs-dialogs";
import { addDays, clockIn, dayName, initialsOf, instantIn, partsIn, shortDay, weekStart, weekdayOf } from "./jobs-format";

const HOUR = 52;
const OUTCOMES: { id: InterviewOutcome; label: string }[] = [
  { id: "scheduled", label: "Scheduled" }, { id: "done", label: "Done" }, { id: "passed", label: "Passed" }, { id: "failed", label: "Not passed" }, { id: "cancelled", label: "Cancelled" },
];
const KIND: Record<Interview["kind"], string> = { video: "Video call", phone: "Phone call", technical: "Technical", onsite: "On site", other: "Interview" };
const whatOf = (interview: Interview) => [interview.job?.title ?? interview.title, interview.job?.company ?? interview.company].filter(Boolean).join(" · ") || "Interview";

/** Interviews on a week's calendar, live: a member's own, or for an admin
 * everyone's (or one member's). Each opens to its details and outcome. */
export function CalendarView({ me, supabase, zone, today, team, version, onInterview }: {
  me: JobsMe; supabase: SupabaseClient; zone: string; today: string; team: TeamPerson[]; version: number;
  onInterview: (job: Job | null, form: InterviewForm) => Promise<string | null>;
}) {
  const [week, setWeek] = useState<string | null>(null);
  const start = week ?? weekStart(today);
  const [interviews, setInterviews] = useState<Interview[] | null>(null);
  const [who, setWho] = useState<string>("all");
  const [adding, setAdding] = useState<Pick<Job, "id" | "title" | "company" | "url">[] | null>(null);
  const [open, setOpen] = useState<Interview | null>(null);
  const [local, setLocal] = useState(0);
  useEffect(() => {
    let stopped = false;
    void supabase.from("interviews").select("*, job:jobs(title, company, url)")
      .gte("starts_at", instantIn(zone, start, "00:00")).lt("starts_at", instantIn(zone, addDays(start, 7), "00:00")).order("starts_at")
      .then(({ data }) => { if (!stopped) setInterviews((data ?? []) as Interview[]); });
    return () => { stopped = true; };
  }, [supabase, zone, start, version, local]);

  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const shown = (interviews ?? []).filter(interview => who === "all" || interview.user_id === who);
  const placed = shown.map(interview => ({ interview, ...partsIn(zone, interview.starts_at) }));
  const first = Math.min(8, ...placed.map(entry => entry.hour));
  const last = Math.max(20, ...placed.map(entry => Math.min(24, Math.ceil(entry.hour + (entry.minute + entry.interview.minutes) / 60))));
  const person = (id: string) => team.find(entry => entry.id === id);
  const startAdding = async () => {
    const { data } = await supabase.from("applications").select("job:jobs(id, title, company, url)").eq("user_id", me.id).neq("status", "skipped")
      .order("updated_at", { ascending: false }).limit(200);
    setAdding(((data ?? []) as unknown as { job: Pick<Job, "id" | "title" | "company" | "url"> | null }[]).map(row => row.job).filter((job): job is Pick<Job, "id" | "title" | "company" | "url"> => !!job));
  };

  return <div className="jobs-view">
    <section className="jobs-card" aria-labelledby="jobs-calendar-title">
      <div className="jobs-card-head">
        <div className="jobs-day-nav">
          <button type="button" className="chat-icon" aria-label="The week before" onClick={() => setWeek(addDays(start, -7))}><ArrowLeft /></button>
          <h2 id="jobs-calendar-title" className="jobs-card-title">{start === weekStart(today) ? "This week" : `Week of ${shortDay(start)}`}</h2>
          <button type="button" className="chat-icon jobs-next" aria-label="The week after" onClick={() => setWeek(addDays(start, 7) === weekStart(today) ? null : addDays(start, 7))}><ArrowLeft /></button>
          {start !== weekStart(today) && <button type="button" className="chat-pill" onClick={() => setWeek(null)}>This week</button>}
        </div>
        <div className="jobs-calendar-tools">
          {me.admin && <label className="jobs-resume-pick"><span>Showing</span>
            <select value={who} onChange={event => setWho(event.target.value)}>
              <option value="all">Every member</option>
              {team.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>}
          {me.member && <button type="button" className="jobs-button" data-primary="" onClick={() => void startAdding()}><Plus /> Add an interview</button>}
        </div>
      </div>
      <p className="jobs-card-sub">{interviews ? `${shown.length === 1 ? "1 interview" : `${shown.length} interviews`} this week · times in ${zone}` : "Loading…"}</p>

      <div className="jobs-week" style={{ ["--hours" as string]: last - first }}>
        <div className="jobs-week-head" aria-hidden="true">
          <span />
          {days.map(day => <span key={day} data-today={day === today || undefined}><b>{weekdayOf(day)}</b> {day.slice(8).replace(/^0/, "")}</span>)}
        </div>
        <div className="jobs-week-body" style={{ height: (last - first) * HOUR }}>
          <div className="jobs-week-hours" aria-hidden="true">
            {Array.from({ length: last - first }, (_, index) => <span key={index} style={{ top: index * HOUR }}>{String(first + index).padStart(2, "0")}:00</span>)}
          </div>
          {days.map(day => {
            const mine = placed.filter(entry => entry.day === day).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
            // Side by side where they overlap.
            const lanes: number[] = [];
            const laid = mine.map(entry => {
              const begin = entry.hour * 60 + entry.minute, end = begin + entry.interview.minutes;
              let lane = lanes.findIndex(free => free <= begin);
              if (lane < 0) { lane = lanes.length; lanes.push(end); } else lanes[lane] = end;
              return { ...entry, begin, lane };
            });
            return <div key={day} className="jobs-week-day" data-today={day === today || undefined} aria-label={dayName(day, today)}>
              {laid.map(entry => {
                const height = Math.max(24, entry.interview.minutes / 60 * HOUR - 3);
                const who = person(entry.interview.user_id)?.name ?? "A member";
                // A short one keeps to a line: its time, and who (for an admin) or what.
                const short = height < 40;
                return <button key={entry.interview.id} type="button" className="jobs-event" data-outcome={entry.interview.outcome} data-short={short || undefined}
                  style={{
                    top: (entry.begin - first * 60) / 60 * HOUR, height,
                    left: `calc(${(entry.lane / Math.max(1, lanes.length)) * 100}% + 2px)`, width: `calc(${100 / Math.max(1, lanes.length)}% - 4px)`,
                  }}
                  aria-label={`${clockIn(zone, entry.interview.starts_at)}, ${whatOf(entry.interview)}${me.admin ? `, ${who}` : ""}`}
                  onClick={() => setOpen(entry.interview)}>
                  <span className="jobs-event-time">{clockIn(zone, entry.interview.starts_at)}</span>
                  {short && me.admin
                    ? <span className="jobs-event-what">{who}</span>
                    : <span className="jobs-event-what">{whatOf(entry.interview)}</span>}
                  {me.admin && !short && <span className="jobs-event-who">{who}</span>}
                </button>;
              })}
            </div>;
          })}
        </div>
      </div>

      <ol className="jobs-agenda" aria-label="This week's interviews">
        {days.map(day => {
          const mine = placed.filter(entry => entry.day === day);
          return <li key={day} data-today={day === today || undefined}>
            <p className="jobs-agenda-day">{dayName(day, today)}</p>
            {mine.length ? <ul>{mine.map(entry => <li key={entry.interview.id}>
              <button type="button" className="jobs-agenda-item" data-outcome={entry.interview.outcome} onClick={() => setOpen(entry.interview)}>
                <span className="jobs-event-time">{clockIn(zone, entry.interview.starts_at)}</span>
                <span>{whatOf(entry.interview)}{me.admin && ` — ${person(entry.interview.user_id)?.name ?? "a member"}`}</span>
              </button>
            </li>)}</ul> : <p className="jobs-quiet">No interviews</p>}
          </li>;
        })}
      </ol>
    </section>
    {adding && <InterviewDialog job={null} jobs={adding} zone={zone} today={today} onClose={() => setAdding(null)}
      onSave={async form => { const failed = await onInterview(form.job ? { id: form.job } as Job : null, form); if (!failed) setLocal(value => value + 1); return failed; }} />}
    {open && <InterviewCard interview={open} me={me} zone={zone} today={today} person={person(open.user_id)} supabase={supabase}
      onClose={() => setOpen(null)} onChanged={() => setLocal(value => value + 1)} />}
  </div>;
}

/** One interview: what, when, where; its outcome a click away; removable by its member or an admin. */
function InterviewCard({ interview, me, zone, today, person, supabase, onClose, onChanged }: {
  interview: Interview; me: JobsMe; zone: string; today: string; person: TeamPerson | undefined; supabase: SupabaseClient;
  onClose: () => void; onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [outcome, setOutcome] = useState(interview.outcome);
  const [error, setError] = useState("");
  useEffect(() => { const box = dialog.current; if (box && !box.open) box.showModal(); }, []);
  const when = partsIn(zone, interview.starts_at);
  const link = interview.place && /^https?:\/\//i.test(interview.place) ? interview.place : null;
  const set = async (next: InterviewOutcome) => {
    setOutcome(next);
    const { error: failed } = await supabase.from("interviews").update({ outcome: next }).eq("id", interview.id);
    if (failed) { setOutcome(interview.outcome); setError("That did not save. Please try again."); } else onChanged();
  };
  const remove = async () => {
    const { error: failed } = await supabase.from("interviews").delete().eq("id", interview.id);
    if (failed) return setError("That did not work. Please try again.");
    onChanged();
    onClose();
  };
  return <dialog ref={dialog} className="chat-dialog jobs-dialog" aria-label={whatOf(interview)} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <p className="chat-dialog-title">{whatOf(interview)}</p>
    {person && me.admin && <p className="jobs-person jobs-card-who"><Avatar initials={initialsOf(person.name)} photo={person.photo} className="jobs-avatar" />{person.name}</p>}
    <dl className="jobs-facts">
      <div><dt>When</dt><dd>{dayName(when.day, today)}, {clockIn(zone, interview.starts_at)} · {interview.minutes < 60 ? `${interview.minutes} min` : `${interview.minutes / 60} h`} ({zone})</dd></div>
      <div><dt>Kind</dt><dd>{KIND[interview.kind]}{interview.stage ? ` · ${interview.stage}` : ""}</dd></div>
      {interview.place && <div><dt>Where</dt><dd>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{link}</a> : interview.place}</dd></div>}
      {interview.job?.url && <div><dt>The job</dt><dd><a href={interview.job.url} target="_blank" rel="noopener noreferrer">Open the posting</a></dd></div>}
      {interview.note && <div><dt>Note</dt><dd>{interview.note}</dd></div>}
    </dl>
    <div className="jobs-filters" role="group" aria-label="Outcome">
      {OUTCOMES.map(entry => <button key={entry.id} type="button" className="jobs-filter" aria-pressed={outcome === entry.id} onClick={() => void set(entry.id)}>{entry.label}</button>)}
    </div>
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" data-danger="" onClick={() => void remove()}>Remove</button>
      <button type="button" className="chat-dialog-button" onClick={onClose} autoFocus>Close</button>
    </div>
  </dialog>;
}
