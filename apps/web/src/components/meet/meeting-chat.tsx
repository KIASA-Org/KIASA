"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { initialsOf } from "@/lib/accounts/viewer";
import type { MeetStart } from "@/lib/meetings/types";
import { authorColor } from "../chat/chat-format";
import { Avatar } from "../site/avatar";
import { Clock, Close, Reply, Send, Trash } from "../site/icons";

/** A message in a meeting's chat. `pending`: still on its way, from this page. */
export type MeetMessage = {
  id: string; meeting_id: string; sender_id: string; name: string; body: string; created_at: string;
  reply_to?: string | null; reactions?: Record<string, string[]>; deleted_at?: string | null; pending?: boolean;
};

/** The reactions anyone can give (as the database allows them). */
const REACTIONS = ["👍", "❤️", "😂", "😮", "👏", "🎉", "🙏", "🔥"];
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const FIVE_MINUTES = 5 * 60_000;

/** The meeting's chat, for everyone in it, drawn as KIASA Chat draws a group:
 * bubbles in runs, each writer's photo and badge by their last, their name in
 * their colour. A message can be answered (its quote above the answer), given
 * a reaction, and deleted by its writer (or an admin). What was said since the
 * meeting began stays with it, so whoever comes in later reads it. Listened to
 * from the moment one is in, open or not, so a message that comes while it is
 * closed is counted (`onArrived`). */
