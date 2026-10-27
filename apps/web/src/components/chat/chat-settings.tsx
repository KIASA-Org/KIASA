"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshBadge } from "@/lib/accounts/actions";
import type { ChatMe, ChatPerson } from "@/lib/chat/types";
import { ArrowLeft, Bell, Bookmark, People, Pencil } from "../site/icons";
import { YourPhoto } from "../site/your-photo";

const NOT_SET_UP = "Profiles need the latest database update: an admin runs supabase/migrations/20261026233000_chat_more.sql in Supabase's SQL Editor.";

/** Settings, in the chat list's place: one's photo (to change there), name and
 * status; username, bio and who one is; Saved Messages, alerts on this
 * computer, and the account page. */
export function SettingsPanel({ me, self, realtime, onBack, onEdit, onSaved }: {
  me: ChatMe; self: ChatPerson | undefined; realtime: { url: string; key: string };
  onBack: () => void; onEdit: () => void; onSaved: () => void;
}) {
  return <section className="chat-panel" aria-label="Settings">
    <div className="chat-panel-head">
      <button type="button" className="chat-icon" aria-label="Back to chats" onClick={onBack}><ArrowLeft /></button>
      <p className="chat-panel-title">Settings</p>
      <button type="button" className="chat-icon" aria-label="Edit profile" title="Edit profile" onClick={onEdit}><Pencil /></button>
    </div>
    <div className="chat-panel-body">
      <div className="chat-profile">
        <YourPhoto person={{ id: me.id, name: me.name }} photo={me.photo} realtime={realtime} className="chat-profile-photo" align="start" />
        <p className="chat-profile-name">{me.name}</p>
        <p className="chat-profile-status">online</p>
      </div>
      <dl className="chat-facts">
        <div><dt>Username</dt><dd>{self?.username ? `@${self.username}` : <button type="button" className="chat-link" onClick={onEdit}>Add a username</button>}</dd></div>
        <div><dt>Bio</dt><dd>{self?.bio || <button type="button" className="chat-link" onClick={onEdit}>Add a few words about yourself</button>}</dd></div>
        <div><dt>{me.admin ? "Role" : "Organization"}</dt><dd>{self?.detail ?? (me.admin ? "KIASA admin" : "")}</dd></div>
        <div><dt>Email</dt><dd>{me.email}</dd></div>
      </dl>
      <ul className="chat-panel-items">
        <li><button type="button" onClick={onSaved}><Bookmark /><span>Saved Messages</span></button></li>
        <li><Alerts /></li>
        <li><Link href={me.admin ? "/admin" : "/account"}><People /><span>{me.admin ? "Admin page" : "Your account"}</span></Link></li>
      </ul>
    </div>
  </section>;
}

const quiet = () => () => {};
const permission = () => ("Notification" in window ? Notification.permission : "unsupported");

/** Alerts on this computer for new messages while KIASA Chat is in another tab. */
function Alerts() {
  const [asked, setAsked] = useState<string | null>(null);
  const current = useSyncExternalStore(quiet, permission, () => "default");
  const state = asked ?? current;
  const label = state === "granted" ? "On" : state === "denied" ? "Blocked in this browser" : state === "unsupported" ? "Not in this browser" : "Off: turn on";
  return <button type="button" disabled={state !== "default"} onClick={() => void Notification.requestPermission().then(setAsked)}>
    <Bell /><span>Alerts on this computer</span><span className="chat-panel-note">{label}</span>
  </button>;
}

/** Editing one's profile: photo, first and last name, a short bio and a
 * username others can find one by. The name changes everywhere one appears. */
export function EditProfile({ me, self, realtime, supabase, onBack, onSaved }: {
  me: ChatMe; self: ChatPerson | undefined; realtime: { url: string; key: string }; supabase: SupabaseClient;
  onBack: () => void; onSaved: () => void;
}) {
  const [first, setFirst] = useState(me.name.split(" ")[0] ?? "");
  const [last, setLast] = useState(me.name.split(" ").slice(1).join(" "));
  const [bio, setBio] = useState(self?.bio ?? "");
  const [username, setUsername] = useState(self?.username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    const { error: refused } = await supabase.rpc("update_profile", {
      full_name: `${first.trim()} ${last.trim()}`.trim(), about: bio.trim(), handle: username.trim() || null,
    });
    if (refused) {
      setBusy(false);
      return setError(refused.code === "P0001" ? refused.message : refused.code === "PGRST202" ? NOT_SET_UP
        : refused.code === "23505" ? "That username is taken. Please choose another." : "Your profile could not be saved. Please try again.");
    }
    // The name in the page's bar and on every page's header.
    await refreshBadge();
    setBusy(false);
    onSaved();
  };

  return <section className="chat-panel" aria-label="Edit profile">
    <div className="chat-panel-head">
      <button type="button" className="chat-icon" aria-label="Back to settings" onClick={onBack}><ArrowLeft /></button>
      <p className="chat-panel-title">Edit profile</p>
    </div>
    <form className="chat-panel-body chat-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="chat-profile">
        <YourPhoto person={{ id: me.id, name: me.name }} photo={me.photo} realtime={realtime} className="chat-profile-photo" align="start" />
      </div>
      <label className="chat-field"><span>First name</span>
        <input value={first} onChange={event => setFirst(event.target.value)} maxLength={40} required autoComplete="given-name" />
      </label>
      <label className="chat-field"><span>Last name</span>
        <input value={last} onChange={event => setLast(event.target.value)} maxLength={40} autoComplete="family-name" />
      </label>
      <label className="chat-field"><span>Bio (optional)</span>
        <textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={140} rows={3} />
        <small>{140 - bio.length} left. A few words: what you do, where you work from.</small>
      </label>
      <label className="chat-field"><span>Username (optional)</span>
        <span className="chat-at"><span aria-hidden="true">@</span>
          <input value={username} onChange={event => setUsername(event.target.value.replace(/^@/, ""))} maxLength={32} autoComplete="off" spellCheck={false} />
        </span>
        <small>People at KIASA can find you by it. a–z, 0–9 and underscores, at least 5.</small>
      </label>
      {error && <p className="b-form-error" role="alert">{error}</p>}
      <button type="submit" className="b-submit chat-save" aria-disabled={busy || undefined}>{busy ? "Saving…" : "Save"}</button>
    </form>
  </section>;
}
