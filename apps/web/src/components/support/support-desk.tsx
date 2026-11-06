"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";

type Session = {
  id: string; status: "invited" | "live" | "ended"; member_id: string; manager_id: string; opened_by: string;
  created_at: string; accepted_at: string | null; ended_at: string | null; end_reason: string | null;
  consent: { screen?: string; system_audio?: boolean; mic?: boolean } | null;
};
type Event = { id: number; session_id: string; at: string; actor: string | null; kind: string; detail: Record<string, unknown> };

const time = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** /support: a manager's open sessions and invitations, and anyone's session history.
 * Members start a session from the KIASA Sound Desk app on Windows. */
export function SupportDesk({ me, manager, names, realtime }: { me: string; manager: boolean; names: Record<string, string>; realtime: { url: string; key: string } }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("support_sessions")
      .select("id, status, member_id, manager_id, opened_by, created_at, accepted_at, ended_at, end_reason, consent")
      .or(`member_id.eq.${me},manager_id.eq.${me}`).order("created_at", { ascending: false }).limit(40);
    if (error) { setNotice(/support_sessions/.test(error.message) ? "Support sessions are not set up in the database yet (supabase/migrations/20261106090000_support_sessions.sql)." : "Could not load sessions."); return; }
    setSessions((data ?? []) as Session[]);
  }, [supabase, me]);

  useEffect(() => {
    queueMicrotask(() => void load());
    if (manager) void supabase.rpc("support_members").then(({ data }) => setMembers((data ?? []) as { id: string; name: string }[]));
    const changes = supabase.channel("support-sessions-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_sessions" }, () => void load())
      .subscribe();
    const tick = window.setInterval(() => void load(), 10_000);
    return () => { window.clearInterval(tick); void supabase.removeChannel(changes); };
  }, [supabase, load, manager]);

  const history = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const { data } = await supabase.from("support_events").select("*").eq("session_id", id).order("id");
    setEvents(current => ({ ...current, [id]: (data ?? []) as Event[] }));
  };

  const invite = async () => {
    if (!chosen) return;
    setNotice("");
    const { error } = await supabase.rpc("support_invite", { member: chosen });
    if (error) setNotice(/already open/.test(error.message) ? "That member already has an open session." : "The invitation could not be sent.");
    else { setNotice(`Invited ${names[chosen] ?? "the member"}. They accept in the KIASA Sound Desk app; nothing is shared until they do.`); void load(); }
  };
  const end = async (id: string) => { await supabase.rpc("support_end", { session: id, reason: "manager_ended" }); void load(); };

  const nameOf = (id: string) => (id === me ? "You" : names[id] ?? "A KIASA member");
  const openOnes = sessions.filter(s => s.status !== "ended");
  const done = sessions.filter(s => s.status === "ended");

  return <div className="interview wrap wrap-wide support-desk">
    <div>
      <h1 className="interview-title">Support sessions</h1>
      <p className="jobs-form-hint">{manager
        ? "A member shares their Windows screen and sound with you from the KIASA Sound Desk app, after choosing what to share. You can talk to them. Nothing is recorded; who opened what, and when, is kept."
        : "To share your screen with a manager, open the KIASA Sound Desk app on Windows and choose Support session. Below is every session you were in, and what happened in it."}</p>
    </div>
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {manager && <div className="jobs-card support-invite">
      <p className="resume-folder-title">Invite a member</p>
      <div className="support-invite-row">
        <select value={chosen} onChange={event => setChosen(event.target.value)} aria-label="Member to invite">
          <option value="">Choose a member…</option>
          {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <button type="button" className="admin-approve" disabled={!chosen} onClick={() => void invite()}>Invite</button>
      </div>
    </div>}
    <div className="jobs-card live-now-list">
      <p className="resume-folder-title">Open now ({openOnes.length})</p>
      {!openOnes.length && <p className="jobs-empty-line">No open sessions.</p>}
      {openOnes.map(s => <div key={s.id} className="live-now-person support-row" data-support-row={s.status}>
        <span className="bridge-status-dot live-now-dot" aria-hidden="true" />
        <span className="live-now-name">{s.manager_id === me ? nameOf(s.member_id) : `With ${nameOf(s.manager_id)}`}</span>
        <span className="live-now-since">{s.status === "invited" ? "invited, waiting for the member" : `sharing since ${time(s.accepted_at ?? s.created_at)}`}</span>
        {s.status === "live" && s.manager_id === me && <Link className="admin-approve" href={`/support/${s.id}`}>Open</Link>}
        {s.manager_id === me && <button type="button" className="admin-decline" onClick={() => void end(s.id)}>End</button>}
      </div>)}
    </div>
    <div className="jobs-card">
      <p className="resume-folder-title">History</p>
      {!done.length && <p className="jobs-empty-line">No past sessions.</p>}
      {done.map(s => <div key={s.id} className="support-history">
        <button type="button" className="support-history-head" aria-expanded={open === s.id} onClick={() => void history(s.id)}>
          {time(s.created_at)} · {nameOf(s.member_id)} with {nameOf(s.manager_id)} · ended{s.end_reason ? ` (${s.end_reason.replace(/_/g, " ")})` : ""}
        </button>
        {open === s.id && <ol className="support-events">
          {(events[s.id] ?? []).map(event => <li key={event.id}>{new Date(event.at).toLocaleTimeString()} — {event.actor ? nameOf(event.actor) : "KIASA"}: {event.kind.replace(/_/g, " ")}
            {event.kind === "consent" ? ` (screen: ${String(event.detail.screen ?? "-")}, computer sound: ${event.detail.system_audio ? "yes" : "no"}, microphone: ${event.detail.mic ? "yes" : "no"})` : ""}</li>)}
        </ol>}
      </div>)}
    </div>
  </div>;
}
