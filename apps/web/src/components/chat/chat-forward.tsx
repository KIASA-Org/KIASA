"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMe, ChatMember, ChatSummary } from "@/lib/chat/types";
import { Avatar } from "../site/avatar";
import { Bookmark, Search } from "../site/icons";
import { chatTitle, initialsOf } from "./chat-format";

/** Where to forward messages: Saved Messages, or any chat one may write in. */
export function ForwardPicker({ me, chats, members, count, photoOf, onPick, onClose }: {
  me: ChatMe; chats: ChatSummary[]; members: Record<string, ChatMember[]>; count: number;
  photoOf: (person: string | null | undefined) => string | null;
  onPick: (target: string | "saved") => Promise<string | null>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = chats.filter(chat => chat.kind !== "notices" && chat.kind !== "saved"
    && words.every(word => chatTitle(chat, members[chat.id] ?? [], me).toLowerCase().includes(word)));
  const pick = async (target: string | "saved") => {
    setBusy(true);
    setError("");
    const failed = await onPick(target);
    setBusy(false);
    if (failed) setError(failed);
  };

  return <dialog ref={dialog} className="chat-dialog chat-forward" aria-label="Forward to" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <p className="chat-dialog-title">Forward {count === 1 ? "message" : `${count} messages`} to…</p>
    <label className="chat-search">
      <Search />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats" autoFocus />
    </label>
    <ul className="chat-people">
      {!words.length && <li>
        <button type="button" className="chat-person" disabled={busy} onClick={() => void pick("saved")}>
          <span className="chat-avatar" data-kind="saved" aria-hidden="true"><Bookmark /></span>
          <span className="chat-person-text"><span>Saved Messages</span><span>Keep them for yourself</span></span>
        </button>
      </li>}
      {shown.map(chat => {
        const list = members[chat.id] ?? [];
        const title = chatTitle(chat, list, me);
        const other = chat.kind === "direct" ? list.find(member => member.user_id !== me.id) : undefined;
        return <li key={chat.id}>
          <button type="button" className="chat-person" disabled={busy} onClick={() => void pick(chat.id)}>
            <Avatar initials={initialsOf(title)} photo={photoOf(other?.user_id)} className="chat-avatar" kind={chat.kind} who={other?.user_id} />
            <span className="chat-person-text"><span>{title}</span><span>{chat.kind === "group" ? `${list.length} members` : "Direct message"}</span></span>
          </button>
        </li>;
      })}
      {words.length > 0 && !shown.length && <li className="chat-list-empty">No chat called “{query.trim()}”.</li>}
    </ul>
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>Cancel</button>
    </div>
  </dialog>;
}
