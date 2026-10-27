"use client";

import { useCallback, useState, type MouseEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMe, ChatMember, ChatPerson, ChatSummary } from "@/lib/chat/types";
import { Avatar } from "../site/avatar";
import { Archive, ArrowLeft, BellOff, Bookmark, Check, Gear, Menu as MenuIcon, Pencil, People, Pin, Search, Ticks } from "../site/icons";
import { chatTitle, findable, initialsOf, shortWhen, useInBrowser } from "./chat-format";
import { Menu, useLongPress, type MenuItem, type MenuPlace } from "./chat-menu";
import { ChatPicker } from "./chat-picker";
import { AlertsPrompt, EditProfile, SettingsPanel } from "./chat-settings";
import type { ChatDraft } from "./chat-state";

type View = "chats" | "archived" | "settings" | "profile";
type OpenMenu = { at: MenuPlace; items: MenuItem[]; label: string };

/** The chat list: every chat this person is in, pinned ones first, then the
 * newest, each with its last message, when, and how many are unread. A search
 * narrows it; new chats start here. Archived chats sit apart, under one row.
 * The ☰ menu leads to Saved Messages, contacts, the archive and Settings, which
 * open in the list's place. */
export function ChatList({ me, chats, members, people, online, active, live, supabase, realtime, photoOf, chatMenu, onOpen, onMade, onPerson, onSaved }: {
  me: ChatMe; chats: ChatSummary[]; members: Record<string, ChatMember[]>; people: ChatPerson[]; online: Set<string>;
  active: string | null; live: "connecting" | "live" | "paused"; supabase: SupabaseClient; realtime: { url: string; key: string };
  photoOf: (person: string | null | undefined) => string | null; chatMenu: (chat: ChatSummary) => MenuItem[];
  onOpen: (chatId: string) => void; onMade: (chatId: string, draft?: ChatDraft) => void; onPerson: (person: string) => void; onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<"direct" | "group" | "contacts" | null>(null);
  const [view, setView] = useState<View>("chats");
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const self = people.find(person => person.id === me.id);

  if (view === "settings" || view === "profile") return <aside className="chat-list" aria-label="Chats">
    {view === "settings"
      ? <SettingsPanel me={me} self={self} realtime={realtime} onBack={() => setView("chats")} onEdit={() => setView("profile")}
        onSaved={() => { setView("chats"); onSaved(); }} />
      : <EditProfile me={me} self={self} realtime={realtime} supabase={supabase} onBack={() => setView("settings")} onSaved={() => setView("settings")} />}
  </aside>;

  const archived = chats.filter(chat => chat.archived);
  const inView = view === "archived" ? archived : chats.filter(chat => !chat.archived);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = inView.filter(chat => words.every(word => chatTitle(chat, members[chat.id] ?? [], me).toLowerCase().includes(word)));
  // Searching finds people too, as in Telegram: anyone one may write to whose
  // chat is not among the results (one deleted from the list, or none yet).
  const found = view === "chats" && words.length ? people.filter(person => person.id !== me.id && findable(person, words)
    && !shown.some(chat => chat.kind === "direct" && (members[chat.id] ?? []).some(member => member.user_id === person.id))) : [];
  const directWith = (person: string) => chats.find(chat => chat.kind === "direct" && (members[chat.id] ?? []).some(member => member.user_id === person))?.id;
  const archivedUnread = archived.reduce((sum, chat) => sum + chat.unread, 0);

  const mainMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({
      at: { x: box.left, y: box.bottom + 6 }, label: "Menu", items: [
        { label: "Saved Messages", icon: <Bookmark />, onSelect: onSaved },
        { label: "Contacts", icon: <People />, onSelect: () => setPicking("contacts") },
        ...(archived.length ? [{ label: `Archived chats (${archived.length})`, icon: <Archive />, onSelect: () => setView("archived") }] : []),
        { label: "Settings", icon: <Gear />, onSelect: () => setView("settings") },
      ],
    });
  };
  const newChat = (event: MouseEvent<HTMLButtonElement>) => {
    if (!me.admin) { setPicking("direct"); return; }
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({
      at: { x: box.right, y: box.top - 8, end: true }, label: "New chat", items: [
        { label: "New message", icon: <Pencil />, onSelect: () => setPicking("direct") },
        { label: "New group", icon: <People />, onSelect: () => setPicking("group") },
      ],
    });
  };

  return <aside className="chat-list" aria-label="Chats">
    <div className="chat-list-head">
      {view === "archived"
        ? <div className="chat-list-top">
          <button type="button" className="chat-icon" aria-label="Back to chats" onClick={() => setView("chats")}><ArrowLeft /></button>
          <p className="chat-panel-title">Archived chats</p>
        </div>
        : <div className="chat-list-top">
          <button type="button" className="chat-icon" aria-label="Menu" aria-haspopup="menu" onClick={mainMenu}><MenuIcon /></button>
          <label className="chat-search">
            <Search />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats" autoComplete="off" />
          </label>
        </div>}
      {view === "chats" && <AlertsPrompt />}
      {/* Said only while the chat is not live, as Telegram does. */}
      <p className="chat-live" role="status" data-state={live} title={live === "paused" ? "Checking every 30 seconds" : undefined}>
        <span aria-hidden="true" />{live === "live" ? "Live" : live === "connecting" ? "Connecting…" : "Reconnecting…"}
      </p>
    </div>
    {/* A new chat: straight to choosing someone, or for admins, a message or a group. */}
    {view === "chats" && <button type="button" className="chat-new" aria-label={me.admin ? "New chat" : "New message"} title={me.admin ? "New chat" : "New message"}
      aria-haspopup={me.admin ? "menu" : undefined} onClick={newChat}><Pencil /></button>}

    {picking && <ChatPicker mode={picking === "contacts" ? "direct" : picking} heading={picking === "contacts" ? "Contacts" : undefined}
      me={me} people={people} supabase={supabase} directWith={directWith} onClose={() => setPicking(null)}
      onDone={(chatId, draft) => { setPicking(null); onMade(chatId, draft); }} />}

    <div className="chat-rows">
      <ul aria-label={view === "archived" ? "Archived chats" : "Chats"}>
        {view === "chats" && archived.length > 0 && !words.length && <li>
          <button type="button" className="chat-row" onClick={() => setView("archived")}>
            <span className="chat-avatar" data-kind="archive" aria-hidden="true"><Archive /></span>
            <span className="chat-row-text">
              <span className="chat-row-top"><span className="chat-row-title">Archived chats</span></span>
              <span className="chat-row-bottom">
                <span className="chat-row-preview">{archived.map(chat => chatTitle(chat, members[chat.id] ?? [], me)).join(", ")}</span>
                {archivedUnread > 0 && <span className="chat-unread" data-muted="">{archivedUnread > 99 ? "99+" : archivedUnread}</span>}
              </span>
            </span>
          </button>
        </li>}
        {shown.map(chat => <Row key={chat.id} me={me} chat={chat} members={members[chat.id] ?? []} online={online} active={chat.id === active}
          photoOf={photoOf} onOpen={onOpen} onMenu={at => setMenu({ at, items: chatMenu(chat), label: `Chat with ${chatTitle(chat, members[chat.id] ?? [], me)}` })} />)}
      </ul>
      {!shown.length && !found.length && <p className="chat-list-empty">{words.length ? `No ${view === "archived" ? "archived chat" : "chat or person"} called “${query.trim()}”.`
        : view === "archived" ? "No archived chats." : "No chats yet. Start one with the pencil below."}</p>}
      {found.length > 0 && <>
        <p className="chat-section" id="chat-found-title">People</p>
        <ul className="chat-found" aria-labelledby="chat-found-title">
          {found.map(person => <li key={person.id}>
            <button type="button" className="chat-row" onClick={() => { setQuery(""); onPerson(person.id); }}>
              <Avatar initials={initialsOf(person.name)} photo={photoOf(person.id)} className="chat-avatar">
                {online.has(person.id) && <span className="chat-online" />}
              </Avatar>
              <span className="chat-row-text">
                <span className="chat-row-top"><span className="chat-row-title">{person.name}</span></span>
                <span className="chat-row-bottom"><span className="chat-row-preview">{person.username ? `@${person.username}` : person.detail}</span></span>
              </span>
            </button>
          </li>)}
        </ul>
      </>}
    </div>
    {menu && <Menu at={menu.at} items={menu.items} label={menu.label} onClose={closeMenu} />}
  </aside>;
}

