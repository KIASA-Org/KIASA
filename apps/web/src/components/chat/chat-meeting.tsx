"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Attachment, ChatMe } from "@/lib/chat/types";
import { beginMeeting, createMeeting, decideMeeting, endMeeting, meetingChoices, meetingRoster, setMeetingPeople } from "@/lib/meetings/actions";
import type { MeetingChoice, MeetingRoster } from "@/lib/meetings/types";
import { Avatar } from "../site/avatar";
import { Calendar, Close, People, Search, Video } from "../site/icons";
import { initialsOf } from "./chat-format";

type Card = Extract<Attachment, { type: "meeting" }>;

/** A meeting opens in its own tab. The tab is opened at the click, before the
 * server answers, so the browser does not take it for a pop-up. */
function meetingTab(): { go: (id: string) => void; drop: () => void } {
  const tab = window.open("about:blank", "_blank");
  return {
    // (Blocked anyway: this tab goes, the whole page, as the meeting needs.)
    go: id => { const address = new URL(`/meet/${id}`, window.location.origin).href; if (tab) tab.location.href = address; else window.location.assign(address); },
    drop: () => tab?.close(),
  };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Now, as a date-time field wants it, in this computer's time: the next quarter hour. */
const soon = () => {
  const at = new Date(Math.ceil(Date.now() / 900_000) * 900_000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
};

/** Choosing people for a meeting: found by name, ticked; for a manager, their
 * team first, and anyone else apart (an admin's OK is needed for them). */
function ChoosePeople({ people, chosen, onChange, label }: {
  people: MeetingChoice[]; chosen: string[]; onChange: (chosen: string[]) => void; label: string;
}) {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = people.filter(person => words.every(word => `${person.name} ${person.detail}`.toLowerCase().includes(word)));
  const groups = [
    { key: "in", title: people.some(person => person.outside) ? "Your team" : null, list: shown.filter(person => !person.outside) },
    { key: "out", title: "Outside your team · an admin's OK is needed", list: shown.filter(person => person.outside) },
  ].filter(group => group.list.length);
  const every = shown.length > 0 && shown.every(person => chosen.includes(person.id));
  const toggle = (id: string, on: boolean) => onChange(on ? [...chosen, id] : chosen.filter(entry => entry !== id));
  return <div className="meet-choose" role="group" aria-label={label}>
    <div className="meet-choose-head">
      <span>{label}{chosen.length ? ` · ${chosen.length} chosen` : ""}</span>
      {shown.length > 1 && <button type="button" className="meet-choose-all"
        onClick={() => onChange(every ? chosen.filter(id => !shown.some(person => person.id === id)) : [...new Set([...chosen, ...shown.map(person => person.id)])])}>
        {every ? "Clear" : "Choose all"}</button>}
    </div>
    {people.length > 6 && <label className="chat-search">
      <Search />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search people" aria-label="Search people" />
    </label>}
    <ul className="chat-people meet-choose-list">
      {groups.map(group => <li key={group.key}>
        {group.title && <p className="meet-choose-group" data-out={group.key === "out" || undefined}>{group.title}</p>}
        <ul>
          {group.list.map(person => <li key={person.id}>
            <label className="chat-person">
              <input type="checkbox" checked={chosen.includes(person.id)} onChange={event => toggle(person.id, event.target.checked)} />
              <Avatar initials={initialsOf(person.name)} photo={person.photo} className="chat-avatar" who={person.id} />
              <span className="chat-person-text"><span>{person.name}</span><span>{person.detail}</span></span>
            </label>
          </li>)}
        </ul>
      </li>)}
      {!shown.length && <li className="chat-list-empty">{people.length ? "No one by that name." : "No one else can be invited yet."}</li>}
    </ul>
  </div>;
}

/** Who is outside a manager's team among those chosen: why the meeting will wait. */
function OutsideNote({ names, later }: { names: string[]; later?: boolean }) {
  if (!names.length) return null;
  const who = names.length < 3 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return <p className="meet-outside-note" role="status">
    {who} {names.length === 1 ? "is" : "are"} outside your team. {later
      ? "They join once an admin allows it."
      : "The meeting waits for an admin's OK, and no one is told of it until then."}
  </p>;
}

/** For admins, and a team's manager: a meeting now (everyone chosen is rung)
 * or planned for later, for the people chosen. From a chat, its people (all
 * of them to start with); from the chat list, anyone. */
export function MeetingDialog({ chatId, chatTitle, onClose }: { chatId?: string; chatTitle?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(chatTitle ? `${chatTitle} meeting` : "Meeting");
  const [later, setLater] = useState(false);
  const [at, setAt] = useState(soon);
  const [people, setPeople] = useState<MeetingChoice[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, start] = useTransition();
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);
  useEffect(() => {
    let stopped = false;
    void meetingChoices(chatId).then(result => {
      if (stopped) return;
      if (result.error) { setError(result.error); setPeople([]); return; }
      setPeople(result.people ?? []);
      setChosen(result.chosen ?? []);
    });
    return () => { stopped = true; };
  }, [chatId]);

  const outside = (people ?? []).filter(person => person.outside && chosen.includes(person.id)).map(person => person.name);
  const go = () => {
    setError("");
    // A meeting now opens in its own tab, opened at the click (not taken for a pop-up).
    const tab = !later && !outside.length ? meetingTab() : null;
    start(async () => {
      const result = await createMeeting({ chatId, title, startsAt: later ? new Date(at).toISOString() : null, people: chosen });
      if (result.error || !result.id) { tab?.drop(); setError(result.error ?? "That did not work. Please try again."); return; }
      if (result.waiting) { setSent(true); return; }
      tab?.go(result.id);
      onClose();
    });
  };

  return <dialog ref={dialog} className="chat-dialog meet-dialog" aria-label="New meeting" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <p className="chat-dialog-title">New meeting</p>
    {sent ? <>
      <p className="chat-dialog-text">Sent to the admins. Once one allows it, everyone you chose gets the meeting; you see how it stands in your chat with KIASA.</p>
      <div className="chat-dialog-actions"><button type="button" className="chat-dialog-button" data-primary="" onClick={onClose} autoFocus>OK</button></div>
    </> : <>
      <p className="chat-dialog-text">{chatTitle ? `For people of ${chatTitle}.` : "For the people you choose."} Calls go straight between your computers; up to about six people on video works best.</p>
      <label className="chat-field">
        <span>Title</span>
        <input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} autoFocus />
      </label>
      <div className="meet-when" role="radiogroup" aria-label="When">
        <button type="button" role="radio" aria-checked={!later} onClick={() => setLater(false)}><Video /> Now</button>
        <button type="button" role="radio" aria-checked={later} onClick={() => setLater(true)}><Calendar /> Later</button>
      </div>
      {later && <label className="chat-field">
        <span>Day and time (your computer&apos;s time)</span>
        <input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} />
      </label>}
      {people ? <ChoosePeople people={people} chosen={chosen} onChange={setChosen} label="Who is in it" />
        : <p className="meet-choose-loading" role="status">Loading people…</p>}
      <OutsideNote names={outside} />
      {error && <p className="b-form-error" role="alert">{error}</p>}
      <div className="chat-dialog-actions">
        <button type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="chat-dialog-button" data-primary="" onClick={go} disabled={busy || !title.trim() || !chosen.length}>
          {busy ? "Working…" : outside.length ? "Ask the admin" : later ? "Schedule" : "Start meeting"}
        </button>
      </div>
    </>}
  </dialog>;
}

