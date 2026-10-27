"use client";

import { Fragment, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent, type MouseEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decide } from "@/lib/accounts/actions";
import { REACTIONS, type Attachment, type ChatMe, type ChatMember, type ChatPerson, type ChatSummary, type Message } from "@/lib/chat/types";
import { Avatar } from "../site/avatar";
import { Alert, ArrowLeft, BellOff, Bookmark, Check, ChevronDown, Clock, Close, Copy, Download, Forward, More, NewTab, Paperclip, Pencil, Pin, Plus, Reply, Search, Select, Send, Ticks, Trash } from "../site/icons";
import type { MessageActions } from "./chat-app";
import { ChatFile, downloadFile, openFile, UploadingFile } from "./chat-file";
import { authorColor, bigEmoji, chatTitle, clock, dayKey, dayLabel, gist, initialsOf, lastSeen, useInBrowser } from "./chat-format";
import { ChatInfo } from "./chat-info";
import { Menu, useLongPress, type MenuItem, type MenuPlace } from "./chat-menu";
import { ChatPicker } from "./chat-picker";
import { PREVIEWABLE, SendFile } from "./chat-send-file";
import { uploadOf, useUpload } from "./chat-upload";

const LIMIT = 20 * 1024 * 1024;
type OpenMenu = { at: MenuPlace; items: MenuItem[]; label: string; message?: Message };

type Props = {
  me: ChatMe; chat: ChatSummary; members: ChatMember[]; people: ChatPerson[]; messages: Message[] | undefined; pinned: Message[]; more: boolean;
  online: Set<string>; seenOf: (person: string) => string | null; supabase: SupabaseClient;
  photoOf: (person: string | null | undefined) => string | null;
  /** The first names of whoever is typing here now. */
  typing: string[];
  actions: MessageActions;
  onBack: () => void; onEarlier: () => Promise<void>; onRead: () => Promise<void>; onTyping: () => void; onPerson: (person: string) => void;
  onSend: (chatId: string, body: string, options?: { replyTo?: string | null; attachment?: Attachment | null; id?: string }) => Promise<void>;
  onEdit: (message: Message, body: string) => Promise<void>;
};

/** One conversation: its messages, live, and the box to write in. As in
 * Telegram: a menu on every message (a right-click, a long press, or its ⋯),
 * with reactions on top; several messages selected at once; the pinned
 * message above; searching the chat; and, from its name, all about it. */