export function MeetingChat({ supabase, meetingId, me, people, open, onClose, onArrived }: {
  supabase: SupabaseClient; meetingId: string; me: MeetStart["me"]; people: MeetStart["people"]; open: boolean;
  onClose: () => void; onArrived: (message: MeetMessage) => void;
}) {
  const [messages, setMessages] = useState<MeetMessage[]>([]);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState("");
  const [replying, setReplying] = useState<MeetMessage | null>(null);
  // The message whose buttons show (tapped, on a touch screen), and whose reactions are being chosen.
  const [focused, setFocused] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const photoOf = (id: string) => people.find(person => person.id === id)?.photo ?? (id === me.id ? me.photo : null);

  /** Kept once each, in time order; the database's copy in place of one still on its way; deleted ones gone. */
  const keep = (incoming: MeetMessage[], replacing?: string) => setMessages(current => {
    const byId = new Map(current.filter(entry => entry.id !== replacing).map(entry => [entry.id, entry]));
    for (const message of incoming) {
      if (message.deleted_at) byId.delete(message.id);
      else byId.set(message.id, message);
    }
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  });
  const arrived = useEffectEvent((message: MeetMessage) => {
    const known = messages.some(entry => entry.id === message.id);
    keep([message]);
    if (!known && message.sender_id !== me.id) onArrived(message);
  });
  const changed = useEffectEvent((message: MeetMessage) => keep([message]));

  useEffect(() => {
    let stopped = false;
    void supabase.from("meeting_messages").select("*").eq("meeting_id", meetingId).is("deleted_at", null).order("created_at").limit(300)
      .then(({ data }) => { if (!stopped && data) keep(data as MeetMessage[]); });
    const filter = `meeting_id=eq.${meetingId}`;
    const channel = supabase.channel(`meet-chat:${meetingId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "meeting_messages", filter }, payload => arrived(payload.new as MeetMessage))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meeting_messages", filter }, payload => changed(payload.new as MeetMessage))
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
  useEffect(() => { if (open) box.current?.focus(); }, [open, replying]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const answering = replying;
    setText("");
    setReplying(null);
    setFailed("");
    // Shown at once; the database's copy (with its own time and the writer's name) takes its place.
    const draft: MeetMessage = { id: `draft-${crypto.randomUUID()}`, meeting_id: meetingId, sender_id: me.id, name: me.name, body, created_at: new Date().toISOString(), reply_to: answering?.id ?? null, pending: true };
    keep([draft]);
    const { data, error } = await supabase.from("meeting_messages").insert({ meeting_id: meetingId, body, reply_to: answering?.id ?? null }).select("*").single();
    if (error || !data) {
      setMessages(current => current.filter(entry => entry.id !== draft.id));
      setText(body);
      setReplying(answering);
      setFailed("That message did not send. Please try again.");
      return;
    }
    keep([data as MeetMessage], draft.id);
  };

  /** A reaction, shown at once and saved; the same again takes it back. */
  const react = async (message: MeetMessage, emoji: string) => {
    setPicking(null);
    const before = message.reactions ?? {};
    const had = before[emoji]?.includes(me.id);
    const next = Object.fromEntries(Object.entries(before).map(([key, ids]) => [key, ids.filter(id => id !== me.id)]).filter(([, ids]) => ids.length));
    if (!had) next[emoji] = [...(next[emoji] ?? []), me.id];
    keep([{ ...message, reactions: next }]);
    const { error } = await supabase.rpc("react_meeting_message", { message: message.id, emoji });
    if (error) { keep([{ ...message, reactions: before }]); setFailed("That reaction did not save. Please try again."); }
  };

  const remove = async (message: MeetMessage) => {
    keep([{ ...message, deleted_at: new Date().toISOString() }]);
    const { error } = await supabase.rpc("delete_meeting_message", { message: message.id });
    if (error) { keep([message]); setFailed(error.code === "P0001" ? error.message : "That message was not deleted. Please try again."); }
  };

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
    if (event.key === "Escape") setReplying(null);
  };

  if (!open) return null;
  const byId = new Map(messages.map(message => [message.id, message]));
  const together = (a: MeetMessage, b: MeetMessage) => a.sender_id === b.sender_id && Date.parse(b.created_at) - Date.parse(a.created_at) < FIVE_MINUTES;
  return <aside className="meet-panel meet-chat" aria-label="Chat with everyone">
    <div className="meet-panel-head">
      <p className="meet-panel-title">Chat with everyone</p>
      <button type="button" className="chat-icon" aria-label="Close" onClick={onClose}><Close /></button>
    </div>
    <p className="meet-chat-note">Everyone in the meeting sees these messages, and anyone who joins later.</p>
    <ol ref={list} className="meet-chat-list" aria-live="polite">
      {messages.map((message, index) => {
        const mine = message.sender_id === me.id;
        const run = index > 0 && together(messages[index - 1], message);
        const lastOfRun = index === messages.length - 1 || !together(message, messages[index + 1]);
        const reply = message.reply_to ? byId.get(message.reply_to) : null;
        const reactions = Object.entries(message.reactions ?? {});
        const meta = <span className="chat-meta">{message.pending ? <Clock className="meet-chat-wait" /> : null}<span>{clock(message.created_at)}</span></span>;
        return <li key={message.id} className="chat-message" data-mine={mine || undefined} data-run={run || undefined} data-last={lastOfRun || undefined}
          data-open={focused === message.id || undefined}>
          <div className="chat-bubble-row">
            {!mine && <span className="chat-gutter" aria-hidden="true">
              {lastOfRun && <Avatar initials={initialsOf(message.name)} photo={photoOf(message.sender_id)} className="chat-avatar chat-gutter-avatar" who={message.sender_id} />}
            </span>}
            <div className="chat-bubble" onClick={() => setFocused(focused === message.id ? null : message.id)}>
              {!mine && !run && <p className="chat-author" style={{ color: authorColor(message.sender_id) }}>{message.name}</p>}
              {reply && <p className="chat-quote"><span>{reply.sender_id === me.id ? "You" : reply.name}</span>{reply.body}</p>}
              <p className="chat-text">{message.body}{!reactions.length && meta}</p>
              {reactions.length > 0 && <div className="chat-reactions">
                {reactions.map(([emoji, ids]) => <button key={emoji} type="button" className="chat-reaction" data-mine={ids.includes(me.id) || undefined}
                  aria-label={`${emoji} ${ids.length}${ids.includes(me.id) ? ", yours" : ""}`} onClick={event => { event.stopPropagation(); if (!message.pending) void react(message, emoji); }}>
                  <span className="chat-reaction-emoji" aria-hidden="true">{emoji}</span>
                  <span className="chat-reaction-count" aria-hidden="true">{ids.length}</span>
                </button>)}
                {meta}
              </div>}
            </div>
            {!message.pending && <div className="meet-chat-actions">
              <button type="button" aria-label="React" title="React" onClick={() => setPicking(picking === message.id ? null : message.id)}>🙂</button>
              <button type="button" aria-label="Reply" title="Reply" onClick={() => { setReplying(message); setFocused(null); }}><Reply /></button>
              {(mine || me.admin) && <button type="button" aria-label="Delete" title="Delete" data-danger="" onClick={() => void remove(message)}><Trash /></button>}
            </div>}
            {picking === message.id && <div className="meet-chat-picker" role="group" aria-label="Reactions">
              {REACTIONS.map(emoji => <button key={emoji} type="button" aria-label={emoji} onClick={() => void react(message, emoji)}>{emoji}</button>)}
            </div>}
          </div>
        </li>;
      })}
      {!messages.length && <li className="meet-chat-empty">No messages yet. Say hello to everyone.</li>}
    </ol>
    {failed && <p className="b-form-error" role="alert">{failed}</p>}
    <div className="chat-composer meet-chat-composer">
      {replying && <p className="chat-composer-context">
        <span>Replying to {replying.sender_id === me.id ? "yourself" : replying.name}</span>
        <span className="chat-composer-quote">{replying.body}</span>
        <button type="button" className="chat-icon" aria-label="Stop replying" onClick={() => setReplying(null)}><Close /></button>
      </p>}
      <div className="chat-composer-row">
        <div className="chat-input">
          <textarea ref={box} rows={1} value={text} maxLength={2000} placeholder="Send a message to everyone" aria-label="Message to everyone"
            onChange={event => setText(event.target.value)} onKeyDown={keys} />
        </div>
        <button type="button" className="chat-send" aria-label="Send" title="Send" aria-disabled={!text.trim() || undefined} onClick={() => void send()}><Send /></button>
      </div>
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
