"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { initialsOf } from "@/lib/accounts/viewer";
import type { MeetStart } from "@/lib/meetings/types";
import { Avatar } from "../site/avatar";
import { Close, Send } from "../site/icons";

/** A message in a meeting's chat. `pending`: still on its way, from this page. */
export type MeetMessage = { id: string; meeting_id: string; sender_id: string; name: string; body: string; created_at: string; pending?: boolean };

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The meeting's chat, for everyone in it: what was said since the meeting
 * began (kept with the meeting, so whoever comes in later reads it), and the
 * box to write in. Listened to from the moment one is in, open or not, so a
 * message that comes while it is closed is counted (`onArrived`). */
export function MeetingChat({ supabase, meetingId, me, open, onClose, onArrived }: {
  supabase: SupabaseClient; meetingId: string; me: MeetStart["me"]; open: boolean;
  onClose: () => void; onArrived: (message: MeetMessage) => void;
}) {
  const [messages, setMessages] = useState<MeetMessage[]>([]);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  /** Kept once each, in time order: the database's copy in place of one still on its way. */
  const keep = (incoming: MeetMessage[], replacing?: string) => setMessages(current => {
    const byId = new Map(current.filter(entry => entry.id !== replacing).map(entry => [entry.id, entry]));
    for (const message of incoming) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  });
  const arrived = useEffectEvent((message: MeetMessage) => {
    const known = messages.some(entry => entry.id === message.id);
    keep([message]);
    if (!known && message.sender_id !== me.id) onArrived(message);
  });

  useEffect(() => {
    let stopped = false;
    void supabase.from("meeting_messages").select("*").eq("meeting_id", meetingId).order("created_at").limit(300)
      .then(({ data }) => { if (!stopped && data) keep(data as MeetMessage[]); });
    const channel = supabase.channel(`meet-chat:${meetingId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "meeting_messages", filter: `meeting_id=eq.${meetingId}` }, payload => arrived(payload.new as MeetMessage))
      .subscribe();
    return () => {
      stopped = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, meetingId]);

  // Opened, or a new message while open: the newest in view.
  const last = messages[messages.length - 1]?.id;
  useLayoutEffect(() => {
    const element = list.current;
    if (open && element) element.scrollTop = element.scrollHeight;
  }, [open, last]);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    setFailed("");
    // Shown at once; the database's copy (with its own time and the writer's name) takes its place.
    const draft: MeetMessage = { id: `draft-${crypto.randomUUID()}`, meeting_id: meetingId, sender_id: me.id, name: me.name, body, created_at: new Date().toISOString(), pending: true };
    keep([draft]);
    const { data, error } = await supabase.from("meeting_messages").insert({ meeting_id: meetingId, body }).select("*").single();
    if (error || !data) {
      setMessages(current => current.filter(entry => entry.id !== draft.id));
      setText(body);
      setFailed("That message did not send. Please try again.");
      return;
    }
    keep([data as MeetMessage], draft.id);
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  };

  if (!open) return null;
  return <aside className="meet-panel meet-chat" aria-label="Chat with everyone">
    <div className="meet-panel-head">
      <p className="meet-panel-title">Chat with everyone</p>
      <button type="button" className="chat-icon" aria-label="Close" onClick={onClose}><Close /></button>
    </div>
    <p className="meet-chat-note">Everyone in the meeting sees these messages, and anyone who joins later.</p>
    <ol ref={list} className="meet-chat-list" aria-live="polite">
      {messages.map((message, index) => {
        const mine = message.sender_id === me.id;
        const run = index > 0 && messages[index - 1].sender_id === message.sender_id;
        return <li key={message.id} className="meet-chat-message" data-mine={mine || undefined} data-run={run || undefined} data-pending={message.pending || undefined}>
          {!run && <p className="meet-chat-who">
            {!mine && <Avatar initials={initialsOf(message.name)} className="chat-avatar meet-chat-photo" who={message.sender_id} />}
            <span>{mine ? "You" : message.name}</span>
            <time dateTime={message.created_at}>{clock(message.created_at)}</time>
          </p>}
          <p className="meet-chat-body">{message.body}</p>
        </li>;
      })}
      {!messages.length && <li className="meet-chat-empty">No messages yet. Say hello to everyone.</li>}
    </ol>
    {failed && <p className="b-form-error" role="alert">{failed}</p>}
    <div className="meet-chat-write">
      <textarea ref={box} rows={1} value={text} maxLength={2000} placeholder="Send a message to everyone" aria-label="Message to everyone"
        onChange={event => setText(event.target.value)} onKeyDown={keys} />
      <button type="button" className="meet-chat-send" aria-label="Send" title="Send" aria-disabled={!text.trim() || undefined} onClick={() => void send()}><Send /></button>
    </div>
  </aside>;
}

/** A message from someone while the chat is closed: shown for a few seconds; a click opens the chat. */
export function MessageToast({ message, onOpen, onGone }: { message: MeetMessage; onOpen: () => void; onGone: () => void }) {
  const gone = useEffectEvent(onGone);
  useEffect(() => {
    const timer = window.setTimeout(() => gone(), 6000);
    return () => window.clearTimeout(timer);
  }, []);
  return <button type="button" className="meet-toast meet-toast-message" onClick={onOpen}>
    <strong>{message.name}</strong>
    <span>{message.body.length > 140 ? `${message.body.slice(0, 140)}…` : message.body}</span>
  </button>;
}
