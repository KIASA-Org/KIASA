"use client";

import { useState, useTransition } from "react";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ChatMe, ChatMember, ChatPerson } from "@/lib/chat/types";
import { Avatar } from "../site/avatar";
import { Close, Search } from "../site/icons";
import { findable, initialsOf } from "./chat-format";
import type { ChatDraft } from "./chat-state";

/** Choosing people: one, for a direct chat; several and a name, for a new
 * group (admins only); or several to add to a group. A direct chat there is
 * already opens at once; anything new is made in one trip to the database,
 * whose rules decide who may chat with whom. People are found by name, by
 * who they are, or by @username. */
export function ChatPicker({ mode, heading: named, me, people, supabase, chatId, exclude = [], directWith, onClose, onDone }: {
  mode: "direct" | "group" | "add"; heading?: string; me: ChatMe; people: ChatPerson[]; supabase: SupabaseClient; chatId?: string; exclude?: string[];
  directWith?: (person: string) => string | undefined;
  onClose: () => void; onDone: (chatId: string, draft?: ChatDraft) => void;
}) {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = people.filter(person => person.id !== me.id && !exclude.includes(person.id) && findable(person, words));

  /** How a chat just made looks until the chat list is asked for again. */
  const draft = (id: string, kind: "direct" | "group", ids: string[]): ChatDraft => {
    const now = new Date().toISOString();
    const member = (user: string, name: string, role: ChatMember["role"]): ChatMember => ({ chat_id: id, user_id: user, name, role, last_read_at: now });
    return {
      chat: {
        id, kind, title: kind === "group" ? title.trim() : null, last_message_at: now, unread: 0, last_body: null, last_sender: null, last_kind: null, last_file: null,
        pinned_at: null, muted: false, archived: false, marked_unread: false,
      },
      members: [member(me.id, me.name, kind === "group" ? "owner" : "member"),
        ...ids.map(user => member(user, people.find(person => person.id === user)?.name ?? "", "member"))],
    };
  };

  const finish = (ids: string[]) => start(async () => {
    setError("");
    if (mode === "direct") {
      const known = directWith?.(ids[0]);
      if (known) return onDone(known);
      const { data, error: failed } = await supabase.rpc("open_direct", { other: ids[0] });
      if (failed || !data) return setError(problem(failed, me));
      onDone(data as string, draft(data as string, "direct", ids));
    } else if (mode === "group") {
      const { data, error: failed } = await supabase.rpc("create_group", { group_title: title, member_ids: ids });
      if (failed || !data) return setError(problem(failed, me));
      onDone(data as string, draft(data as string, "group", ids));
    } else if (chatId) {
      const { error: failed } = await supabase.rpc("add_to_group", { chat: chatId, member_ids: ids });
      if (failed) return setError(problem(failed, me));
      onDone(chatId);
    }
  });

  const heading = named ?? (mode === "direct" ? "New message" : mode === "group" ? "New group" : "Add people");
  return <div className="chat-picker" role="dialog" aria-label={heading}>
    <div className="chat-picker-head">
      <p className="chat-picker-title">{heading}</p>
      <button type="button" className="chat-icon" aria-label="Close" onClick={onClose}><Close /></button>
    </div>
    {mode === "group" && <label className="chat-field"><span>Group name</span>
      <input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} placeholder="For example: Platform team" autoFocus />
    </label>}
    <label className="chat-search">
      <Search />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search people" aria-label="Search people" autoFocus={mode !== "group"} />
    </label>
    <ul className="chat-people">
      {shown.map(person => <li key={person.id}>
        {mode === "direct"
          ? <button type="button" className="chat-person" disabled={busy} onClick={() => finish([person.id])}>
            <Avatar initials={initialsOf(person.name)} photo={person.photo} className="chat-avatar" who={person.id} />
            <span className="chat-person-text"><span>{person.name}</span><span>{person.detail}</span></span>
          </button>
          : <label className="chat-person">
            <input type="checkbox" checked={chosen.includes(person.id)}
              onChange={event => setChosen(current => event.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} />
            <Avatar initials={initialsOf(person.name)} photo={person.photo} className="chat-avatar" who={person.id} />
            <span className="chat-person-text"><span>{person.name}</span><span>{person.detail}</span></span>
          </label>}
      </li>)}
      {!shown.length && <li className="chat-list-empty">{people.length > 1 ? "No one by that name." : "No one else can chat yet: approve someone first."}</li>}
    </ul>
    {error && <p className="b-form-error" role="alert">{error}</p>}
    {mode !== "direct" && <button type="button" className="b-submit chat-picker-go" aria-disabled={busy || undefined}
      onClick={busy ? undefined : () => finish(chosen)}>
      {busy ? "Working…" : mode === "group" ? `Make the group${chosen.length ? ` (${chosen.length + 1})` : ""}` : `Add ${chosen.length || ""}`.trim()}
    </button>}
  </div>;
}

/** What went wrong, in words: the database's own reason when it gave one. */
function problem(error: PostgrestError | null, me: ChatMe) {
  if (error?.code === "PGRST202") return me.admin
    ? "KIASA Chat needs its latest database update: in Supabase's SQL Editor, run supabase/migrations/20261026210000_chat_speed.sql."
    : "KIASA Chat is being updated. Please try again a little later.";
  if (error?.code === "P0001" && error.message) return error.message;
  return "That did not work. Please try again.";
}
