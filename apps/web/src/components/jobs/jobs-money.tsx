"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardRow, Decision, JobsMe, Payment, Position, TeamPerson } from "@/lib/jobs/types";
import { Avatar } from "../site/avatar";
import { Plus } from "../site/icons";
import { Confirm } from "../chat/chat-dialog";
import { StatTile } from "./jobs-charts";
import { HiredDialog, PaymentDialog } from "./jobs-dialogs";
import { addDays, initialsOf, money, shortDay } from "./jobs-format";

const DECISION: Record<Decision, string> = { pending: "Waiting for an admin", confirmed: "Confirmed", declined: "Declined" };

/** A member's earnings: the jobs they have won and the pay they have received,
 * each counted once an admin confirms it. */
export function Earnings({ me, supabase, currency, today, mine, version }: {
  me: JobsMe; supabase: SupabaseClient; currency: string; today: string; mine: BoardRow | null; version: number;
}) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [local, setLocal] = useState(0);
  const [asking, setAsking] = useState<"job" | "pay" | null>(null);
  const [changing, setChanging] = useState<Position | null>(null);
  const [leaving, setLeaving] = useState<Position | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    void Promise.all([
      supabase.from("positions").select("*").eq("user_id", me.id).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("user_id", me.id).order("paid_on", { ascending: false }).limit(200),
    ]).then(([jobs, pay]) => {
      if (stopped) return;
      setPositions((jobs.data ?? []) as Position[]);
      setPayments((pay.data ?? []) as Payment[]);
    });
    return () => { stopped = true; };
  }, [supabase, me.id, version, local]);
  const again = () => setLocal(value => value + 1);
  const held = (positions ?? []).filter(position => !position.ended_on || position.ended_on >= today);
  const jobOf = (id: string | null) => (positions ?? []).find(position => position.id === id);
  const remove = async (table: "positions" | "payments", id: string) => {
    const { error: failed } = await supabase.from(table).delete().eq("id", id);
    if (failed) setError("That did not work. Please try again.");
    again();
  };

  return <div className="jobs-view">
    <section className="jobs-tiles" aria-label="Your earnings">
      <StatTile label="Jobs held" value={mine?.jobs_held ?? 0} detail="confirmed" />
      <StatTile label="Monthly salary (est.)" value={money(mine?.monthly_salary ?? 0, currency)} detail="of the jobs held" />
      <StatTile label="Paid this month" value={money(mine?.paid_month ?? 0, currency)} detail="confirmed" />
      <StatTile label="Paid in all" value={money(mine?.paid_total ?? 0, currency)} detail="confirmed" />
    </section>
    <section className="jobs-card" aria-labelledby="jobs-won-title">
      <div className="jobs-card-head">
        <h2 id="jobs-won-title" className="jobs-card-title">Jobs you got</h2>
        <button type="button" className="jobs-button" onClick={() => setAsking("job")}><Plus /> Add a job you got</button>
      </div>
      <ul className="jobs-ledger">
        {(positions ?? []).map(position => <li key={position.id} data-ended={position.ended_on && position.ended_on < today ? "" : undefined}>
          <div className="jobs-ledger-main">
            <p className="jobs-ledger-title">{position.title} · {position.company}</p>
            <p className="jobs-row-meta">
              <span>{money(position.monthly_salary, currency)} a month</span>
              {position.started_on && <span>Started {shortDay(position.started_on)}</span>}
              {position.ended_on && <span>Left {shortDay(position.ended_on)}</span>}
            </p>
          </div>
          <span className="jobs-chip" data-decision={position.status}>{DECISION[position.status]}</span>
          <div className="jobs-row-actions">
            <button type="button" className="chat-pill" onClick={() => setChanging(position)}>Change</button>
            {!position.ended_on && <button type="button" className="chat-pill" onClick={() => setLeaving(position)}>I left this job</button>}
            {position.status !== "confirmed" && <button type="button" className="chat-pill" data-danger="" onClick={() => void remove("positions", position.id)}>Remove</button>}
          </div>
        </li>)}
      </ul>
      {positions && !positions.length && <p className="jobs-empty-line">None yet. When you get a job, mark it Hired on its row (or add it here); it counts once an admin confirms it.</p>}
    </section>
    <section className="jobs-card" aria-labelledby="jobs-pay-title">
      <div className="jobs-card-head">
        <h2 id="jobs-pay-title" className="jobs-card-title">Pay received</h2>
        <button type="button" className="jobs-button" onClick={() => setAsking("pay")}><Plus /> Log pay received</button>
      </div>
      <ul className="jobs-ledger">
        {payments.map(payment => <li key={payment.id}>
          <div className="jobs-ledger-main">
            <p className="jobs-ledger-title">{money(payment.amount, currency)}</p>
            <p className="jobs-row-meta">
              <span>{shortDay(payment.paid_on)}</span>
              {jobOf(payment.position_id) && <span>{jobOf(payment.position_id)!.company}</span>}
              {payment.note && <span>{payment.note}</span>}
            </p>
          </div>
          <span className="jobs-chip" data-decision={payment.status}>{DECISION[payment.status]}</span>
          <div className="jobs-row-actions">
            {payment.status !== "confirmed" && <button type="button" className="chat-pill" data-danger="" onClick={() => void remove("payments", payment.id)}>Remove</button>}
          </div>
        </li>)}
      </ul>
      {!payments.length && <p className="jobs-empty-line">Nothing logged yet.</p>}
      {error && <p className="b-form-error" role="alert">{error}</p>}
    </section>

    {(asking === "job" || changing) && <HiredDialog position={changing} currency={currency} onClose={() => { setAsking(null); setChanging(null); }} onSave={async form => {
      const row = { company: form.company, title: form.title, monthly_salary: form.salary, started_on: form.started };
      const { error: failed } = changing
        ? await supabase.from("positions").update(row).eq("id", changing.id)
        : await supabase.from("positions").insert({ ...row, user_id: me.id });
      if (failed) return "That did not save. Please try again.";
      again();
      return null;
    }} />}
    {asking === "pay" && <PaymentDialog positions={held} currency={currency} today={today} onClose={() => setAsking(null)} onSave={async form => {
      const { error: failed } = await supabase.from("payments").insert({ user_id: me.id, amount: form.amount, paid_on: form.paid, position_id: form.position, note: form.note || null });
      if (failed) return "That did not save. Please try again.";
      again();
      return null;
    }} />}
    {leaving && <Confirm title="You left this job?" confirm="Yes, I left"
      text={<>“{leaving.title} · {leaving.company}” stops counting toward your monthly salary from tomorrow.</>}
      onClose={() => setLeaving(null)} onConfirm={async () => {
        const { error: failed } = await supabase.from("positions").update({ ended_on: today }).eq("id", leaving.id);
        if (failed) return "That did not work. Please try again.";
        again();
        return null;
      }} />}
  </div>;
}

