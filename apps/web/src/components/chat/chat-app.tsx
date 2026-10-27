"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from "react";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/accounts/browser";
import { photoUrl } from "@/lib/accounts/viewer";
import { splitChatList, type Attachment, type ChatMe, type ChatMember, type ChatPerson, type ChatRow, type ChatSummary, type Message } from "@/lib/chat/types";
import { Archive, Bell, BellOff, Check, Eraser, Leave, NewTab, Pin, Trash, Unread } from "../site/icons";
import { Confirm } from "./chat-dialog";
import { keepPreview } from "./chat-file";
import { ForwardPicker } from "./chat-forward";
import { chatTitle, gist } from "./chat-format";
import { ChatList } from "./chat-list";
import type { MenuItem } from "./chat-menu";
import { chatReducer, directDraft, type ChatDraft, type ChatView } from "./chat-state";
import { putFile, setUpload, uploadOf } from "./chat-upload";
import { Conversation } from "./conversation";

type Realtime = { url: string; key: string };
type Typing = Record<string, Record<string, { name: string; until: number }>>;
/** What the confirm dialog asks, and what it does once confirmed. */
type Asking = { title: string; text: string; also?: { label: string; checked: boolean }; confirm: string; run: (everyone: boolean) => Promise<string | null> };
/** What the conversation may ask the page to do with its messages. */
export type MessageActions = {
  react: (message: Message, emoji: string) => void;
  pin: (message: Message, on: boolean) => void;
  forward: (messages: Message[], after?: () => void) => void;
  remove: (messages: Message[], after?: () => void) => void;
  copy: (messages: Message[]) => void;
  search: (chatId: string, words: string) => Promise<Message[]>;
  bringIn: (message: Message) => Promise<boolean>;
  chatMenu: (chat: ChatSummary) => MenuItem[];
  canPin: (chat: ChatSummary) => boolean;
  /** A file into a chat, with a caption: shown at once, with how far it has gone up. */
  sendFile: (chatId: string, file: File, options: { caption: string; replyTo: string | null; preview: string | null }) => void;
  /** Stopping a file on its way (or taking away one that failed), and sending one again. */
  stopFile: (id: string) => void;
  retryFile: (id: string) => void;
};
const PAGE = 60;
/** The newest chats are loaded ahead, this many, with this many messages each. */
const AHEAD = { chats: 15, messages: 30 };
/** How long a message that came straight from another browser may stand
 * before the database must have confirmed it. */
const CONFIRM_WITHIN = 6000;
const TRY_AGAIN = "That did not work. Please try again.";
/** The database's own reason, when it gave one. */
const reason = (error: PostgrestError | null) =>
  error?.code === "P0001" && error.message ? error.message
    : error?.code === "PGRST202" ? "This needs the latest database update (supabase/migrations/20261026233000_chat_more.sql)." : TRY_AGAIN;

/** KIASA Chat: the chat list and the open conversation.
 *
 * Speed comes from two routes at once. Each chat has a private live channel
 * ("chat:<id>", open only to its members), and a message goes straight over
 * it from the writer's browser to the others', in about a sixth of a second.
 * It is saved at the same moment; the database's copy, which its rules have
 * checked, follows by its own route and takes the straight copy's place, and
 * a copy it never confirms is taken away again. What this page sends shows at
 * once, before anyone has answered, and the newest chats are loaded ahead, so
 * they open at once.
 *
 * As in Telegram, messages can be reacted to, pinned, forwarded and deleted
 * (for oneself, or for everyone where that is allowed); chats can be pinned,
 * muted, archived, marked unread, cleared and deleted; and there are Saved
 * Messages, a profile and "last seen". The database decides what each person
 * may do; this page asks it, and shows the answer at once. */
