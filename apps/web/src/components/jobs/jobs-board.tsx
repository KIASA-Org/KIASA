"use client";

import { useState } from "react";
import type { BoardRow, JobsMe, TeamPerson } from "@/lib/jobs/types";
import { Avatar } from "../site/avatar";
import { StatTile } from "./jobs-charts";
import { ago, compact, initialsOf, money } from "./jobs-format";

type Rank = "salary" | "jobs" | "paid" | "today" | "month";
const RANKS: { id: Rank; label: string; of: (row: BoardRow) => number }[] = [
  { id: "salary", label: "Monthly salary", of: row => row.monthly_salary },
  { id: "jobs", label: "Jobs held", of: row => row.jobs_held },
  { id: "paid", label: "Paid this month", of: row => row.paid_month },
  { id: "today", label: "Applied today", of: row => row.apps_day },
  { id: "month", label: "Applied this month", of: row => row.apps_month },
];

/** The leaderboard: what everyone on the team has, earns and does, for
 * everyone to see. Jobs and pay count once an admin has confirmed them. */
export function Leaderboard({ me, board, team, currency, zone, today, now }: {
  me: JobsMe; board: BoardRow[]; team: TeamPerson[]; currency: string; zone: string; today: string; now: number;
}) {
  const [rank, setRank] = useState<Rank>("salary");
  const by = RANKS.find(entry => entry.id === rank)!;
  const rows = [...board].sort((a, b) => by.of(b) - by.of(a) || b.monthly_salary - a.monthly_salary || b.apps_month - a.apps_month || a.name.localeCompare(b.name));
  const top = Math.max(1, ...rows.map(by.of));
  const sum = (of: (row: BoardRow) => number) => board.reduce((total, row) => total + Number(of(row)), 0);
  const person = (id: string) => team.find(entry => entry.id === id);
  // Ties share a place: the first with the same figure gives it.
  const places = rows.map(row => rows.findIndex(other => by.of(other) === by.of(row)) + 1);

  return <div className="jobs-view">
    <section className="jobs-tiles" aria-label="The team, together">
      <StatTile label="Jobs held" value={compact(sum(row => row.jobs_held))} detail="confirmed, across the team" />
      <StatTile label="Monthly salary (est.)" value={money(sum(row => row.monthly_salary), currency)} detail="of the jobs held" />
      <StatTile label="Paid this month" value={money(sum(row => row.paid_month), currency)} detail={`${money(sum(row => row.paid_total), currency)} in all`} />
      <StatTile label="Applied today" value={compact(sum(row => row.apps_day))} detail={`${compact(sum(row => row.apps_month))} this month`} />
    </section>
    <section className="jobs-card" aria-labelledby="jobs-board-title">
      <div className="jobs-card-head">
        <h2 id="jobs-board-title" className="jobs-card-title">Leaderboard</h2>
        <div className="jobs-filters" role="group" aria-label="Rank by">
          {RANKS.map(entry => <button key={entry.id} type="button" className="jobs-filter" aria-pressed={rank === entry.id} onClick={() => setRank(entry.id)}>{entry.label}</button>)}
        </div>
      </div>
      <div className="jobs-table-wrap">
        <table className="jobs-table jobs-board">
          <thead><tr>
            <th scope="col"><span className="jobs-hidden">Place</span></th>
            <th scope="col">Member</th>
            <th scope="col" data-ranked={rank === "jobs" || undefined}>Jobs held</th>
            <th scope="col" data-ranked={rank === "salary" || undefined}>Monthly salary (est.)</th>
            <th scope="col" data-ranked={rank === "paid" || undefined}>Paid this month</th>
            <th scope="col">Paid in all</th>
            <th scope="col" data-ranked={rank === "today" || undefined}>Applied today</th>
            <th scope="col" data-ranked={rank === "month" || undefined}>This month</th>
            <th scope="col">Interviews this month</th>
            <th scope="col">Last applied</th>
          </tr></thead>
          <tbody>
            {rows.map((row, index) => {
              const who = person(row.user_id);
              const cell = (id: Rank, text: string) => <td data-ranked={rank === id || undefined}>
                <span className="jobs-num">{text}</span>
                {rank === id && <span className="jobs-rank-bar" aria-hidden="true"><span style={{ width: `${(by.of(row) / top) * 100}%` }} /></span>}
              </td>;
              return <tr key={row.user_id} data-me={row.user_id === me.id || undefined}>
                <td><span className="jobs-place" data-top={places[index] <= 3 && by.of(row) > 0 ? "" : undefined}>{places[index]}</span></td>
                <th scope="row"><span className="jobs-person">
                  <Avatar initials={initialsOf(row.name)} photo={who?.photo ?? null} className="jobs-avatar" who={row.user_id} />
                  <span>{row.name}{row.user_id === me.id && <span className="jobs-you">You</span>}</span>
                </span></th>
                {cell("jobs", String(row.jobs_held))}
                {cell("salary", money(row.monthly_salary, currency))}
                {cell("paid", money(row.paid_month, currency))}
                <td><span className="jobs-num">{money(row.paid_total, currency)}</span></td>
                {cell("today", String(row.apps_day))}
                {cell("month", String(row.apps_month))}
                <td><span className="jobs-num">{row.interviews_month}</span></td>
                <td className="jobs-quiet">{now ? ago(row.last_applied_at, now, zone, today) : ""}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="jobs-empty-line">No members yet.</p>}
      <p className="jobs-hint">Jobs and pay count here once an admin has confirmed them. Days, weeks and months follow the team&apos;s time ({zone}).</p>
    </section>
  </div>;
}
