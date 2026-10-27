"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Attachment } from "@/lib/chat/types";
import { beginMeeting, endMeeting, scheduleMeeting, startMeeting } from "@/lib/meetings/actions";
import { Calendar, Close, Video } from "../site/icons";

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

/** For admins, from a chat's bar: a meeting now (everyone in the chat is rung),
 * or planned for later (its card waits in the chat). */
export function MeetingDialog({ chatId, chatTitle, onClose }: { chatId: string; chatTitle: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(`${chatTitle} meeting`);
  const [later, setLater] = useState(false);
  const [at, setAt] = useState(soon);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);

  const go = () => {
    setError("");
    if (later) {
      start(async () => {
        const result = await scheduleMeeting(chatId, title, new Date(at).toISOString());
        if (result.error) setError(result.error);
        else onClose();
      });
      return;
    }
    const tab = meetingTab();
    start(async () => {
      const result = await startMeeting(chatId, title);
      if (result.error || !result.id) { tab.drop(); setError(result.error ?? "That did not work. Please try again."); return; }
      tab.go(result.id);
      onClose();
    });
  };

  return <dialog ref={dialog} className="chat-dialog meet-dialog" aria-label="New meeting" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <p className="chat-dialog-title">New meeting</p>
    <p className="chat-dialog-text">Everyone in {chatTitle} can join. Calls go straight between your computers; up to about six people on video works best.</p>
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
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="chat-dialog-button" data-primary="" onClick={go} disabled={busy || !title.trim()}>
        {busy ? "Working…" : later ? "Schedule" : "Start meeting"}
      </button>
    </div>
  </dialog>;
}

/** A meeting's card in its chat: what it is, when, and how it stands, with a
 * way in. For admins: start a planned one, call it off, or end a live one. */
export function MeetingCard({ card, admin }: { card: Card; admin: boolean }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const status = { scheduled: "Planned", live: "Live now", ended: "Ended", cancelled: "Called off" }[card.status];
  const act = (run: () => Promise<{ error?: string }>, tab?: ReturnType<typeof meetingTab>) => start(async () => {
    setError("");
    const result = await run();
    if (result.error) { tab?.drop(); setError(result.error); }
    else tab?.go(card.id);
  });
  const open = card.status === "scheduled" || card.status === "live";
  return <div className="chat-meeting" data-status={card.status}>
    <p className="chat-request-kicker"><Video /> Meeting · <span className="chat-meeting-status">{status}</span></p>
    <p className="chat-request-name">{card.title}</p>
    <p className="chat-meeting-when">
      {card.status === "scheduled" ? `${when(card.starts_at)} · called by ${card.by}`
        : card.status === "live" ? `Started by ${card.by}`
          : card.ended_at ? `${card.status === "ended" ? "Ended" : "Called off"} ${when(card.ended_at)}` : ""}
    </p>
    {open && <div className="chat-request-actions">
      <a className="admin-approve" href={`/meet/${card.id}`} target="_blank" rel="noopener">{card.status === "live" ? "Join" : "Open"}</a>
      {admin && card.status === "scheduled" && <button type="button" className="account-button" disabled={busy}
        onClick={() => act(() => beginMeeting(card.id), meetingTab())}>Start now</button>}
      {admin && <button type="button" className="account-button account-danger" disabled={busy}
        onClick={() => act(() => endMeeting(card.id))}>{card.status === "live" ? "End" : "Call off"}</button>}
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
      <p className="chat-ringing-sub">{card.by} started a meeting in {chatTitle}</p>
    </div>
    <a className="admin-approve" href={`/meet/${card.id}`} target="_blank" rel="noopener" onClick={onClose}>Join</a>
    <button type="button" className="chat-icon" aria-label="Not now" title="Not now" onClick={onClose}><Close /></button>
  </div>;
}
