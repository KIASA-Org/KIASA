"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardRow, JobSettings, JobsMe, Period, Plan, TeamPerson } from "@/lib/jobs/types";
import { Avatar } from "../site/avatar";
import { ArrowLeft } from "../site/icons";
import { Meter } from "./jobs-charts";
import { DAILY_GOAL, initialsOf, monthStart, nextPeriod, periodName, periodStart, planFor, weekStart } from "./jobs-format";

type Goal = { label: string; value: number; target: number | null };

/** A member's goals as their plan sets them, each against what they have done,
 * and the admins' notes for today, this week and this month. */
export function PlanStrip({ me, plans, mine, today }: { me: JobsMe; plans: Plan[]; mine: BoardRow | null; today: string }) {
  const day = planFor(plans, me.id, "day", today), week = planFor(plans, me.id, "week", weekStart(today)), month = planFor(plans, me.id, "month", monthStart(today));
  const all: Goal[] = [
    { label: "Applications today", value: mine?.apps_day ?? 0, target: day.applications ?? DAILY_GOAL },
    { label: "Interviews today", value: mine?.interviews_day ?? 0, target: day.interviews },
    { label: "Offers today", value: mine?.offers_day ?? 0, target: day.offers },
    { label: "Applications this week", value: mine?.apps_week ?? 0, target: week.applications },
    { label: "Interviews this week", value: mine?.interviews_week ?? 0, target: week.interviews },
    { label: "Offers this week", value: mine?.offers_week ?? 0, target: week.offers },
    { label: "Applications this month", value: mine?.apps_month ?? 0, target: month.applications },
    { label: "Interviews this month", value: mine?.interviews_month ?? 0, target: month.interviews },
    { label: "Offers this month", value: mine?.offers_month ?? 0, target: month.offers },
  ];
  const goals = all.filter((goal, index) => goal.target !== null || index === 0);
  const notes = [["Today", day.note], ["This week", week.note], ["This month", month.note]].filter((note): note is [string, string] => !!note[1]);
  return <section className="jobs-plan" aria-label="Your plan">
    <div className="jobs-plan-goals">
      {goals.map(goal => <div key={goal.label} className="jobs-goal">
        <p className="jobs-goal-label">{goal.label}</p>
        <Meter value={goal.value} target={goal.target} label={goal.label} />
      </div>)}
    </div>
    {notes.length > 0 && <ul className="jobs-plan-notes" aria-label="Notes from your admin">
      {notes.map(([period, text]) => <li key={period}><strong>{period}</strong><span>{text}</span></li>)}
    </ul>}
  </section>;
}

type Draft = { applications: string; interviews: string; offers: string; note: string };
const PERIODS: { id: Period; label: string }[] = [{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }];
const DONE: Record<Period, (row: BoardRow) => [number, number, number]> = {
  day: row => [row.apps_day, row.interviews_day, row.offers_day],
  week: row => [row.apps_week, row.interviews_week, row.offers_week],
  month: row => [row.apps_month, row.interviews_month, row.offers_month],
};
const asNumber = (text: string) => text.trim() === "" ? null : Math.max(0, Math.round(Number(text)));

/** The admins' planning desk: each member's targets and a note for a day, a
 * week or a month, typed in place; this period's progress beside them. Targets
 * carry on to later periods until changed. Below, the team's time zone and currency. */
