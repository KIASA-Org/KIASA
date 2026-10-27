"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardRow, HourRow, Plan, TeamPerson, TrendRow } from "@/lib/jobs/types";
import { Avatar } from "../site/avatar";
import { Columns, Meter, Sparkline, StatTile, type Column } from "./jobs-charts";
import { addDays, ago, compact, dayGoal, initialsOf, partsIn, shortDay, weekdayOf } from "./jobs-format";

/** The admins' live view of the team's job search: today's applications per
 * member against their plan, when each last applied, their last two weeks, the
 * team's last thirty days and today hour by hour. It moves as members apply. */
export function LiveView({ supabase, team, board, plans, zone, today, now, version, pending, onConfirm }: {
  supabase: SupabaseClient; team: TeamPerson[]; board: BoardRow[]; plans: Plan[]; zone: string; today: string; now: number;
  version: number; pending: number; onConfirm: () => void;
}) {
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [hours, setHours] = useState<HourRow[]>([]);
  useEffect(() => {
    let stopped = false;
    void Promise.all([supabase.rpc("team_trend", { days: 30 }), supabase.rpc("team_hours")]).then(([days, byHour]) => {
      if (stopped) return;
      setTrend((days.data ?? []) as TrendRow[]);
      setHours((byHour.data ?? []) as HourRow[]);
    });
    return () => { stopped = true; };
  }, [supabase, version, today]);

  const days = Array.from({ length: 30 }, (_, index) => addDays(today, index - 29));
  const perDay = (day: string, user?: string) => trend.filter(row => row.day === day && (!user || row.user_id === user)).reduce((sum, row) => sum + Number(row.applications), 0);
  const sum = (of: (row: BoardRow) => number) => board.reduce((total, row) => total + Number(of(row)), 0);
  const active = board.filter(row => row.apps_day > 0).length;
  const hourNow = now ? partsIn(zone, new Date(now).toISOString()).hour : 23;
  const dayColumns: Column[] = days.map(day => ({ key: day, label: day.slice(8).replace(/^0/, ""), long: `${weekdayOf(day)} ${shortDay(day)}`, value: perDay(day) }));
  const hourColumns: Column[] = Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour), label: String(hour), long: `${String(hour).padStart(2, "0")}:00–${String(hour).padStart(2, "0")}:59`,
    value: hours.filter(row => row.hour === hour).reduce((total, row) => total + Number(row.applications), 0),
  }));
  const rows = [...board].sort((a, b) => b.apps_day - a.apps_day || a.name.localeCompare(b.name));
  // Each member's goal for today (their plan's, or the team's daily goal), and the team's, all of them together.
  const goals = new Map(rows.map(row => [row.user_id, dayGoal(plans, row.user_id, today)]));
  const teamGoal = [...goals.values()].reduce((total, goal) => total + goal, 0);
  // The members' cards share their scales: the busiest member's day (or the highest goal), and hour.
  const dayTop = Math.max(0, ...goals.values(), ...rows.flatMap(row => days.map(day => perDay(day, row.user_id))));
  const hourTop = Math.max(0, ...hours.map(entry => Number(entry.applications)));

  return <div className="jobs-view">
    <section className="jobs-tiles" aria-label="Today, across the team">
      <StatTile label="Applied today" value={compact(sum(row => row.apps_day))}
        detail={`${active} of ${board.length} members so far${teamGoal ? ` · goal ${compact(teamGoal)}` : ""}`} />
      <StatTile label="This week" value={compact(sum(row => row.apps_week))} detail={`${compact(sum(row => row.apps_month))} this month`} />
      <StatTile label="Interviews this week" value={compact(sum(row => row.interviews_week))} detail={`${sum(row => row.interviews_day)} today`} />
      <StatTile label="Offers this month" value={compact(sum(row => row.offers_month))} detail={`${sum(row => row.jobs_held)} jobs held`} />
      <StatTile label="Waiting to confirm" value={pending} detail={pending ? <button type="button" className="jobs-link" onClick={onConfirm}>Confirm them</button> : "nothing waiting"} />
    </section>
    <section className="jobs-card" aria-labelledby="jobs-live-title">
      <div className="jobs-card-head">
        <h2 id="jobs-live-title" className="jobs-card-title">Today, member by member</h2>
        <p className="jobs-card-sub"><span className="jobs-live-dot" aria-hidden="true" /> Live</p>
      </div>
      <div className="jobs-table-wrap">
        <table className="jobs-table">
          <thead><tr>
            <th scope="col">Member</th><th scope="col">Applied today</th><th scope="col">Last applied</th><th scope="col">Last 14 days</th>
            <th scope="col">This week</th><th scope="col">Interviews this week</th><th scope="col">Offers this month</th>
          </tr></thead>
          <tbody>
            {rows.map(row => {
              const who = team.find(person => person.id === row.user_id);
              const target = goals.get(row.user_id) ?? null;
              const recent = days.slice(-14).map(day => perDay(day, row.user_id));
              return <tr key={row.user_id}>
                <th scope="row"><span className="jobs-person"><Avatar initials={initialsOf(row.name)} photo={who?.photo ?? null} className="jobs-avatar" />{row.name}</span></th>
                <td><Meter value={row.apps_day} target={target} label={`${row.name}, applied today`} compact /></td>
                <td className="jobs-quiet">{now ? ago(row.last_applied_at, now, zone, today) : ""}</td>
                <td><Sparkline values={recent} label={`${row.name}, applications a day over the last 14 days`} /></td>
                <td><span className="jobs-num">{row.apps_week}</span></td>
                <td><span className="jobs-num">{row.interviews_week}</span></td>
                <td><span className="jobs-num">{row.offers_month}</span></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="jobs-empty-line">No members yet: approved people appear here.</p>}
    </section>
    <div className="jobs-two">
      <section className="jobs-card" aria-labelledby="jobs-days-title">
        <h2 id="jobs-days-title" className="jobs-card-title">Applications a day, the team</h2>
        <p className="jobs-card-sub">The last 30 days; today in leaf; dashed, the team&apos;s goal for a day.</p>
        <Columns items={dayColumns} accent={today} title="Applications a day by the team, the last 30 days" unit="applications" every={5} goal={teamGoal || undefined} />
      </section>
      <section className="jobs-card" aria-labelledby="jobs-hours-title">
        <h2 id="jobs-hours-title" className="jobs-card-title">Today, hour by hour</h2>
        <p className="jobs-card-sub">Applications in each hour ({zone}); this hour in leaf.</p>
        <Columns items={hourColumns} accent={String(hourNow)} title="Applications by the team in each hour today" unit="applications" every={3} />
      </section>
    </div>
    {rows.length > 0 && <section aria-labelledby="jobs-each-title">
      <div className="jobs-section-head">
        <h2 id="jobs-each-title" className="jobs-card-title">Each member</h2>
        <p className="jobs-card-sub">Every card on the same scales, so they compare.</p>
      </div>
      <div className="jobs-members">
        {rows.map(row => {
          const who = team.find(person => person.id === row.user_id);
          const target = goals.get(row.user_id) ?? null;
          const byDay: Column[] = days.map(day => ({ key: day, label: day.slice(8).replace(/^0/, ""), long: `${weekdayOf(day)} ${shortDay(day)}`, value: perDay(day, row.user_id) }));
          const byHour: Column[] = Array.from({ length: 24 }, (_, hour) => ({
            key: String(hour), label: String(hour), long: `${String(hour).padStart(2, "0")}:00–${String(hour).padStart(2, "0")}:59`,
            value: hours.filter(entry => entry.user_id === row.user_id && entry.hour === hour).reduce((total, entry) => total + Number(entry.applications), 0),
          }));
          return <article key={row.user_id} className="jobs-card jobs-member" aria-label={row.name}>
            <header className="jobs-member-head">
              <Avatar initials={initialsOf(row.name)} photo={who?.photo ?? null} className="jobs-avatar" />
              <div>
                <p className="jobs-member-name">{row.name}</p>
                <p className="jobs-card-sub">Last applied {now ? ago(row.last_applied_at, now, zone, today) : ""} · {row.apps_week} this week</p>
              </div>
              <Meter value={row.apps_day} target={target} label={`${row.name}, applied today`} compact />
            </header>
            <p className="jobs-mini-title">Applications a day, the last 30 days</p>
            <Columns items={byDay} accent={today} max={dayTop} compact height={112} every={7} goal={target ?? undefined}
              title={`${row.name}: applications a day, the last 30 days`} unit="applications" />
            <p className="jobs-mini-title">Today, hour by hour</p>
            <Columns items={byHour} accent={String(hourNow)} max={hourTop} compact height={88} every={6}
              title={`${row.name}: applications in each hour today`} unit="applications" />
          </article>;
        })}
      </div>
    </section>}
  </div>;
}