/** For whoever runs a meeting: who is in it, taking someone out (their call
 * drops them), and adding people (they get its card; ringing, if it is on). */
export function MeetingPeople({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [roster, setRoster] = useState<MeetingRoster | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);
  useEffect(() => {
    let stopped = false;
    void meetingRoster(meetingId).then(result => {
      if (stopped) return;
      if ("error" in result) setError(result.error);
      else setRoster(result);
    });
    return () => { stopped = true; };
  }, [meetingId]);
  const change = (add: string[], remove: string[]) => start(async () => {
    setError("");
    const result = await setMeetingPeople(meetingId, add, remove);
    if ("error" in result) { setError(result.error); return; }
    setRoster(result);
    setAdding([]);
  });
  const outside = (roster?.choices ?? []).filter(person => person.outside && adding.includes(person.id)).map(person => person.name);
  const count = roster?.people.filter(person => !person.waiting).length ?? 0;

  return <dialog ref={dialog} className="chat-dialog meet-dialog meet-people-dialog" aria-label="People in the meeting" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="meet-dialog-head">
      <p className="chat-dialog-title">{roster ? roster.title : "People"}</p>
      <button type="button" className="chat-icon" aria-label="Close" onClick={onClose}><Close /></button>
    </div>
    {!roster ? (error ? null : <p className="meet-choose-loading" role="status">Loading people…</p>) : <>
      <p className="meet-choose-head"><span>In the meeting · {count}</span></p>
      <ul className="chat-people meet-roster" aria-label="In the meeting">
        {roster.people.map(person => <li key={person.id} className="chat-person meet-roster-row">
          <Avatar initials={initialsOf(person.name)} photo={person.photo} className="chat-avatar" who={person.id} />
          <span className="chat-person-text"><span>{person.name}</span>
            <span>{person.organizer ? "Called it" : person.waiting ? "Waiting for an admin's OK" : "Invited"}</span></span>
          {!person.organizer && !roster.over && <button type="button" className="chat-icon meet-roster-out" aria-label={`Take ${person.name} out`} title="Take out"
            disabled={busy} onClick={() => change([], [person.id])}><Close /></button>}
        </li>)}
      </ul>
      {!roster.over && <>
        <ChoosePeople people={roster.choices} chosen={adding} onChange={setAdding} label="Add people" />
        <OutsideNote names={outside} later />
      </>}
    </>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
    {roster && !roster.over && <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>Done</button>
      <button type="button" className="chat-dialog-button" data-primary="" disabled={busy || !adding.length} onClick={() => change(adding, [])}>
        {busy ? "Saving…" : outside.length ? `Ask the admin (${adding.length})` : `Add${adding.length ? ` ${adding.length}` : ""}`}
      </button>
    </div>}
  </dialog>;
}

/** A meeting's card in a chat: what it is, when, and how it stands, with a way
 * in for those invited. For whoever runs it (an admin, or the manager who
 * called it): start a planned one, change who is in it, call it off, or end it. */
export function MeetingCard({ card, me }: { card: Card; me: ChatMe }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [people, setPeople] = useState(false);
  const runs = me.admin || (!!card.by_id && card.by_id === me.id);
  const invited = !card.people || card.people.includes(me.id) || runs;
  const status = { scheduled: "Planned", live: "Live now", ended: "Ended", cancelled: "Called off", waiting: "Waiting for an admin's OK", refused: "Not allowed" }[card.status];
  const act = (run: () => Promise<{ error?: string }>, tab?: ReturnType<typeof meetingTab>) => start(async () => {
    setError("");
    const result = await run();
    if (result.error) { tab?.drop(); setError(result.error); }
    else tab?.go(card.id);
  });
  const open = card.status === "scheduled" || card.status === "live";
  const count = card.people?.length;
  return <div className="chat-meeting" data-status={card.status}>
    <p className="chat-request-kicker"><Video /> Meeting · <span className="chat-meeting-status">{status}</span></p>
    <p className="chat-request-name">{card.title}</p>
    <p className="chat-meeting-when">
      {card.status === "scheduled" || card.status === "waiting" ? `${when(card.starts_at)} · called by ${card.by}`
        : card.status === "live" ? `Started by ${card.by}`
          : card.ended_at ? `${card.status === "ended" ? "Ended" : card.status === "refused" ? "Not allowed" : "Called off"} ${when(card.ended_at)}` : ""}
      {count && (open || card.status === "waiting") ? ` · ${count} ${count === 1 ? "person" : "people"}` : ""}
    </p>
    {!invited && open && <p className="chat-meeting-when">You are not invited to this one.</p>}
    {(open || (runs && card.status === "waiting")) && <div className="chat-request-actions">
      {open && invited && <a className="admin-approve" href={`/meet/${card.id}`} target="_blank" rel="noopener">{card.status === "live" ? "Join" : "Open"}</a>}
      {runs && card.status === "scheduled" && <button type="button" className="account-button" disabled={busy}
        onClick={() => act(() => beginMeeting(card.id), meetingTab())}>Start now</button>}
      {runs && <button type="button" className="account-button" disabled={busy} onClick={() => setPeople(true)}><People /> People</button>}
      {runs && <button type="button" className="account-button account-danger" disabled={busy}
        onClick={() => act(() => endMeeting(card.id))}>{card.status === "live" ? "End" : "Call off"}</button>}
    </div>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
    {people && <MeetingPeople meetingId={card.id} onClose={() => setPeople(false)} />}
  </div>;
}

/** For the admins: a manager asks to meet people outside their team (or an
 * admin). Allowed, the meeting goes ahead with them; refused, it does not. */
export function MeetingRequestCard({ id, card, me, menuOn }: {
  id: string; card: Extract<Attachment, { type: "meeting_request" }>; me: ChatMe; menuOn: Record<string, unknown>;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const act = (allow: boolean) => start(async () => {
    setError("");
    const result = await decideMeeting(card.id, allow);
    if (result.error) setError(result.error);
  });
  const label = { waiting: "Waiting for an admin", allowed: "Allowed", refused: "Not allowed" }[card.status];
  return <div id={id} className="chat-request" data-status={card.status === "allowed" ? "approved" : card.status === "refused" ? "declined" : "waiting"} {...menuOn}>
    <p className="chat-request-kicker">Request to meet</p>
    <p className="chat-request-name">{card.title}</p>
    <dl className="chat-request-facts">
      <div><dt>Asked by</dt><dd>{card.by}</dd></div>
      <div><dt>Outside team</dt><dd>{card.people.join(", ")}</dd></div>
      <div><dt>When</dt><dd>{when(card.starts_at)}</dd></div>
    </dl>
    <p className="chat-request-status">{label}{card.decided_by ? ` by ${card.decided_by}` : ""}</p>
    {card.status === "waiting" && me.admin && <div className="chat-request-actions">
      <button type="button" className="admin-approve" aria-disabled={busy || undefined} onClick={busy ? undefined : () => act(true)}>{busy ? "Saving…" : "Allow"}</button>
      <button type="button" className="account-button" aria-disabled={busy || undefined} onClick={busy ? undefined : () => act(false)}>Refuse</button>
    </div>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
  </div>;
}

/** A meeting starting in one of your chats: it rings (a soft tone, for half a
 * minute) until you join or put it away. */
export function Ringing({ card, chatTitle, onClose }: { card: Card; chatTitle: string; onClose: () => void }) {
  useEffect(() => {
    let audio: AudioContext | null = null;
    try { audio = new AudioContext(); } catch { return; }
    const ring = () => {
      if (!audio || audio.state === "closed") return;
      void audio.resume().catch(() => {});
      for (const [offset, pitch] of [[0, 660], [0.18, 880], [0.9, 660], [1.08, 880]] as const) {
        const tone = audio.createOscillator(), level = audio.createGain();
        tone.frequency.value = pitch;
        tone.type = "sine";
        const at = audio.currentTime + offset;
        level.gain.setValueAtTime(0, at);
        level.gain.linearRampToValueAtTime(0.12, at + 0.02);
        level.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        tone.connect(level).connect(audio.destination);
        tone.start(at);
        tone.stop(at + 0.18);
      }
    };
    ring();
    const timer = window.setInterval(ring, 3000);
    const stop = window.setTimeout(onClose, 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
      void audio?.close();
    };
  }, [onClose]);

  return <div className="chat-ringing" role="alertdialog" aria-label={`Meeting: ${card.title}`}>
    <span className="chat-ringing-icon" aria-hidden="true"><Video /></span>
    <div className="chat-ringing-text">
      <p className="chat-ringing-title">{card.title}</p>
      <p className="chat-ringing-sub">{card.by} started a meeting{chatTitle === "KIASA" ? "" : ` in ${chatTitle}`}</p>
    </div>
    <a className="admin-approve" href={`/meet/${card.id}`} target="_blank" rel="noopener" onClick={onClose}>Join</a>
    <button type="button" className="chat-icon" aria-label="Not now" title="Not now" onClick={onClose}><Close /></button>
  </div>;
}