export function PlansView({ supabase, team, plans, board, today, settings, onSettings, onSaved }: {
  supabase: SupabaseClient; team: TeamPerson[]; plans: Plan[]; board: BoardRow[]; today: string;
  settings: JobSettings; onSettings: (settings: JobSettings) => void; onSaved: () => void;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [start, setStart] = useState<string | null>(null);
  const shown = start ?? periodStart(period, today);
  const current = shown === periodStart(period, today);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState("");
  const key = (user: string) => `${user}|${period}|${shown}`;
  const draftOf = (user: string): Draft => {
    const made = drafts[key(user)];
    if (made) return made;
    const plan = planFor(plans, user, period, shown);
    const text = (value: number | null) => value === null ? "" : String(value);
    return { applications: text(plan.applications), interviews: text(plan.interviews), offers: text(plan.offers), note: plan.note ?? "" };
  };
  const edit = (user: string, change: Partial<Draft>) => setDrafts(current => ({ ...current, [key(user)]: { ...draftOf(user), ...change } }));
  const changed = team.filter(person => drafts[key(person.id)]);
  const [all, setAll] = useState<Draft>({ applications: "", interviews: "", offers: "", note: "" });

  const save = async () => {
    setSaving(true);
    setSaid("");
    const rows = changed.map(person => {
      const draft = draftOf(person.id);
      return { user_id: person.id, period, starts_on: shown, applications: asNumber(draft.applications), interviews: asNumber(draft.interviews), offers: asNumber(draft.offers), note: draft.note.trim() || null };
    });
    const { error } = await supabase.from("plans").upsert(rows, { onConflict: "user_id,period,starts_on" });
    setSaving(false);
    if (error) return setSaid("The plans could not be saved. Please try again.");
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([name]) => !rows.some(row => name === `${row.user_id}|${period}|${shown}`))));
    setSaid(`Saved for ${rows.length === 1 ? "1 member" : `${rows.length} members`}.`);
    onSaved();
  };
  const move = (count: number) => setStart(nextPeriod(period, shown, count) === periodStart(period, today) ? null : nextPeriod(period, shown, count));

  return <div className="jobs-view">
    <section className="jobs-card" aria-labelledby="jobs-plans-title">
      <div className="jobs-card-head">
        <h2 id="jobs-plans-title" className="jobs-card-title">Plans</h2>
        <div className="jobs-filters" role="group" aria-label="Period">
          {PERIODS.map(entry => <button key={entry.id} type="button" className="jobs-filter" aria-pressed={period === entry.id}
            onClick={() => { setPeriod(entry.id); setStart(null); }}>{entry.label}</button>)}
        </div>
      </div>
      <div className="jobs-day-nav">
        <button type="button" className="chat-icon" aria-label="Before" onClick={() => move(-1)}><ArrowLeft /></button>
        <p className="jobs-card-title jobs-period">{periodName(period, shown, today)}</p>
        <button type="button" className="chat-icon jobs-next" aria-label="After" onClick={() => move(1)}><ArrowLeft /></button>
        {!current && <button type="button" className="chat-pill" onClick={() => setStart(null)}>{period === "day" ? "Today" : period === "week" ? "This week" : "This month"}</button>}
      </div>
      <p className="jobs-hint">Targets carry on to later {period === "day" ? "days" : period === "week" ? "weeks" : "months"} until you change them; a note is for {period === "day" ? "that day" : period === "week" ? "that week" : "that month"} only.
        {period === "day" && ` Every member's goal is ${DAILY_GOAL} applications a day unless you set another here.`}</p>
      <div className="jobs-table-wrap">
        <table className="jobs-table jobs-plans-table">
          <thead><tr>
            <th scope="col">Member</th><th scope="col">Applications</th><th scope="col">Interviews</th><th scope="col">Offers</th><th scope="col">Note</th>
            <th scope="col">{current ? "So far" : <span className="jobs-hidden">Fill in</span>}</th>
          </tr></thead>
          <tbody>
            <tr className="jobs-plans-all">
              <th scope="row">Same for everyone</th>
              {(["applications", "interviews", "offers"] as const).map(field => <td key={field}>
                <input className="jobs-number" inputMode="numeric" aria-label={`${field} for everyone`} value={all[field]} placeholder="–"
                  onChange={event => setAll(current => ({ ...current, [field]: event.target.value.replace(/\D/g, "") }))} />
              </td>)}
              <td><input className="jobs-note-input" aria-label="Note for everyone" value={all.note} maxLength={1000} placeholder="A note for everyone"
                onChange={event => setAll(current => ({ ...current, note: event.target.value }))} /></td>
              <td><button type="button" className="chat-pill" onClick={() => {
                for (const person of team) edit(person.id, Object.fromEntries(Object.entries(all).filter(([, value]) => value !== "")) as Partial<Draft>);
              }}>Fill in</button></td>
            </tr>
            {team.map(person => {
              const draft = draftOf(person.id);
              const row = board.find(entry => entry.user_id === person.id);
              const done = row ? DONE[period](row) : [0, 0, 0];
              return <tr key={person.id} data-changed={drafts[key(person.id)] ? "" : undefined}>
                <th scope="row"><span className="jobs-person"><Avatar initials={initialsOf(person.name)} photo={person.photo} className="jobs-avatar" />{person.name}</span></th>
                {(["applications", "interviews", "offers"] as const).map(field => <td key={field}>
                  <input className="jobs-number" inputMode="numeric" aria-label={`${field} for ${person.name}`} value={draft[field]}
                    placeholder={period === "day" && field === "applications" ? String(DAILY_GOAL) : "–"}
                    onChange={event => edit(person.id, { [field]: event.target.value.replace(/\D/g, "") })} />
                </td>)}
                <td><input className="jobs-note-input" aria-label={`Note for ${person.name}`} value={draft.note} maxLength={1000} placeholder="Add a note"
                  onChange={event => edit(person.id, { note: event.target.value })} /></td>
                <td className="jobs-plans-done">
                  {current && <Meter value={done[0]} target={asNumber(draft.applications) ?? (period === "day" ? DAILY_GOAL : null)} label={`Applications, ${person.name}`} compact />}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {!team.length && <p className="jobs-empty-line">No members yet: approved people appear here.</p>}
      <div className="jobs-save-row">
        <p className="jobs-hint" role="status">{said || (changed.length ? `${changed.length} changed, not saved yet.` : "")}</p>
        <button type="button" className="jobs-button" data-primary="" disabled={!changed.length || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save plans"}</button>
      </div>
    </section>
    <TeamSettings supabase={supabase} settings={settings} onSettings={onSettings} />
  </div>;
}

/** The team's time zone (its days, weeks and months follow it) and its currency. */
function TeamSettings({ supabase, settings, onSettings }: { supabase: SupabaseClient; settings: JobSettings; onSettings: (settings: JobSettings) => void }) {
  const [zone, setZone] = useState(settings.timezone ?? "UTC");
  const [currency, setCurrency] = useState(settings.currency);
  const [said, setSaid] = useState("");
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [zone];
  const save = async () => {
    const { data, error } = await supabase.from("job_settings").update({ timezone: zone, currency: currency.toUpperCase() }).eq("id", 1).select("timezone, currency").single();
    if (error || !data) return setSaid("That did not save. Is the currency a three-letter code, such as USD?");
    onSettings(data as JobSettings);
    setSaid("Saved.");
  };
  return <section className="jobs-card" aria-labelledby="jobs-settings-title">
    <h2 id="jobs-settings-title" className="jobs-card-title">The team&apos;s day and money</h2>
    <div className="jobs-form-pair jobs-settings">
      <label className="chat-field"><span>Time zone (days, weeks and months follow it)</span>
        <select value={zone} onChange={event => setZone(event.target.value)}>{(zones.includes(zone) ? zones : [zone, ...zones]).map(name => <option key={name} value={name}>{name}</option>)}</select>
      </label>
      <label className="chat-field"><span>Currency</span><input value={currency} maxLength={3} onChange={event => setCurrency(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} /></label>
    </div>
    <div className="jobs-save-row">
      <p className="jobs-hint" role="status">{said}</p>
      <button type="button" className="jobs-button" onClick={() => void save()}>Save</button>
    </div>
  </section>;
}