export function Conversation({ me, chat, members, people, messages, pinned, more, online, seenOf, supabase, photoOf, typing: typingNames, actions,
  onBack, onEarlier, onRead, onTyping, onPerson, onSend, onEdit }: Props) {
  const inBrowser = useInBrowser();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [replying, setReplying] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [adding, setAdding] = useState(false);
  const [info, setInfo] = useState(false);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Messages chosen, to copy, forward or delete together; null when not choosing.
  const [selected, setSelected] = useState<string[] | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pinAt, setPinAt] = useState(0);
  const [searching, setSearching] = useState(false);

  const title = chatTitle(chat, members, me);
  const others = members.filter(member => member.user_id !== me.id);
  const nameOf = (id: string | null) => !id ? "KIASA" : id === me.id ? me.name : members.find(member => member.user_id === id)?.name ?? "Former member";
  const status = typingNames.length ? `${typingNames.join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing…`
    : chat.kind === "direct" ? (others[0] && online.has(others[0].user_id) ? "online" : others[0] ? lastSeen(seenOf(others[0].user_id)) : "")
      : chat.kind === "group" ? `${members.length} members${members.some(m => m.user_id !== me.id && online.has(m.user_id)) ? `, ${members.filter(m => online.has(m.user_id)).length} online` : ""}`
        : chat.kind === "saved" ? "Only you see these" : "Notices from KIASA";

  // New messages in view: read at once, and the view follows them if the reader was at the end.
  const shown = messages ?? [];
  const count = shown.length;
  const last = shown[count - 1];
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box && (atBottom.current || last?.sender_id === me.id)) box.scrollTop = box.scrollHeight;
  }, [last?.id, last?.sender_id, me.id]);
  // Older messages loaded above: the view stays on what was being read.
  const firstId = shown[0]?.id;
  const lastFirst = useRef(firstId);
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (lastFirst.current && firstId !== lastFirst.current && !atBottom.current) box.scrollTop += box.scrollHeight - lastHeight.current;
    lastFirst.current = firstId;
    lastHeight.current = box.scrollHeight;
  });
  // Marked read once per message that arrives from someone else, never on a
  // mere redraw: each mark is a change everyone in the chat hears of. A message
  // that came straight from their browser is marked once the database has it,
  // so the mark, which goes by the database's clock, is sure to cover it.
  const read = useEffectEvent(() => { void onRead(); });
  const lastId = last?.id, lastFromOther = !!last && last.sender_id !== me.id && !last.pending && !last.provisional;
  useEffect(() => {
    if (lastId && lastFromOther) read();
  }, [lastId, lastFromOther]);
  useEffect(() => {
    const look = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);

  // A message jumped to (from the pinned bar or a search) is brought into view and lit for a moment.
  useEffect(() => {
    if (!highlight) return;
    document.getElementById(`msg-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setHighlight(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlight]);
  const jump = async (message: Message) => {
    if (await actions.bringIn(message)) setHighlight(message.id);
  };

  const byId = new Map(shown.map(message => [message.id, message]));
  const choosing = selected !== null;
  const chosen = shown.filter(message => selected?.includes(message.id));
  const toggle = (id: string) => setSelected(current => current?.includes(id) ? current.filter(entry => entry !== id) : [...(current ?? []), id]);

  /** A message's menu, as Telegram's: what one may do with it here. */
  const messageMenu = (message: Message, at: MenuPlace) => {
    const mine = message.sender_id === me.id;
    const file = message.attachment && !message.attachment.type ? message.attachment : null;
    const text = message.kind === "text";
    const items: MenuItem[] = [];
    if (text && chat.kind !== "notices") items.push({ label: "Reply", icon: <Reply />, onSelect: () => { setEditing(null); setReplying(message); } });
    if (message.body || file) items.push({ label: "Copy", icon: <Copy />, onSelect: () => actions.copy([message]) });
    if (file?.path) {
      items.push({ label: "Download", icon: <Download />, onSelect: () => void downloadFile(supabase, file) });
      if (!file.mime.startsWith("image/")) items.push({ label: "Open", icon: <NewTab />, onSelect: () => void openFile(supabase, file.path) });
    }
    if (mine && text && message.body && !message.forwarded) items.push({ label: "Edit", icon: <Pencil />, onSelect: () => { setReplying(null); setEditing(message); } });
    if (text && actions.canPin(chat)) items.push(message.pinned_at
      ? { label: "Unpin", icon: <Pin />, onSelect: () => actions.pin(message, false) }
      : { label: "Pin", icon: <Pin />, onSelect: () => actions.pin(message, true) });
    if (text) items.push({ label: "Forward", icon: <Forward />, onSelect: () => actions.forward([message]) });
    items.push({ label: "Select", icon: <Select />, onSelect: () => setSelected([message.id]) });
    items.push({ label: "Delete", icon: <Trash />, danger: true, onSelect: () => actions.remove([message]) });
    setMenu({ at, items, label: "Message", message: text ? message : undefined });
  };
  const headMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ at: { x: box.right - 220, y: box.bottom + 6 }, items: actions.chatMenu(chat), label: `Chat with ${title}` });
  };
  const current = pinned[Math.min(pinAt, pinned.length - 1)];

  return <section className="chat-conversation" aria-label={title}>
    <header className="chat-head">
      <button type="button" className="chat-icon chat-back" aria-label="Back to chats" onClick={onBack}><ArrowLeft /></button>
      <button type="button" className="chat-head-who" aria-label={`About ${title}`} onClick={() => setInfo(true)}>
        {chat.kind === "saved"
          ? <span className="chat-avatar" data-kind="saved" aria-hidden="true"><Bookmark /></span>
          : <Avatar initials={chat.kind === "notices" ? "K" : initialsOf(title)} photo={chat.kind === "direct" ? photoOf(others[0]?.user_id) : null} className="chat-avatar" kind={chat.kind} />}
        <span className="chat-head-text">
          <span className="chat-head-title">{title}{chat.muted && <BellOff className="chat-row-mark" />}</span>
          <span className="chat-head-status" data-online={status === "online" || undefined}>{status}</span>
        </span>
      </button>
      {chat.kind === "group" && me.admin && <button type="button" className="chat-pill chat-head-add" onClick={() => setAdding(true)}><Plus /> Add people</button>}
      <button type="button" className="chat-icon" aria-label="Search in this chat" title="Search" onClick={() => setSearching(true)}><Search /></button>
      <button type="button" className="chat-icon" aria-label="More" title="More" aria-haspopup="menu" onClick={headMenu}><More /></button>
    </header>
    {searching && <SearchBar chat={chat} actions={actions} onJump={message => void jump(message)} onClose={() => setSearching(false)} />}
    {current && <div className="chat-pinned">
      <button type="button" className="chat-pinned-main" onClick={() => { void jump(current); setPinAt(at => (at + 1) % pinned.length); }}>
        <Pin />
        <span>
          <span className="chat-pinned-label">Pinned message{pinned.length > 1 ? ` ${Math.min(pinAt, pinned.length - 1) + 1} of ${pinned.length}` : ""}</span>
          <span className="chat-pinned-text">{gist(current)}</span>
        </span>
      </button>
      {actions.canPin(chat) && <button type="button" className="chat-icon" aria-label="Unpin" title="Unpin" onClick={() => actions.pin(current, false)}><Close /></button>}
    </div>}
    {adding && <ChatPicker mode="add" me={me} people={people} supabase={supabase} chatId={chat.id} exclude={members.map(member => member.user_id)}
      onClose={() => setAdding(false)} onDone={() => setAdding(false)} />}
    {info && <ChatInfo me={me} chat={chat} members={members} people={people} online={online} seenOf={seenOf} photoOf={photoOf} supabase={supabase}
      onMessage={person => { setInfo(false); onPerson(person); }} onClose={() => setInfo(false)} />}

    <div className="chat-messages" ref={scroller} data-choosing={choosing || undefined} onScroll={event => {
      const box = event.currentTarget;
      atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    }}>
      {more && <button type="button" className="chat-earlier" onClick={() => void onEarlier()}>Load earlier messages</button>}
      {!messages && <p className="chat-note">Loading…</p>}
      {messages?.length === 0 && <p className="chat-note">{chat.kind === "direct" ? `Say hello to ${title.split(" ")[0]}.` : chat.kind === "saved" ? "Forward messages here, or write notes to yourself." : "No messages yet."}</p>}
      {shown.map((message, index) => {
        const previous = shown[index - 1], next = shown[index + 1];
        const newDay = inBrowser && (!previous || dayKey(previous.created_at) !== dayKey(message.created_at));
        // A run: one person's messages, a few minutes apart on one day, drawn as one group of bubbles.
        const together = (a: Message, b: Message) => a.sender_id === b.sender_id && a.kind === b.kind && dayKey(a.created_at) === dayKey(b.created_at)
          && new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < 5 * 60_000;
        const run = !!previous && !newDay && together(previous, message);
        const last = !next || !together(message, next);
        return <Fragment key={message.id}>
          {newDay && <p className="chat-day"><span>{dayLabel(message.created_at)}</span></p>}
          {message.kind === "notice"
            ? <Notice message={message} me={me} choosing={choosing} chosen={!!selected?.includes(message.id)} onToggle={() => toggle(message.id)}
              onMenu={at => messageMenu(message, at)} />
            : <Bubble message={message} me={me} chat={chat} members={members} run={run} last={last} inBrowser={inBrowser} supabase={supabase} photoOf={photoOf}
              author={nameOf(message.sender_id)} reply={message.reply_to ? byId.get(message.reply_to) ?? null : null} nameOf={nameOf}
              choosing={choosing} chosen={!!selected?.includes(message.id)} lit={highlight === message.id}
              onToggle={() => toggle(message.id)} onMenu={at => messageMenu(message, at)} onReact={emoji => actions.react(message, emoji)}
              onReply={() => { setEditing(null); setReplying(message); }} onJump={target => void jump(target)}
              onRetry={() => uploadOf(message.id) ? actions.retryFile(message.id)
                : void onSend(chat.id, message.body, { replyTo: message.reply_to, attachment: message.attachment, id: message.id })}
              onStopFile={() => actions.stopFile(message.id)} />}
        </Fragment>;
      })}
    </div>

    {choosing
      ? <div className="chat-selectbar" role="toolbar" aria-label="Chosen messages">
        <button type="button" className="chat-icon" aria-label="Stop choosing" onClick={() => setSelected(null)}><Close /></button>
        <span className="chat-selectbar-count">{chosen.length} selected</span>
        <button type="button" className="chat-pill" disabled={!chosen.length} onClick={() => actions.copy(chosen)}><Copy /> Copy</button>
        <button type="button" className="chat-pill" disabled={!chosen.some(message => message.kind === "text")}
          onClick={() => actions.forward(chosen.filter(message => message.kind === "text"), () => setSelected(null))}><Forward /> Forward</button>
        <button type="button" className="chat-pill" data-danger="" disabled={!chosen.length} onClick={() => actions.remove(chosen, () => setSelected(null))}><Trash /> Delete</button>
      </div>
      : chat.kind === "notices"
        ? <p className="chat-readonly">Only KIASA writes here.</p>
        : <Composer key={editing?.id ?? "new"} chat={chat} replying={replying} editing={editing} nameOf={nameOf}
          onCancel={() => { setReplying(null); setEditing(null); }}
          onTyping={onTyping}
          onSendFile={(file, caption, preview) => {
            actions.sendFile(chat.id, file, { caption, replyTo: replying?.id ?? null, preview });
            setReplying(null);
          }}
          onSend={async (body, attachment) => {
            if (editing) await onEdit(editing, body);
            else await onSend(chat.id, body, { replyTo: replying?.id ?? null, attachment });
            setReplying(null);
            setEditing(null);
          }} />}
    {menu && <Menu at={menu.at} items={menu.items} label={menu.label} onClose={closeMenu}
      top={menu.message && chat.kind !== "notices" ? <ReactionRow message={menu.message} me={me} onPick={emoji => { const message = menu.message!; closeMenu(); actions.react(message, emoji); }} /> : undefined} />}
  </section>;
}

/** The reactions at the top of a message's menu: the first seven, and the rest a click away. */
function ReactionRow({ message, me, onPick }: { message: Message; me: ChatMe; onPick: (emoji: string) => void }) {
  const [all, setAll] = useState(false);
  const mine = Object.entries(message.reactions ?? {}).find(([, people]) => people.includes(me.id))?.[0];
  return <div className="chat-menu-reactions" role="group" aria-label="React">
    {(all ? REACTIONS : REACTIONS.slice(0, 7)).map(emoji => <button key={emoji} type="button" aria-label={`React ${emoji}`} data-mine={emoji === mine || undefined}
      onClick={() => onPick(emoji)}>{emoji}</button>)}
    {!all && <button type="button" className="chat-menu-more" aria-label="More reactions" onClick={() => setAll(true)}><ChevronDown /></button>}
  </div>;
}

/** Searching this chat's messages: the newest match first, then older ones, each brought into view. */
function SearchBar({ chat, actions, onJump, onClose }: {
  chat: ChatSummary; actions: MessageActions; onJump: (message: Message) => void; onClose: () => void;
}) {
  const [words, setWords] = useState("");
  const [found, setFound] = useState<Message[] | null>(null);
  const [at, setAt] = useState(0);
  const latest = useRef("");
  const find = async (text: string) => {
    latest.current = text;
    if (!text.trim()) return setFound(null);
    const results = await actions.search(chat.id, text.trim());
    if (latest.current !== text) return;
    setFound(results);
    setAt(0);
    if (results[0]) onJump(results[0]);
  };
  const go = (step: number) => {
    if (!found?.length) return;
    const next = Math.min(Math.max(at + step, 0), found.length - 1);
    setAt(next);
    onJump(found[next]);
  };
  return <div className="chat-searchbar">
    <label className="chat-search">
      <Search />
      <input type="search" value={words} placeholder="Search in this chat" aria-label="Search in this chat" autoFocus
        onChange={event => setWords(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); if (found && words.trim() === latest.current.trim()) go(1); else void find(words); }
          if (event.key === "Escape") onClose();
        }} />
    </label>
    <span className="chat-searchbar-count" aria-live="polite">{found ? (found.length ? `${at + 1} of ${found.length}` : "No results") : ""}</span>
    <button type="button" className="chat-icon chat-older" aria-label="Older match" disabled={!found || at >= found.length - 1} onClick={() => go(1)}><ChevronDown /></button>
    <button type="button" className="chat-icon chat-newer" aria-label="Newer match" disabled={!found || at === 0} onClick={() => go(-1)}><ChevronDown /></button>
    <button type="button" className="chat-icon" aria-label="Close search" onClick={onClose}><Close /></button>
  </div>;
}

/** A message: who wrote it (in a group), whose it first was (forwarded), what
 * it answers, its words or file, its reactions, when, and, for the writer,
 * whether it was sent and read. Reply and ⋯ (its menu) float beside it while it
 * is pointed at (above it, once tapped, on a phone), so nothing around it
 * moves; a right-click or a long press opens the menu too. While choosing,
 * a click chooses it.
 *
 * Drawn as Telegram draws it: one person's run of messages as one group of
 * rounded bubbles, the last with a tail (and, in a group, their photo beside
 * it); their name, in their own colour, inside the first; the time and ticks
 * inside, beside the last line of words (or the reactions, or on a picture);
 * and each reaction a soft pill with the faces of who gave it. */
function Bubble({ message, me, chat, members, run, last, inBrowser, supabase, photoOf, author, reply, nameOf, choosing, chosen, lit,
  onToggle, onMenu, onReact, onReply, onJump, onRetry, onStopFile }: {
  message: Message; me: ChatMe; chat: ChatSummary; members: ChatMember[]; run: boolean; last: boolean; inBrowser: boolean; supabase: SupabaseClient;
  photoOf: (person: string | null | undefined) => string | null;
  author: string; reply: Message | null; nameOf: (id: string | null) => string; choosing: boolean; chosen: boolean; lit: boolean;
  onToggle: () => void; onMenu: (at: MenuPlace) => void; onReact: (emoji: string) => void; onReply: () => void;
  onJump: (message: Message) => void; onRetry: () => void; onStopFile: () => void;
}) {
  const mine = message.sender_id === me.id;
  const press = useLongPress(onMenu);
  // Its file, while it goes up from this page.
  const upload = useUpload(message.id);
  const read = members.some(member => member.user_id !== me.id && member.last_read_at >= message.created_at);
  const file = message.attachment && !message.attachment.type ? message.attachment : null;
  const reactions = Object.entries(message.reactions ?? {});
  const ready = !message.pending && !message.provisional;
  const group = chat.kind === "group" && !mine;
  const meta = <span className="chat-meta">
    {message.pinned_at && <Pin className="chat-meta-pin" />}
    {message.edited_at && <span>edited</span>}
    <span>{inBrowser ? clock(message.created_at) : ""}</span>
    {mine && chat.kind !== "saved" && <span className="chat-tick" role="img" data-read={read || undefined} data-failed={message.pending === "failed" || undefined}
      aria-label={message.pending === "sending" ? "Sending" : message.pending === "failed" ? "Not sent" : read ? "Read" : "Sent"}>
      {message.pending === "sending" ? <Clock /> : message.pending === "failed" ? <Alert /> : read ? <Ticks /> : <Check />}
    </span>}
  </span>;
  // A picture on its own: the time sits on it, in a dark pill. A few emoji on their own: large, with no bubble.
  const media = !!file && file.mime.startsWith("image/") && !message.body && !reactions.length && !reply && !message.forwarded;
  const big = !file && !reply && !message.forwarded && bigEmoji(message.body);
  return <div id={`msg-${message.id}`} className="chat-message" data-mine={mine || undefined} data-run={run || undefined} data-last={last || undefined}
    data-chosen={chosen || undefined} data-lit={lit || undefined} onClick={choosing ? onToggle : undefined}>
    <div className="chat-bubble-row">
      {choosing && <span className="chat-choose" aria-hidden="true" />}
      {group && <span className="chat-gutter" aria-hidden="true">
        {last && <Avatar initials={initialsOf(author)} photo={photoOf(message.sender_id)} className="chat-avatar chat-gutter-avatar" />}
      </span>}
      <div className="chat-bubble" tabIndex={-1} data-media={media || undefined} data-emoji={big || undefined} data-failed={message.pending === "failed" || undefined} {...(choosing || !ready ? {} : press)}
        onContextMenu={event => {
          if (choosing || !ready) return;
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY });
        }}>
        {group && !run && <p className="chat-author" style={{ color: authorColor(message.sender_id) }}>{author}</p>}
        {message.forwarded && <p className="chat-forwarded">Forwarded from <span>{message.forwarded.name}</span></p>}
        {reply && <button type="button" className="chat-quote" onClick={event => { event.stopPropagation(); onJump(reply); }}>
          <span>{nameOf(reply.sender_id)}</span>{reply.body || (reply.attachment && !reply.attachment.type ? reply.attachment.name : "")}
        </button>}
        {file && (upload || !file.path ? <UploadingFile file={file} upload={upload} onStop={onStopFile} /> : <ChatFile supabase={supabase} file={file} />)}
        {message.body && <p className="chat-text">{message.body}{!reactions.length && meta}</p>}
        {reactions.length > 0 && <div className="chat-reactions">
          {reactions.map(([emoji, people]) => <button key={emoji} type="button" className="chat-reaction" data-mine={people.includes(me.id) || undefined}
            title={people.map(nameOf).join(", ")} aria-label={`${emoji} ${people.length}${people.includes(me.id) ? ", yours" : ""}`}
            onClick={event => { event.stopPropagation(); if (ready && !choosing) onReact(emoji); }}>
            <span className="chat-reaction-emoji" aria-hidden="true">{emoji}</span>
            {people.length <= 3
              ? <span className="chat-reaction-faces" aria-hidden="true">
                {people.map(person => <Avatar key={person} initials={initialsOf(nameOf(person))} photo={photoOf(person)} className="chat-reaction-face" />)}
              </span>
              : <span className="chat-reaction-count" aria-hidden="true">{people.length}</span>}
          </button>)}
          {meta}
        </div>}
        {!message.body && !reactions.length && meta}
      </div>
      {ready && !choosing && <div className="chat-actions">
        {/* A picture opens when clicked, so it is downloaded from here (a file's own card downloads it). */}
        {file?.mime.startsWith("image/") && <button type="button" aria-label={`Download ${file.name}`} title="Download"
          onClick={() => void downloadFile(supabase, file)}><Download /></button>}
        <button type="button" aria-label="Reply" title="Reply" onClick={onReply}><Reply /></button>
        <button type="button" aria-label="More" title="More" onClick={event => {
          const box = event.currentTarget.getBoundingClientRect();
          onMenu({ x: box.left, y: box.bottom + 4 });
        }}><More /></button>
      </div>}
    </div>
    {message.pending === "failed" && <button type="button" className="chat-retry" onClick={onRetry}>Not sent. Send again</button>}
  </div>;
}

/** KIASA's own messages: a line in the middle; an account request, a card
 * that admins can approve or decline right here. A right-click or a long
 * press opens its menu (to copy or delete it, for oneself). */
function Notice({ message, me, choosing, chosen, onToggle, onMenu }: {
  message: Message; me: ChatMe; choosing: boolean; chosen: boolean; onToggle: () => void; onMenu: (at: MenuPlace) => void;
}) {
  const [working, start] = useTransition();
  const [error, setError] = useState("");
  const press = useLongPress(onMenu);
  const request = message.attachment?.type === "request" ? message.attachment : null;
  const menuOn = {
    ...(choosing ? {} : press),
    onContextMenu: (event: MouseEvent) => { if (choosing) return; event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }); },
    onClick: choosing ? onToggle : undefined,
    "data-chosen": chosen || undefined,
  };
  if (!request) return <p id={`msg-${message.id}`} className="chat-notice" {...menuOn}>{message.body}</p>;
  const act = (status: "approved" | "declined") => start(async () => {
    setError("");
    const result = await decide(request.id, status);
    if (result.error) setError(result.error);
  });
  const label = { waiting: "Waiting for approval", approved: "Approved", declined: "Declined", deleted: "Deleted" }[request.status];
  return <div id={`msg-${message.id}`} className="chat-request" data-status={request.status} {...menuOn}>
    <p className="chat-request-kicker">Account request</p>
    <p className="chat-request-name">{request.name}</p>
    <dl className="chat-request-facts">
      <div><dt>Email</dt><dd>{request.email}</dd></div>
      <div><dt>Organization</dt><dd>{request.organization ?? "None given"}</dd></div>
      <div><dt>Why</dt><dd>{request.reason}</dd></div>
    </dl>
    <p className="chat-request-status">{label}{request.decided_by ? ` by ${request.decided_by}` : ""}</p>
    {request.status === "waiting" && me.admin && <div className="chat-request-actions">
      <button type="button" className="admin-approve" aria-disabled={working || undefined} onClick={working ? undefined : () => act("approved")}>{working ? "Saving…" : "Approve"}</button>
      <button type="button" className="account-button" aria-disabled={working || undefined} onClick={working ? undefined : () => act("declined")}>Decline</button>
    </div>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
  </div>;
}

/** The box to write in: Enter sends, Shift+Enter starts a new line, Escape
 * stops replying or editing. A file (from the paperclip, pasted, or dropped on
 * the conversation) is shown first, to add a caption and send, as in Telegram;
 * it then shows in the conversation at once, going up. */
function Composer({ chat, replying, editing, nameOf, onCancel, onTyping, onSend, onSendFile }: {
  chat: ChatSummary; replying: Message | null; editing: Message | null;
  nameOf: (id: string | null) => string; onCancel: () => void; onTyping: () => void;
  onSend: (body: string, attachment: Attachment | null) => Promise<void>;
  onSendFile: (file: File, caption: string, preview: string | null) => void;
}) {
  const [text, setText] = useState(editing?.body ?? "");
  const [picked, setPicked] = useState<{ file: File; preview: string | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const lastTyping = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { box.current?.focus(); }, [replying, editing]);

  const choose = (file: File | undefined) => {
    if (!file || editing) return;
    setError("");
    if (file.size > LIMIT) return setError("Files can be up to 20 MB.");
    setPicked({ file, preview: PREVIEWABLE.test(file.type) ? URL.createObjectURL(file) : null });
  };
  // A file dragged over the conversation: dropping it there chooses it.
  const dropped = useEffectEvent((file: File | undefined) => choose(file));
  useEffect(() => {
    const area = box.current?.closest<HTMLElement>(".chat-conversation");
    if (!area || editing) return;
    let depth = 0;
    const files = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => { if (!files(event)) return; event.preventDefault(); depth += 1; setDragging(true); };
    const over = (event: DragEvent) => { if (!files(event)) return; event.preventDefault(); event.dataTransfer!.dropEffect = "copy"; };
    const leave = (event: DragEvent) => { if (!files(event)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      dropped(event.dataTransfer?.files[0]);
    };
    area.addEventListener("dragenter", enter);
    area.addEventListener("dragover", over);
    area.addEventListener("dragleave", leave);
    area.addEventListener("drop", drop);
    return () => {
      area.removeEventListener("dragenter", enter);
      area.removeEventListener("dragover", over);
      area.removeEventListener("dragleave", leave);
      area.removeEventListener("drop", drop);
    };
  }, [editing]);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    await onSend(body, null);
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
    if (event.key === "Escape") onCancel();
  };
  return <div className="chat-composer">
    {dragging && <div className="chat-drop" aria-hidden="true"><Paperclip /><span>Drop to send</span></div>}
    {picked && <SendFile file={picked.file} preview={picked.preview} caption={text}
      onSend={caption => {
        onSendFile(picked.file, caption, picked.preview);
        setText("");
        setPicked(null);
        box.current?.focus();
      }}
      onClose={() => {
        if (picked.preview) URL.revokeObjectURL(picked.preview);
        setPicked(null);
        box.current?.focus();
      }} />}
    {(replying || editing) && <p className="chat-composer-context">
      <span>{editing ? "Editing" : `Replying to ${nameOf(replying!.sender_id)}`}</span>
      <span className="chat-composer-quote">{gist(editing ?? replying!)}</span>
      <button type="button" className="chat-icon" aria-label={editing ? "Stop editing" : "Stop replying"} onClick={onCancel}><Close /></button>
    </p>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="chat-composer-row">
      <div className="chat-input">
        {!editing && <label className="chat-icon chat-attach" aria-label="Attach a file or picture" title="Attach a file or picture">
          <Paperclip />
          <input type="file" onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
        </label>}
        <textarea ref={box} rows={1} value={text} placeholder={chat.kind === "saved" ? "Note to self" : "Message"}
          aria-label="Message" maxLength={4000}
          onChange={event => {
            setText(event.target.value);
            if (Date.now() - lastTyping.current > 2500) { lastTyping.current = Date.now(); onTyping(); }
          }}
          onKeyDown={keys}
          onPaste={event => {
            // A picture or file pasted on its own (a screenshot, say) is sent as one.
            const file = event.clipboardData.files[0];
            if (file && !editing && !event.clipboardData.getData("text/plain")) { event.preventDefault(); choose(file); }
          }} />
      </div>
      <button type="button" className="chat-send" aria-label={editing ? "Save" : "Send"} title={editing ? "Save" : "Send"}
        onClick={() => void submit()} aria-disabled={!text.trim() || undefined}>{editing ? <Check /> : <Send />}</button>
    </div>
  </div>;
}
