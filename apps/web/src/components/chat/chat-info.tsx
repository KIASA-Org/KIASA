"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMe, ChatMember, ChatPerson, ChatSummary } from "@/lib/chat/types";
import { Avatar } from "../site/avatar";
import { Bookmark, Close, Pencil } from "../site/icons";
import { PhotoFrame } from "../site/your-photo";
import { chatTitle, initialsOf, lastSeen } from "./chat-format";

const LARGEST = 25 * 1024 * 1024;

/** About a chat, over the conversation: for a direct chat, the person (photo,
 * status, username, bio, who they are, asked for afresh each time it opens);
 * for a group, everyone in it, and a way to message any of them; for Saved
 * Messages and KIASA's notices, what they are. Those who may (the admin, and
 * the manager of a team's group) rename a group and change its photo here. */
export function ChatInfo({ me, chat, members, people, online, seenOf, photoOf, groupPhoto, canEdit, supabase, onMessage, onClose }: {
  me: ChatMe; chat: ChatSummary; members: ChatMember[]; people: ChatPerson[]; online: Set<string>;
  seenOf: (person: string) => string | null; photoOf: (person: string | null | undefined) => string | null;
  groupPhoto: string | null; canEdit: boolean;
  supabase: SupabaseClient; onMessage: (person: string) => void; onClose: () => void;
}) {
  const title = chatTitle(chat, members, me);
  const other = chat.kind === "direct" ? members.find(member => member.user_id !== me.id) : undefined;
  const [fresh, setFresh] = useState<{ username: string | null; bio: string; seen: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
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
      <p className="chat-panel-title">{editing ? "Edit group" : chat.kind === "group" ? "Group info" : chat.kind === "direct" ? "User info" : "About"}</p>
      {chat.kind === "group" && canEdit && !editing && <button type="button" className="chat-icon" aria-label="Edit the group" title="Edit" onClick={() => setEditing(true)}><Pencil /></button>}
      <button type="button" className="chat-icon" aria-label="Close" onClick={onClose}><Close /></button>
    </div>
    <div className="chat-panel-body">
      {editing
        ? <GroupEdit chat={chat} photo={groupPhoto} supabase={supabase} onDone={() => setEditing(false)} />
        : <div className="chat-profile">
          {chat.kind === "saved"
            ? <span className="chat-profile-photo chat-avatar" data-kind="saved" aria-hidden="true"><Bookmark /></span>
            : <Avatar initials={chat.kind === "notices" ? "K" : initialsOf(title)} photo={other ? photoOf(other.user_id) : groupPhoto} className="chat-profile-photo chat-avatar" kind={chat.kind} who={other?.user_id} />}
          <p className="chat-profile-name">{title}</p>
          <p className="chat-profile-status">{other ? status(other.user_id) : chat.kind === "group" ? `${members.length} members` : ""}</p>
        </div>}
      {chat.kind === "direct" && <dl className="chat-facts">
        {person?.username && <div><dt>Username</dt><dd>@{person.username}</dd></div>}
        {person?.bio && <div><dt>Bio</dt><dd>{person.bio}</dd></div>}
        {person && <div><dt>{person.admin ? "Role" : "Organization"}</dt><dd>{person.detail}</dd></div>}
      </dl>}
      {chat.kind === "saved" && <p className="chat-info-note">Forward messages here, or write notes to yourself. Only you see them.</p>}
      {chat.kind === "notices" && <p className="chat-info-note">{chat.title === "Account requests"
        ? "New account requests arrive here as cards, to approve or decline."
        : chat.title === "Contact requests" ? "Requests to message someone outside one's team arrive here, to approve or decline."
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

/** A group's name and photo, changed by those who may: the photo is placed
 * and made small here, as one's own is, and saved at once; the name with Save.
 * Everyone in the group sees both change, live. */
function GroupEdit({ chat, photo, supabase, onDone }: { chat: ChatSummary; photo: string | null; supabase: SupabaseClient; onDone: () => void }) {
  const [name, setName] = useState(chat.title ?? "");
  const [source, setSource] = useState<string | null>(null);
  const [shown, setShown] = useState<{ photo: string | null } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const chosen = useRef<string | null>(null);
  useEffect(() => () => { if (chosen.current) URL.revokeObjectURL(chosen.current); }, []);
  const show = (next: string | null) => {
    if (chosen.current) URL.revokeObjectURL(chosen.current);
    chosen.current = next;
    setSource(next);
  };
  const failed = (text: string) => { setBusy(""); setError(text); };
  const choose = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose a picture.");
    if (file.size > LARGEST) return setError("That picture is too large. Please choose one under 25 MB.");
    show(URL.createObjectURL(file));
  };
  const files = supabase.storage.from("avatars");

  /** The new file first, then the group's record of it, then the old file goes. */
  const savePhoto = async (blob: Blob | null) => {
    setBusy(blob ? "Saving the photo…" : "Removing the photo…");
    setError("");
    const path = blob ? `${chat.id}/${crypto.randomUUID()}.${blob.type === "image/webp" ? "webp" : "jpg"}` : null;
    if (blob && path) {
      const { error: refused } = await files.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
      if (refused) return failed("The photo could not be saved. Please try again.");
    }
    const { data: before, error: refused } = await supabase.rpc("edit_group", { chat: chat.id, new_photo: path, change_photo: true });
    if (refused) {
      if (path) void files.remove([path]);
      return failed(refused.code === "P0001" ? refused.message : "The photo could not be saved. Please try again.");
    }
    if (typeof before === "string") void files.remove([before]);
    setShown({ photo: path ? files.getPublicUrl(path).data.publicUrl : null });
    show(null);
    setBusy("");
  };

  const saveName = async () => {
    setBusy("Saving…");
    setError("");
    const { error: refused } = await supabase.rpc("edit_group", { chat: chat.id, new_title: name });
    if (refused) return failed(refused.code === "P0001" ? refused.message : "The name could not be saved. Please try again.");
    setBusy("");
    onDone();
  };

  const now = shown ? shown.photo : photo;
  return <div className="chat-group-edit">
    {source
      ? <PhotoFrame source={source} busy={!!busy} onSave={blob => void savePhoto(blob)} onCancel={() => show(null)}
        onUnreadable={() => { show(null); setError("That picture could not be opened here. Please choose a JPEG, PNG or WebP picture."); }} />
      : <>
        <Avatar initials={initialsOf(name || "?")} photo={now} className="chat-profile-photo chat-avatar" kind="group" />
        <div className="photo-actions">
          <label className={`account-button photo-choose${busy ? " photo-wait" : ""}`}>
            {now ? "Choose another photo" : "Choose a photo"}
            <input type="file" accept="image/*" disabled={!!busy} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
          </label>
          {now && <button type="button" className="account-button" disabled={!!busy} onClick={() => void savePhoto(null)}>Remove</button>}
        </div>
      </>}
    <label className="chat-field"><span>Group name</span>
      <input value={name} maxLength={80} onChange={event => setName(event.target.value)} />
    </label>
    {busy && <p className="photo-status" role="status">{busy}</p>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="photo-actions">
      <button type="button" className="b-submit" aria-disabled={!!busy || !name.trim() || undefined} onClick={busy || !name.trim() ? undefined : () => void saveName()}>Save</button>
      <button type="button" className="account-button" disabled={!!busy} onClick={onDone}>Done</button>
    </div>
  </div>;
}
