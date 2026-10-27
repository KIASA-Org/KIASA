"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMe, ChatMember, ChatPerson, ChatSummary } from "@/lib/chat/types";
import { Avatar } from "../site/avatar";
import { Bookmark, Close } from "../site/icons";
import { chatTitle, initialsOf, lastSeen } from "./chat-format";

/** About a chat, over the conversation: for a direct chat, the person (photo,
 * status, username, bio, who they are, asked for afresh each time it opens);
 * for a group, everyone in it, and a way to message any of them; for Saved
 * Messages and KIASA's notices, what they are. */
export function ChatInfo({ me, chat, members, people, online, seenOf, photoOf, supabase, onMessage, onClose }: {
  me: ChatMe; chat: ChatSummary; members: ChatMember[]; people: ChatPerson[]; online: Set<string>;
  seenOf: (person: string) => string | null; photoOf: (person: string | null | undefined) => string | null;
  supabase: SupabaseClient; onMessage: (person: string) => void; onClose: () => void;
}) {
  const title = chatTitle(chat, members, me);
  const other = chat.kind === "direct" ? members.find(member => member.user_id !== me.id) : undefined;
  const [fresh, setFresh] = useState<{ username: string | null; bio: string; seen: string | null } | null>(null);
  const otherId = other?.user_id;
  useEffect(() => {
    if (!otherId) return;
    let stopped = false;
    void Promise.all([
      supabase.from("chat_profiles").select("username, bio").eq("user_id", otherId).maybeSingle(),
      supabase.from("seen").select("at").eq("user_id", otherId).maybeSingle(),
    ]).then(([profile, seen]) => {
      if (!stopped) setFresh({ username: profile.data?.username ?? null, bio: profile.data?.bio ?? "", seen: seen.data?.at ?? null });
    });
    return () => { stopped = true; };
  }, [otherId, supabase]);
  const known = other ? people.find(entry => entry.id === other.user_id) : undefined;
  const person = known && fresh ? { ...known, username: fresh.username, bio: fresh.bio } : known;
  const status = (id: string) => online.has(id) ? "online" : lastSeen(id === otherId && fresh?.seen && fresh.seen > (seenOf(id) ?? "") ? fresh.seen : seenOf(id));

  return <aside className="chat-info" aria-label={`About ${title}`}>
    <div className="chat-panel-head">
      <p className="chat-panel-title">{chat.kind === "group" ? "Group info" : chat.kind === "direct" ? "User info" : "About"}</p>
      <button type="button" className="chat-icon" aria-label="Close" onClick={onClose}><Close /></button>
    </div>
    <div className="chat-panel-body">
      <div className="chat-profile">
        {chat.kind === "saved"
          ? <span className="chat-profile-photo chat-avatar" data-kind="saved" aria-hidden="true"><Bookmark /></span>
          : <Avatar initials={chat.kind === "notices" ? "K" : initialsOf(title)} photo={photoOf(other?.user_id)} className="chat-profile-photo chat-avatar" kind={chat.kind} who={other?.user_id} />}
        <p className="chat-profile-name">{title}</p>
        <p className="chat-profile-status">{other ? status(other.user_id) : chat.kind === "group" ? `${members.length} members` : ""}</p>
      </div>
      {chat.kind === "direct" && <dl className="chat-facts">
        {person?.username && <div><dt>Username</dt><dd>@{person.username}</dd></div>}
        {person?.bio && <div><dt>Bio</dt><dd>{person.bio}</dd></div>}
        {person && <div><dt>{person.admin ? "Role" : "Organization"}</dt><dd>{person.detail}</dd></div>}
      </dl>}
      {chat.kind === "saved" && <p className="chat-info-note">Forward messages here, or write notes to yourself. Only you see them.</p>}
      {chat.kind === "notices" && <p className="chat-info-note">{chat.title === "Account requests"
        ? "New account requests arrive here as cards, to approve or decline."
        : "News from KIASA about your account."}</p>}
      {chat.kind === "group" && <ul className="chat-people">
        {members.map(member => <li key={member.user_id}>
          <button type="button" className="chat-person" disabled={member.user_id === me.id} onClick={() => onMessage(member.user_id)}>
            <Avatar initials={initialsOf(member.name)} photo={photoOf(member.user_id)} className="chat-avatar" who={member.user_id}>
              {online.has(member.user_id) && <span className="chat-online" />}
            </Avatar>
            <span className="chat-person-text">
              <span>{member.user_id === me.id ? `${member.name} (you)` : member.name}</span>
              <span>{member.role === "owner" ? "Owner · " : ""}{status(member.user_id)}</span>
            </span>
          </button>
        </li>)}
      </ul>}
    </div>
  </aside>;
}