export function ChatApp({ me, initialChats, initialMembers, people, realtime, initialChat }: {
  me: ChatMe; initialChats: ChatSummary[]; initialMembers: ChatMember[]; people: ChatPerson[]; realtime: Realtime; initialChat?: string | null;
}) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [state, dispatch] = useReducer(chatReducer, undefined, () => chatReducer(
    { chats: [], members: {}, messages: {}, more: {}, pinned: {} },
    { type: "chats", chats: initialChats, members: initialMembers },
  ));
  // "Open in new tab": the chat asked for in the address is open from the start.
  const [active, setActive] = useState<string | null>(initialChat ?? null);
  const [online, setOnline] = useState<Set<string>>(() => new Set());
  const [typing, setTyping] = useState<Typing>({});
  const [live, setLive] = useState<"connecting" | "live" | "paused">("connecting");
  const [signedIn, setSignedIn] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [forwarding, setForwarding] = useState<{ ids: string[]; after?: () => void } | null>(null);
  const [notice, setNotice] = useState("");
  // Everyone's photo, by who they are: as the page came, then as people change them.
  const [photos, setPhotos] = useState<Record<string, string>>(() => Object.fromEntries(people.flatMap(person => (person.photo ? [[person.id, person.photo]] : []))));
  // When people seen going offline here left.
  const [left, setLeft] = useState<Record<string, string>>({});
  const photoOf = useCallback((id: string | null | undefined) => (id ? photos[id] ?? null : null), [photos]);
  const peopleNow = useMemo(() => people.map(person => ({ ...person, photo: photos[person.id] ?? null })), [people, photos]);
  const seenOf = useCallback((id: string) => left[id] ?? people.find(person => person.id === id)?.seen ?? null, [left, people]);
  // The open chat and each chat's channel, for the live handlers, which outlive any one render.
  const activeRef = useRef<string | null>(initialChat ?? null);
  const channels = useRef(new Map<string, RealtimeChannel>());

  const reading = useCallback((chatId: string) => activeRef.current === chatId && document.visibilityState === "visible", []);

  /** The chat list again, in one answer, after a chat appears that this page did not know of. */
  const reloadChats = useCallback(async () => {
    const { data, error } = await supabase.rpc("inbox");
    if (!error) dispatch({ type: "chats", ...splitChatList(data as ChatRow[] | null) });
  }, [supabase]);

  // A short word at the foot of the page, after something did not work.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** A message, by either route: kept and counted; its writer no longer
   * "typing"; and, while this tab is hidden and the chat not muted, the
   * computer says so. One in a chat this page does not show (deleted here
   * earlier) brings the chat back. */
  const arrived = useEffectEvent((message: Message) => {
    const chat = state.chats.find(entry => entry.id === message.chat_id);
    if (!chat) void reloadChats();
    const fresh = !state.messages[message.chat_id]?.some(entry => entry.id === message.id);
    dispatch({ type: "message", message, me: me.id, reading: reading(message.chat_id) });
    if (message.sender_id) {
      const writer = message.sender_id;
      setTyping(current => {
        if (!current[message.chat_id]?.[writer]) return current;
        const rest = { ...current[message.chat_id] };
        delete rest[writer];
        return { ...current, [message.chat_id]: rest };
      });
    }
    if (fresh && !chat?.muted && message.sender_id !== me.id && document.visibilityState !== "visible") alertComputer(message, me);
  });

  /** A change to a message, from the database: deleted ones leave the
   * conversation (and the chat list's preview is asked for again). */
  const changed = useEffectEvent((message: Message) => {
    dispatch({ type: "changed", message: { ...message, provisional: undefined } });
    if (message.deleted_at) void reloadChats();
  });

  /** A straight copy the database has not confirmed in time: checked against
   * it, and taken away if the database does not have it. */
  const settle = useEffectEvent(async (chatId: string, id: string) => {
    if (!state.messages[chatId]?.find(entry => entry.id === id)?.provisional) return;
    const { data, error } = await supabase.from("messages").select("*").eq("id", id).maybeSingle();
    if (error) return;
    if (data) return dispatch({ type: "changed", message: { ...(data as Message), provisional: undefined } });
    dispatch({ type: "drop", id, chatId });
    void reloadChats();
  });

  /** Someone joined a chat: someone else, in a chat this page shows; or this
   * person, in a chat the page may not know of yet. */
  const joined = useEffectEvent((member: ChatMember) => {
    if (member.user_id !== me.id) return dispatch({ type: "member", member });
    if (!state.chats.some(chat => chat.id === member.chat_id)) void reloadChats();
  });

  /** Someone left a chat (or it was deleted): this person, and it goes from
   * their list; someone else, and they go from its members. */
  const gone = useEffectEvent((member: { chat_id?: string; user_id?: string }) => {
    if (!member.chat_id || !member.user_id || !state.chats.some(chat => chat.id === member.chat_id)) return;
    if (member.user_id !== me.id) return dispatch({ type: "member-gone", chatId: member.chat_id, userId: member.user_id });
    dispatch({ type: "leave", chatId: member.chat_id });
    if (activeRef.current === member.chat_id) {
      activeRef.current = null;
      setActive(null);
    }
  });

  /** This person's own view of a chat changed, here or in another window, or
   * by the other person (clearing or deleting a chat for both). */
  const viewed = useEffectEvent((row: { chat_id?: string; user_id?: string; pinned_at?: string | null; muted?: boolean; archived?: boolean; marked_unread?: boolean; cleared_at?: string | null }) => {
    if (!row.chat_id || row.user_id !== me.id) return;
    dispatch({ type: "view", chatId: row.chat_id, view: { pinned_at: row.pinned_at ?? null, muted: !!row.muted, archived: !!row.archived, marked_unread: !!row.marked_unread } });
    if (row.cleared_at) dispatch({ type: "clear", chatId: row.chat_id, upTo: row.cleared_at });
    void reloadChats();
  });

  // What comes straight from another browser, on a chat's channel. Only what
  // one of the chat's members could have written is taken, and names come
  // from the chat itself, never from what was sent.
  const straight = useEffectEvent((chatId: string, event: string, payload: Record<string, unknown>) => {
    const member = (id: unknown) => (state.members[chatId] ?? []).find(entry => entry.user_id === id);
    const sent = payload.message;
    if (event === "message" && isMessage(sent, chatId) && member(sent.sender_id)) {
      arrived({
        id: sent.id, chat_id: chatId, sender_id: sent.sender_id, kind: "text", body: sent.body, reply_to: sent.reply_to,
        attachment: sent.attachment, created_at: sent.created_at, edited_at: null, deleted_at: null,
        reactions: {}, pinned_at: null, forwarded: null, provisional: true,
      });
      window.setTimeout(() => void settle(chatId, sent.id), CONFIRM_WITHIN);
    } else if (event === "unsend" && typeof payload.id === "string") {
      dispatch({ type: "drop", id: payload.id, chatId });
    } else if (event === "typing" && payload.user !== me.id) {
      const typist = member(payload.user);
      if (typist) setTyping(current => ({ ...current, [chatId]: { ...current[chatId], [typist.user_id]: { name: typist.name, until: Date.now() + 4000 } } }));
    }
  });

  /** Who is online, and, for those who just left, when: "last seen just now". */
  const present = useEffectEvent((now: Set<string>) => {
    const went = [...online].filter(id => !now.has(id));
    if (went.length) {
      const at = new Date().toISOString();
      setLeft(current => ({ ...current, ...Object.fromEntries(went.map(id => [id, at])) }));
    }
    setOnline(now);
  });

  // Signed in on the live connection first: a channel joined without it hears
  // nothing. Then the database's route for every change, and who is online.
  useEffect(() => {
    let stopped = false;
    const opened: RealtimeChannel[] = [];
    (async () => {
      await supabase.realtime.setAuth();
      if (stopped) return;
      const changes = supabase.channel("chat-changes")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => arrived(payload.new as Message))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, payload => changed(payload.new as Message))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_members" }, payload => joined(payload.new as ChatMember))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_members" }, payload => dispatch({ type: "member", member: payload.new as ChatMember }))
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_members" }, payload => gone(payload.old as { chat_id?: string; user_id?: string }))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_settings" }, payload => viewed(payload.new))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_settings" }, payload => viewed(payload.new))
        .on("postgres_changes", { event: "*", schema: "public", table: "avatars" }, payload => {
          if (payload.eventType === "DELETE") {
            const gonePhoto = (payload.old as { user_id?: string }).user_id;
            if (gonePhoto) setPhotos(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== gonePhoto)));
          } else {
            const row = payload.new as { user_id: string; path: string };
            setPhotos(current => ({ ...current, [row.user_id]: photoUrl(realtime.url, row.path) }));
          }
        })
        .subscribe(status => { if (!stopped) setLive(status === "SUBSCRIBED" ? "live" : "paused"); });
      const presence = supabase.channel("kiasa:online", { config: { private: true, presence: { key: me.id } } });
      presence
        .on("presence", { event: "sync" }, () => present(new Set(Object.keys(presence.presenceState()))))
        .subscribe(async status => { if (status === "SUBSCRIBED") await presence.track({ since: new Date().toISOString() }); });
      opened.push(changes, presence);
      setSignedIn(true);
    })().catch(() => { if (!stopped) setLive("paused"); });
    return () => {
      stopped = true;
      for (const channel of opened) supabase.removeChannel(channel);
    };
  }, [supabase, me.id, realtime.url]);

  // Each chat's own channel, joined as chats appear and left as they go.
  const chatIds = state.chats.map(chat => chat.id).join(" ");
  useEffect(() => {
    if (!signedIn) return;
    const wanted = new Set(chatIds.split(" ").filter(Boolean));
    const joinedNow = channels.current;
    for (const id of wanted) {
      if (joinedNow.has(id)) continue;
      const channel = supabase.channel(`chat:${id}`, { config: { private: true, broadcast: { self: false } } });
      for (const event of ["message", "unsend", "typing"]) {
        channel.on("broadcast", { event }, ({ payload }) => straight(id, event, (payload ?? {}) as Record<string, unknown>));
      }
      joinedNow.set(id, channel.subscribe());
    }
    for (const [id, channel] of joinedNow) {
      if (wanted.has(id)) continue;
      supabase.removeChannel(channel);
      joinedNow.delete(id);
    }
  }, [signedIn, chatIds, supabase]);
  useEffect(() => {
    const joinedNow = channels.current;
    return () => {
      for (const channel of joinedNow.values()) supabase.removeChannel(channel);
      joinedNow.clear();
    };
  }, [supabase]);
  /** Something for the others in a chat, straight over its channel, once joined. */
  const say = useCallback((chatId: string, event: string, payload: Record<string, unknown>) => {
    const channel = channels.current.get(chatId);
    if (channel?.state === "joined") void channel.send({ type: "broadcast", event, payload });
  }, []);

  // The newest chats' latest messages, loaded ahead in one answer, so they open at once.
  useEffect(() => {
    const ids = initialChats.slice(0, AHEAD.chats).map(chat => chat.id);
    if (!ids.length) return;
    void supabase.rpc("recent_messages", { chat_ids: ids, per_chat: AHEAD.messages }).then(({ data, error }) => {
      if (error) return;
      const rows = (data ?? []) as Message[];
      for (const chatId of ids) {
        const list = rows.filter(row => row.chat_id === chatId);
        dispatch({ type: "history", chatId, messages: list, more: list.length === AHEAD.messages });
      }
    });
  }, [initialChats, supabase]);

  // "…is typing" fades on its own after a few seconds.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const timer = window.setTimeout(() => setTyping(current => {
      const now = Date.now(), kept: Typing = {};
      for (const [chatId, typists] of Object.entries(current)) {
        const still = Object.entries(typists).filter(([, entry]) => entry.until > now);
        if (still.length) kept[chatId] = Object.fromEntries(still);
      }
      return kept;
    }), 1000);
    return () => window.clearTimeout(timer);
  }, [typing]);

  // Coming back to the tab, or the connection having dropped: catch up on what was missed.
  useEffect(() => {
    const look = () => { if (document.visibilityState === "visible") void reloadChats(); };
    document.addEventListener("visibilitychange", look);
    const timer = live === "live" ? undefined : window.setInterval(look, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", look);
      window.clearInterval(timer);
    };
  }, [live, reloadChats]);

  // Here now, for "last seen": on arriving, every two minutes while here, and on leaving.
  useEffect(() => {
    // A Supabase request is sent only once something waits for its answer.
    const touch = () => void supabase.rpc("touch_seen").then(() => undefined);
    touch();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") touch(); }, 120_000);
    document.addEventListener("visibilitychange", touch);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", touch);
    };
  }, [supabase]);

  // The unread count in the tab's title, so a glance at the tab says it (muted chats aside).
  const unread = state.chats.reduce((sum, chat) => sum + (chat.muted ? 0 : chat.unread), 0);
  useEffect(() => { document.title = unread ? `(${unread}) KIASA Chat` : "KIASA Chat"; }, [unread]);

  const markRead = useCallback(async (chatId: string) => {
    if (document.visibilityState !== "visible") return;
    dispatch({ type: "read", chatId });
    await supabase.rpc("mark_chat_read", { chat: chatId });
  }, [supabase]);
  const readActive = useCallback(() => activeRef.current ? markRead(activeRef.current) : Promise.resolve(), [markRead]);

  /** A chat's latest messages and its pinned ones, unless here already; then
   * everything in it is read. */
  const load = useCallback(async (chatId: string) => {
    await Promise.all([
      !(chatId in state.more) && supabase.from("messages").select("*").eq("chat_id", chatId).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(PAGE).then(({ data, error }) => {
          if (error) return;
          const rows = ((data ?? []) as Message[]).reverse();
          dispatch({ type: "history", chatId, messages: rows, more: rows.length === PAGE });
        }),
      !(chatId in state.pinned) && supabase.from("messages").select("*").eq("chat_id", chatId).is("deleted_at", null)
        .not("pinned_at", "is", null).order("pinned_at", { ascending: false }).limit(20).then(({ data, error }) => {
          if (!error) dispatch({ type: "pinned", chatId, messages: (data ?? []) as Message[] });
        }),
    ]);
    await markRead(chatId);
  }, [state.more, state.pinned, supabase, markRead]);

  /** Opening a chat (or, with null, going back to the list). */
  const open = useCallback(async (chatId: string | null) => {
    setActive(chatId);
    activeRef.current = chatId;
    if (chatId) await load(chatId);
  }, [load]);

  // The chat open from the start is loaded once the page is here.
  const loadFirst = useEffectEvent(() => { if (initialChat) void load(initialChat); });
  useEffect(() => { loadFirst(); }, []);

  /** A chat just made, or found: shown and opened at once; a new one's place
   * in the chat list is asked for again behind it. */
  const made = useCallback((chatId: string, draft?: ChatDraft) => {
    if (draft) dispatch({ type: "draft", draft });
    void open(chatId);
    if (draft) void reloadChats();
  }, [open, reloadChats]);

  /** Saved Messages: one's own chat with oneself, made on first use. */
  const openSaved = useCallback(async () => {
    const { data, error } = await supabase.rpc("saved_chat");
    if (error || !data) return setNotice(reason(error));
    const id = data as string;
    const now = new Date().toISOString();
    made(id, state.chats.some(chat => chat.id === id) ? undefined : {
      chat: { id, kind: "saved", title: null, last_message_at: now, unread: 0, last_body: null, last_sender: null, last_kind: null, last_file: null, pinned_at: null, muted: false, archived: false, marked_unread: false },
      members: [{ chat_id: id, user_id: me.id, name: me.name, role: "owner", last_read_at: now }],
    });
  }, [supabase, made, state.chats, me.id, me.name]);

  /** A direct chat with someone (found by searching, or from a group's
   * members): the one there is, or a new one. One deleted from the list
   * earlier comes back into it, its history still cleared. */
  const openPerson = useCallback(async (person: string) => {
    const known = state.chats.find(chat => chat.kind === "direct" && (state.members[chat.id] ?? []).some(member => member.user_id === person));
    if (known) return void open(known.id);
    const { data, error } = await supabase.rpc("open_direct", { other: person });
    if (error || !data) return setNotice(reason(error));
    const id = data as string;
    made(id, directDraft(id, me, { id: person, name: people.find(entry => entry.id === person)?.name ?? "" }));
  }, [state.chats, state.members, supabase, open, made, me, people]);

  const earlier = useCallback(async (chatId: string) => {
    const first = state.messages[chatId]?.[0];
    if (!first) return;
    const { data } = await supabase.from("messages").select("*").eq("chat_id", chatId).is("deleted_at", null)
      .lt("created_at", first.created_at).order("created_at", { ascending: false }).limit(PAGE);
    const rows = ((data ?? []) as Message[]).reverse();
    dispatch({ type: "earlier", chatId, messages: rows, more: rows.length === PAGE });
  }, [state.messages, supabase]);

  /** Sending: shown at once, sent straight to the others, and saved; if saving
   * fails, it says so here, can be sent again, and is taken back from the others. */
  const send = useCallback(async (chatId: string, body: string, options: { replyTo?: string | null; attachment?: Attachment | null; id?: string } = {}) => {
    const message: Message = {
      id: options.id ?? crypto.randomUUID(), chat_id: chatId, sender_id: me.id, kind: "text", body,
      reply_to: options.replyTo ?? null, attachment: options.attachment ?? null,
      created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reactions: {}, pinned_at: null, forwarded: null, pending: "sending",
    };
    dispatch({ type: "message", message, me: me.id, reading: true });
    say(chatId, "message", { message: { ...message, pending: undefined } });
    const { data, error } = await supabase.from("messages").insert({
      id: message.id, chat_id: chatId, sender_id: me.id, body, reply_to: message.reply_to, attachment: message.attachment,
    }).select("*").single();
    if (error || !data) {
      dispatch({ type: "failed", id: message.id, chatId });
      say(chatId, "unsend", { id: message.id });
    } else {
      dispatch({ type: "message", message: data as Message, me: me.id, reading: true });
    }
  }, [me.id, supabase, say]);

  /** A file, as Telegram sends one: in the conversation at once, showing how
   * far it has gone up, with × to stop it; once it is up, its message is sent
   * as any other. If it cannot go up, it says so and can be sent again. */
  const sendFile = useCallback(async (chatId: string, file: File, options: { caption: string; replyTo: string | null; preview: string | null; id?: string }) => {
    const id = options.id ?? crypto.randomUUID();
    const kept = { chatId, file, caption: options.caption, replyTo: options.replyTo, preview: options.preview };
    const facts = { name: file.name, mime: file.type || "application/octet-stream", size: file.size };
    setUpload(id, { ...kept, loaded: 0 });
    dispatch({
      type: "message", me: me.id, reading: true, message: {
        id, chat_id: chatId, sender_id: me.id, kind: "text", body: options.caption, reply_to: options.replyTo, attachment: { path: "", ...facts },
        created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reactions: {}, pinned_at: null, forwarded: null, pending: "sending",
      },
    });
    const failed = () => {
      setUpload(id, { ...kept, loaded: 0, failed: true });
      dispatch({ type: "failed", id, chatId });
    };
    const { data } = await supabase.auth.getSession();
    // Stopped meanwhile: nothing to send.
    if (!uploadOf(id)) return;
    if (!data.session) return failed();
    const path = `${chatId}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file"}`;
    const upload = putFile({
      url: realtime.url, key: realtime.key, token: data.session.access_token, path, file,
      onProgress: loaded => { const now = uploadOf(id); if (now) setUpload(id, { ...now, loaded }); },
    });
    setUpload(id, { ...kept, loaded: 0, stop: upload.stop });
    const outcome = await upload.done;
    if (outcome === "stopped" || !uploadOf(id)) return;
    if (outcome === "failed") return failed();
    if (options.preview) keepPreview(path, options.preview);
    // Its message takes its place first, so it never shows without its file.
    const saving = send(chatId, options.caption, { replyTo: options.replyTo, attachment: { path, ...facts }, id });
    setUpload(id, null);
    await saving;
  }, [me.id, supabase, realtime.url, realtime.key, send]);

  /** Stopping a file on its way, or taking away one that failed: gone from the conversation. */
  const stopFile = useCallback((id: string) => {
    const upload = uploadOf(id);
    if (!upload) return;
    setUpload(id, null);
    upload.stop?.();
    dispatch({ type: "remove", chatId: upload.chatId, ids: [id] });
    // The chat list's last message, as it was before.
    void reloadChats();
  }, [reloadChats]);

  const retryFile = useCallback((id: string) => {
    const upload = uploadOf(id);
    if (upload) void sendFile(upload.chatId, upload.file, { caption: upload.caption, replyTo: upload.replyTo, preview: upload.preview, id });
  }, [sendFile]);

  const edit = useCallback(async (message: Message, body: string) => {
    dispatch({ type: "changed", message: { ...message, body, edited_at: new Date().toISOString() } });
    const { error } = await supabase.from("messages").update({ body }).eq("id", message.id);
    if (error) dispatch({ type: "changed", message });
  }, [supabase]);

  /** Whether this person runs a chat: its owner, or one of KIASA's admins in it. */
  const runs = useCallback((chat: ChatSummary) => me.admin || (state.members[chat.id] ?? []).some(member => member.user_id === me.id && member.role === "owner"), [me.admin, me.id, state.members]);

  /** Deleting messages, after asking: for oneself, or, where it is allowed, for
   * everyone (one's own anywhere, anyone's in a direct chat, anyone's in a
   * group one runs), as Telegram asks it. */
  const remove = useCallback((messages: Message[], after?: () => void) => {
    const chat = state.chats.find(entry => entry.id === messages[0]?.chat_id);
    if (!chat || !messages.length) return;
    const allMine = messages.every(message => message.sender_id === me.id);
    const other = chat.kind === "direct" ? (state.members[chat.id] ?? []).find(member => member.user_id !== me.id) : undefined;
    const forEveryone = chat.kind === "saved" ? "same" : chat.kind === "notices" ? null
      : chat.kind === "direct" ? `Also delete for ${other?.name.split(" ")[0] ?? "them"}`
        : allMine || runs(chat) ? "Delete for everyone" : null;
    const count = messages.length === 1 ? "this message" : `these ${messages.length} messages`;
    setAsking({
      title: messages.length === 1 ? "Delete message" : `Delete ${messages.length} messages`,
      text: `Are you sure you want to delete ${count}?`,
      also: forEveryone && forEveryone !== "same" ? { label: forEveryone, checked: allMine } : undefined,
      confirm: "Delete",
      run: async everyone => {
        const { error } = await supabase.rpc("delete_messages", { ids: messages.map(message => message.id), everyone: forEveryone === "same" || everyone });
        if (error) return reason(error);
        dispatch({ type: "remove", chatId: chat.id, ids: messages.map(message => message.id) });
        void reloadChats();
        after?.();
        return null;
      },
    });
  }, [state.chats, state.members, me.id, runs, supabase, reloadChats]);

  /** A reaction, shown at once and saved; one each, as Telegram allows without Premium. */
  const react = useCallback(async (message: Message, emoji: string) => {
    const before = message.reactions ?? {};
    const had = before[emoji]?.includes(me.id);
    const next = Object.fromEntries(Object.entries(before).map(([key, list]) => [key, list.filter(id => id !== me.id)]).filter(([, list]) => list.length));
    if (!had) next[emoji] = [...(next[emoji] ?? []), me.id];
    dispatch({ type: "changed", message: { ...message, reactions: next } });
    const { error } = await supabase.rpc("react", { message: message.id, emoji });
    if (error) {
      dispatch({ type: "changed", message: { ...message, reactions: before } });
      setNotice(reason(error));
    }
  }, [me.id, supabase]);

  const pin = useCallback(async (message: Message, on: boolean) => {
    const { error } = await supabase.rpc("pin_message", { message: message.id, pin: on });
    if (error) setNotice(reason(error));
  }, [supabase]);

  /** Forwarding, to a chat chosen in a picker; then that chat opens. */
  const forwardTo = useCallback(async (target: string | "saved") => {
    if (!forwarding) return null;
    let chatId = target;
    if (target === "saved") {
      const { data, error } = await supabase.rpc("saved_chat");
      if (error || !data) return reason(error);
      chatId = data as string;
    }
    const { error } = await supabase.rpc("forward_messages", { ids: forwarding.ids, target: chatId });
    if (error) return reason(error);
    forwarding.after?.();
    setForwarding(null);
    await reloadChats();
    void open(chatId);
    return null;
  }, [forwarding, supabase, reloadChats, open]);

  const copy = useCallback((messages: Message[]) => {
    const text = messages.length === 1 ? gist(messages[0]) : messages.map(message => {
      const who = message.sender_id === me.id ? me.name : (state.members[message.chat_id] ?? []).find(member => member.user_id === message.sender_id)?.name ?? "KIASA";
      return `${who}: ${gist(message)}`;
    }).join("\n");
    void navigator.clipboard?.writeText(text).then(() => setNotice(messages.length === 1 ? "Copied." : `${messages.length} messages copied.`), () => setNotice("The browser did not let the page copy."));
  }, [me.id, me.name, state.members]);

  /** Words in a chat's messages, the newest first, from the database. */
  const search = useCallback(async (chatId: string, words: string) => {
    const pattern = `%${words.replace(/[%_\\]/g, char => `\\${char}`)}%`;
    const { data } = await supabase.from("messages").select("*").eq("chat_id", chatId).is("deleted_at", null)
      .ilike("body", pattern).order("created_at", { ascending: false }).limit(50);
    return (data ?? []) as Message[];
  }, [supabase]);

  /** An older message, brought into the conversation (with everything since it), to be shown. */
  const bringIn = useCallback(async (message: Message) => {
    const known = state.messages[message.chat_id] ?? [];
    if (known.some(entry => entry.id === message.id)) return true;
    const oldest = known[0]?.created_at ?? new Date().toISOString();
    const { data, error } = await supabase.from("messages").select("*").eq("chat_id", message.chat_id).is("deleted_at", null)
      .gte("created_at", message.created_at).lt("created_at", oldest).order("created_at", { ascending: true }).limit(500);
    if (error) return false;
    dispatch({ type: "earlier", chatId: message.chat_id, messages: (data ?? []) as Message[], more: true });
    return true;
  }, [state.messages, supabase]);

  /** This person's own view of a chat (pinned, muted, archived, unread), shown at once and saved. */
  const setView = useCallback(async (chat: ChatSummary, view: ChatView) => {
    const before: ChatView = { pinned_at: chat.pinned_at, muted: chat.muted, archived: chat.archived, marked_unread: chat.marked_unread };
    dispatch({ type: "view", chatId: chat.id, view });
    const { error } = await supabase.rpc("set_chat", {
      chat: chat.id,
      pin: "pinned_at" in view ? !!view.pinned_at : null, mute: view.muted ?? null, archive: view.archived ?? null, unread: view.marked_unread ?? null,
    });
    if (error) {
      dispatch({ type: "view", chatId: chat.id, view: before });
      setNotice(reason(error));
    }
  }, [supabase]);

  /** Clearing a chat's history, after asking: for oneself, or for both (a
   * direct chat) or everyone (a group one runs). */
  const askClear = useCallback((chat: ChatSummary) => {
    const title = chatTitle(chat, state.members[chat.id] ?? [], me);
    const other = chat.kind === "direct" ? title.split(" ")[0] : null;
    setAsking({
      title: "Clear history",
      text: `Are you sure you want to clear the history of ${chat.kind === "saved" ? "Saved Messages" : `“${title}”`}? Its messages go; the chat stays.`,
      also: other ? { label: `Also clear for ${other}`, checked: false } : chat.kind === "group" && runs(chat) ? { label: "Clear for everyone in the group", checked: false } : undefined,
      confirm: "Clear history",
      run: async everyone => {
        const { error } = await supabase.rpc("clear_history", { chat: chat.id, everyone: chat.kind === "saved" || everyone });
        if (error) return reason(error);
        dispatch({ type: "clear", chatId: chat.id, upTo: new Date().toISOString() });
        void reloadChats();
        return null;
      },
    });
  }, [state.members, me, runs, supabase, reloadChats]);

  /** Deleting a chat, or leaving a group, after asking. */
  const askDelete = useCallback((chat: ChatSummary) => {
    const title = chatTitle(chat, state.members[chat.id] ?? [], me);
    const group = chat.kind === "group";
    const owner = group && runs(chat);
    setAsking({
      title: group ? (owner ? "Delete or leave group" : "Leave group") : "Delete chat",
      text: group
        ? `Are you sure you want to leave “${title}”?${owner ? " Or delete it, for everyone in it." : ""}`
        : `Are you sure you want to delete ${chat.kind === "saved" ? "Saved Messages" : `the chat with ${title}`}? Its history goes too; a new message brings the chat back.`,
      also: owner ? { label: "Delete the group for everyone", checked: false }
        : chat.kind === "direct" ? { label: `Also delete for ${title.split(" ")[0]}`, checked: false } : undefined,
      confirm: group ? (owner ? "Go ahead" : "Leave group") : "Delete chat",
      run: async everyone => {
        const { error } = await supabase.rpc("delete_chat", { chat: chat.id, everyone });
        if (error) return reason(error);
        dispatch({ type: "leave", chatId: chat.id });
        if (activeRef.current === chat.id) {
          activeRef.current = null;
          setActive(null);
        }
        void reloadChats();
        return null;
      },
    });
  }, [state.members, me, runs, supabase, reloadChats]);

  /** A chat's menu, as Telegram's: from its row in the list (right-click or a
   * long press) or the ⋮ in its conversation. */
  const chatMenu = useCallback((chat: ChatSummary): MenuItem[] => {
    const items: MenuItem[] = [
      { label: "Open in new tab", icon: <NewTab />, onSelect: () => window.open(`/chat?c=${chat.id}`, "_blank", "noopener") },
      chat.unread > 0 || chat.marked_unread
        ? { label: "Mark as read", icon: <Check />, onSelect: () => void markRead(chat.id) }
        : { label: "Mark as unread", icon: <Unread />, onSelect: () => void setView(chat, { marked_unread: true }) },
      chat.pinned_at
        ? { label: "Unpin", icon: <Pin />, onSelect: () => void setView(chat, { pinned_at: null }) }
        : { label: "Pin", icon: <Pin />, onSelect: () => void setView(chat, { pinned_at: new Date().toISOString() }) },
      chat.muted
        ? { label: "Unmute", icon: <Bell />, onSelect: () => void setView(chat, { muted: false }) }
        : { label: "Mute", icon: <BellOff />, onSelect: () => void setView(chat, { muted: true }) },
      chat.archived
        ? { label: "Unarchive", icon: <Archive />, onSelect: () => void setView(chat, { archived: false }) }
        : { label: "Archive", icon: <Archive />, onSelect: () => void setView(chat, { archived: true }) },
      { label: "Clear history", icon: <Eraser />, onSelect: () => askClear(chat) },
    ];
    items.push(chat.kind === "group"
      ? { label: runs(chat) ? "Delete or leave group" : "Leave group", icon: <Leave />, danger: true, onSelect: () => askDelete(chat) }
      : { label: "Delete chat", icon: <Trash />, danger: true, onSelect: () => askDelete(chat) });
    return items;
  }, [markRead, setView, askClear, askDelete, runs]);

  const canPin = useCallback((chat: ChatSummary) => chat.kind === "direct" || chat.kind === "saved" || (chat.kind === "group" && runs(chat)), [runs]);
  const forward = useCallback((messages: Message[], after?: () => void) => setForwarding({ ids: messages.map(message => message.id), after }), []);
  const actions: MessageActions = useMemo(() => ({
    react: (message, emoji) => void react(message, emoji),
    pin: (message, on) => void pin(message, on),
    forward, remove, copy, search, bringIn, chatMenu, canPin,
    sendFile: (chatId, file, options) => void sendFile(chatId, file, options), stopFile, retryFile,
  }), [react, pin, forward, remove, copy, search, bringIn, chatMenu, canPin, sendFile, stopFile, retryFile]);

  const activeChat = state.chats.find(chat => chat.id === active) ?? null;
  const typists = activeChat ? Object.values(typing[activeChat.id] ?? {}).map(entry => entry.name.split(" ")[0]) : [];
  return <div className="chat" data-open={activeChat ? "" : undefined}>
    <ChatList me={me} chats={state.chats} members={state.members} people={peopleNow} online={online} active={active} live={live}
      supabase={supabase} realtime={realtime} photoOf={photoOf} chatMenu={chatMenu}
      onOpen={chatId => void open(chatId)} onMade={made} onPerson={person => void openPerson(person)} onSaved={() => void openSaved()} />
    {activeChat
      ? <Conversation key={activeChat.id} me={me} chat={activeChat} members={state.members[activeChat.id] ?? []} people={peopleNow} photoOf={photoOf}
        messages={state.messages[activeChat.id]} pinned={state.pinned[activeChat.id] ?? []} more={!!state.more[activeChat.id]} online={online} seenOf={seenOf}
        supabase={supabase} typing={typists} actions={actions}
        onBack={() => void open(null)} onSend={send} onEdit={edit} onEarlier={() => earlier(activeChat.id)}
        onRead={readActive} onTyping={() => say(activeChat.id, "typing", { user: me.id })} onPerson={person => void openPerson(person)} />
      : <div className="chat-empty"><p>Choose a chat, or start one.</p></div>}
    {asking && <Confirm title={asking.title} text={asking.text} also={asking.also} confirm={asking.confirm} onConfirm={asking.run} onClose={() => setAsking(null)} />}
    {forwarding && <ForwardPicker me={me} chats={state.chats} members={state.members} count={forwarding.ids.length} photoOf={photoOf}
      onPick={forwardTo} onClose={() => setForwarding(null)} />}
    {notice && <p className="chat-notice-bar" role="status">{notice}</p>}
  </div>;
}