/** What members have reported, for an admin to confirm (correcting the figure
 * first if need be) or decline; and what was decided lately. */
export function ConfirmView({ supabase, team, currency, today, version, onDecided }: {
  supabase: SupabaseClient; team: TeamPerson[]; currency: string; today: string; version: number; onDecided: () => void;
}) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [figures, setFigures] = useState<Record<string, string>>({});
  const [local, setLocal] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    const since = `${addDays(today, -30)}T00:00:00Z`;
    void Promise.all([
      supabase.from("positions").select("*").or(`status.eq.pending,decided_at.gte.${since}`).order("created_at", { ascending: false }).limit(300),
      supabase.from("payments").select("*").or(`status.eq.pending,decided_at.gte.${since}`).order("created_at", { ascending: false }).limit(300),
    ]).then(([jobs, pay]) => {
      if (stopped) return;
      setPositions((jobs.data ?? []) as Position[]);
      setPayments((pay.data ?? []) as Payment[]);
    });
    return () => { stopped = true; };
  }, [supabase, today, version, local]);
  const person = (id: string) => team.find(entry => entry.id === id);
  const decide = async (table: "positions" | "payments", id: string, status: Decision, figure?: number) => {
    setError("");
    const change: Record<string, unknown> = { status };
    if (figure !== undefined && Number.isFinite(figure) && figure > 0) change[table === "positions" ? "monthly_salary" : "amount"] = figure;
    const { error: failed } = await supabase.from(table).update(change).eq("id", id);
    if (failed) return setError("That did not save. Please try again.");
    setLocal(value => value + 1);
    onDecided();
  };
  const who = (id: string) => {
    const entry = person(id);
    return <span className="jobs-person"><Avatar initials={initialsOf(entry?.name ?? "?")} photo={entry?.photo ?? null} className="jobs-avatar" />{entry?.name ?? "A former member"}</span>;
  };
  const figure = (id: string, value: number) => <input className="jobs-number jobs-money-input" inputMode="decimal" aria-label="Figure to confirm"
    value={figures[id] ?? String(value)} onChange={event => setFigures(current => ({ ...current, [id]: event.target.value.replace(/[^\d.]/g, "") }))} />;
  const waitingJobs = (positions ?? []).filter(row => row.status === "pending"), waitingPay = payments.filter(row => row.status === "pending");
  const decided = [...(positions ?? []).filter(row => row.status !== "pending").map(row => ({ kind: "job" as const, row })),
    ...payments.filter(row => row.status !== "pending").map(row => ({ kind: "pay" as const, row }))]
    .sort((a, b) => (b.row.decided_at ?? "").localeCompare(a.row.decided_at ?? "")).slice(0, 30);

  return <div className="jobs-view">
    <section className="jobs-card" aria-labelledby="jobs-confirm-jobs">
      <h2 id="jobs-confirm-jobs" className="jobs-card-title">Jobs members got</h2>
      <p className="jobs-card-sub">Confirmed, a job counts on the leaderboard with its monthly salary. Correct the salary first if it is not right.</p>
      <div className="jobs-table-wrap"><table className="jobs-table">
        <thead><tr><th scope="col">Member</th><th scope="col">Job</th><th scope="col">Monthly salary ({currency})</th><th scope="col">Started</th><th scope="col"><span className="jobs-hidden">Decide</span></th></tr></thead>
        <tbody>{waitingJobs.map(row => <tr key={row.id}>
          <th scope="row">{who(row.user_id)}</th>
          <td>{row.title} · {row.company}</td>
          <td>{figure(row.id, row.monthly_salary)}</td>
          <td className="jobs-quiet">{row.started_on ? shortDay(row.started_on) : "—"}</td>
          <td className="jobs-decide">
            <button type="button" className="jobs-button" data-primary="" onClick={() => void decide("positions", row.id, "confirmed", Number(figures[row.id] ?? row.monthly_salary))}>Confirm</button>
            <button type="button" className="chat-pill" data-danger="" onClick={() => void decide("positions", row.id, "declined")}>Decline</button>
          </td>
        </tr>)}</tbody>
      </table></div>
      {positions && !waitingJobs.length && <p className="jobs-empty-line">Nothing waiting.</p>}
    </section>
    <section className="jobs-card" aria-labelledby="jobs-confirm-pay">
      <h2 id="jobs-confirm-pay" className="jobs-card-title">Pay members received</h2>
      <div className="jobs-table-wrap"><table className="jobs-table">
        <thead><tr><th scope="col">Member</th><th scope="col">Amount ({currency})</th><th scope="col">Paid on</th><th scope="col">For</th><th scope="col"><span className="jobs-hidden">Decide</span></th></tr></thead>
        <tbody>{waitingPay.map(row => {
          const job = (positions ?? []).find(entry => entry.id === row.position_id);
          return <tr key={row.id}>
            <th scope="row">{who(row.user_id)}</th>
            <td>{figure(row.id, row.amount)}</td>
            <td className="jobs-quiet">{shortDay(row.paid_on)}</td>
            <td className="jobs-quiet">{job ? `${job.title} · ${job.company}` : row.note ?? "—"}</td>
            <td className="jobs-decide">
              <button type="button" className="jobs-button" data-primary="" onClick={() => void decide("payments", row.id, "confirmed", Number(figures[row.id] ?? row.amount))}>Confirm</button>
              <button type="button" className="chat-pill" data-danger="" onClick={() => void decide("payments", row.id, "declined")}>Decline</button>
            </td>
          </tr>;
        })}</tbody>
      </table></div>
      {positions && !waitingPay.length && <p className="jobs-empty-line">Nothing waiting.</p>}
      {error && <p className="b-form-error" role="alert">{error}</p>}
    </section>
    {decided.length > 0 && <section className="jobs-card" aria-labelledby="jobs-decided">
      <h2 id="jobs-decided" className="jobs-card-title">Decided lately</h2>
      <ul className="jobs-ledger">
        {decided.map(({ kind, row }) => <li key={row.id}>
          <div className="jobs-ledger-main">
            <p className="jobs-ledger-title">{kind === "job" ? `${(row as Position).title} · ${(row as Position).company}` : money((row as Payment).amount, currency)}</p>
            <p className="jobs-row-meta"><span>{person(row.user_id)?.name ?? "A former member"}</span>
              {kind === "job" ? <span>{money((row as Position).monthly_salary, currency)} a month</span> : <span>Paid {shortDay((row as Payment).paid_on)}</span>}</p>
          </div>
          <span className="jobs-chip" data-decision={row.status}>{DECISION[row.status]}</span>
          <div className="jobs-row-actions">
            {row.status === "confirmed" && <button type="button" className="chat-pill" onClick={() => void decide(kind === "job" ? "positions" : "payments", row.id, "pending")}>Undo</button>}
          </div>
        </li>)}
      </ul>
    </section>}
  </div>;
}