/** One chat in the list. A right-click, or a long press, opens its menu. */
function Row({ me, chat, members, online, active, photoOf, onOpen, onMenu }: {
  me: ChatMe; chat: ChatSummary; members: ChatMember[]; online: Set<string>; active: boolean;
  photoOf: (person: string | null | undefined) => string | null; onOpen: (chatId: string) => void; onMenu: (at: MenuPlace) => void;
}) {
  const inBrowser = useInBrowser();
  const press = useLongPress(onMenu);
  const title = chatTitle(chat, members, me);
  const other = chat.kind === "direct" ? members.find(member => member.user_id !== me.id) : undefined;
  const preview = chat.last_file ? `📎 ${chat.last_file}${chat.last_body ? ` · ${chat.last_body}` : ""}`
    : chat.last_body ?? (chat.kind === "group" ? "No messages yet" : chat.kind === "saved" ? "Forward messages here to keep them" : "Say hello");
  const who = chat.kind === "group" && chat.last_kind === "text" && chat.last_sender
    ? chat.last_sender === me.id ? "You: " : `${members.find(member => member.user_id === chat.last_sender)?.name.split(" ")[0] ?? ""}: ` : "";
  // One's own last message: sent (✓), or read by someone (✓✓).
  const mine = chat.kind !== "saved" && chat.last_sender === me.id && chat.last_body !== null;
  const read = mine && members.some(member => member.user_id !== me.id && member.last_read_at >= chat.last_message_at);
  return <li>
    <button type="button" className="chat-row" aria-current={active || undefined} onClick={() => onOpen(chat.id)}
      onContextMenu={event => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }); }} {...press}>
      {chat.kind === "saved"
        ? <span className="chat-avatar" data-kind="saved" aria-hidden="true"><Bookmark /></span>
        : <Avatar initials={chat.kind === "notices" ? "K" : initialsOf(title)} photo={photoOf(other?.user_id)} className="chat-avatar" kind={chat.kind}>
          {other && online.has(other.user_id) && <span className="chat-online" />}
        </Avatar>}
      <span className="chat-row-text">
        <span className="chat-row-top">
          <span className="chat-row-title">{title}{chat.muted && <BellOff className="chat-row-mark" aria-hidden={false} role="img" aria-label="Muted" />}</span>
          <span className="chat-row-when">
            {mine && <span className="chat-tick" role="img" aria-label={read ? "Read" : "Sent"} data-read={read || undefined}>{read ? <Ticks /> : <Check />}</span>}
            {inBrowser ? shortWhen(chat.last_message_at) : ""}
          </span>
        </span>
        <span className="chat-row-bottom">
          <span className="chat-row-preview">{who}{preview}</span>
          {chat.unread > 0
            ? <span className="chat-unread" data-muted={chat.muted || undefined} aria-label={`${chat.unread} unread`}>{chat.unread > 99 ? "99+" : chat.unread}</span>
            : chat.marked_unread ? <span className="chat-unread chat-unread-dot" aria-label="Marked unread" />
              : chat.pinned_at ? <Pin className="chat-row-pin" aria-hidden={false} role="img" aria-label="Pinned" /> : null}
        </span>
      </span>
    </button>
  </li>;
}