/** A message as another browser sent it: a person's, in this chat, in the
 * shape the database gives. Anything else is ignored. */
function isMessage(value: unknown, chatId: string): value is Message & { sender_id: string } {
  const message = value as Partial<Message> | null;
  if (!message || typeof message !== "object") return false;
  const file = message.attachment;
  return message.chat_id === chatId && message.kind === "text" && typeof message.id === "string" && typeof message.sender_id === "string"
    && typeof message.body === "string" && message.body.length <= 4000 && typeof message.created_at === "string"
    && (message.reply_to === null || typeof message.reply_to === "string")
    && (file === null || (!!file && typeof file === "object" && !file.type && typeof file.path === "string" && typeof file.name === "string"));
}

/** A new message while this tab is hidden: the computer says so, if it may. */
function alertComputer(message: Message, me: ChatMe) {
  if (!("Notification" in window) || Notification.permission !== "granted" || message.sender_id === me.id) return;
  const body = message.deleted_at ? "" : message.body || (message.attachment && !message.attachment.type ? `📎 ${message.attachment.name}` : "New message");
  void navigator.serviceWorker?.getRegistration("/").then(registration => {
    const options = { body, icon: "/icon.png", tag: `chat-${message.chat_id}`, data: { url: "/chat" } };
    if (registration) return registration.showNotification("KIASA Chat", options);
    new Notification("KIASA Chat", options);
  });
}
