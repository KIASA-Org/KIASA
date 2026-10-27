import type { ChatMember, ChatSummary, Message } from "@/lib/chat/types";

/** Everything the chat page knows, kept in one place so a live change (a new
 * message, a read mark, a new chat) updates every part of the page at once. */
export type ChatState = {
  chats: ChatSummary[];
  members: Record<string, ChatMember[]>;
  messages: Record<string, Message[]>;
  /** Per chat, once its latest messages are loaded: are older ones still to load? */
  more: Record<string, boolean>;
  /** Per chat, once asked for: its pinned messages, the latest pinned first. */
  pinned: Record<string, Message[]>;
};

/** A chat just made, shown before the chat list has been asked for again. */
export type ChatDraft = { chat: ChatSummary; members: ChatMember[] };

/** A one-to-one chat as it looks until the chat list is asked for again. */
export function directDraft(id: string, me: { id: string; name: string }, other: { id: string; name: string }): ChatDraft {
  const now = new Date().toISOString();
  return {
    chat: {
      id, kind: "direct", title: null, last_message_at: now, unread: 0, last_body: null, last_sender: null, last_kind: null, last_file: null,
      pinned_at: null, muted: false, archived: false, marked_unread: false,
    },
    members: [me, other].map(person => ({ chat_id: id, user_id: person.id, name: person.name, role: "member", last_read_at: now })),
  };
}

/** This person's own view of a chat, as they change it. */
export type ChatView = Partial<Pick<ChatSummary, "pinned_at" | "muted" | "archived" | "marked_unread">>;

export type ChatAction =
  | { type: "chats"; chats: ChatSummary[]; members: ChatMember[] }
  | { type: "draft"; draft: ChatDraft }
  | { type: "history"; chatId: string; messages: Message[]; more: boolean }
  | { type: "earlier"; chatId: string; messages: Message[]; more: boolean }
  | { type: "message"; message: Message; me: string; reading: boolean }
  | { type: "changed"; message: Message }
  | { type: "failed"; id: string; chatId: string }
  | { type: "drop"; id: string; chatId: string }
  | { type: "remove"; chatId: string; ids: string[] }
  | { type: "clear"; chatId: string; upTo: string }
  | { type: "view"; chatId: string; view: ChatView }
  | { type: "leave"; chatId: string }
  | { type: "pinned"; chatId: string; messages: Message[] }
  | { type: "member"; member: ChatMember }
  | { type: "member-gone"; chatId: string; userId: string }
  | { type: "read"; chatId: string };

const byTime = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at);
const byPin = (a: Message, b: Message) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "");
/** Pinned chats first, the latest pinned on top; then the newest. */
const sortChats = (chats: ChatSummary[]) => [...chats].sort((a, b) =>
  (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "") || b.last_message_at.localeCompare(a.last_message_at));
const settled = (message: Message) => !message.pending && !message.provisional;
const without = <T,>(record: Record<string, T>, key: string) => Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "chats": {
      const members: Record<string, ChatMember[]> = {};
      for (const member of action.members) (members[member.chat_id] ??= []).push(member);
      // A chat opened here that the database's list does not have yet (one
      // deleted from the list earlier, until its next message) stays.
      const drafts = state.chats.filter(chat => chat.draft && !action.chats.some(next => next.id === chat.id));
      return { ...state, chats: sortChats([...action.chats, ...drafts]), members: { ...state.members, ...members } };
    }
    case "draft":
      if (state.chats.some(chat => chat.id === action.draft.chat.id)) return state;
      return { ...state, chats: sortChats([{ ...action.draft.chat, draft: true }, ...state.chats]), members: { ...state.members, [action.draft.chat.id]: action.draft.members } };
    case "history":
      return { ...state, messages: { ...state.messages, [action.chatId]: mergeMessages(state.messages[action.chatId] ?? [], action.messages) }, more: { ...state.more, [action.chatId]: action.more } };
    case "earlier":
      return { ...state, messages: { ...state.messages, [action.chatId]: mergeMessages(action.messages, state.messages[action.chatId] ?? []) }, more: { ...state.more, [action.chatId]: action.more } };
    case "message": {
      const { message, me, reading } = action;
      if (message.deleted_at) return state;
      // Kept even before the chat's history is loaded, so that a message which
      // arrives by both routes, straight and from the database, counts once.
      const known = state.messages[message.chat_id] ?? [];
      const seen = known.some(entry => entry.id === message.id);
      const chats = state.chats.map(chat => {
        if (chat.id !== message.chat_id) return chat;
        // One more unread the first time someone else's arrives while the chat is not being read.
        const unread = !seen && !reading && message.sender_id !== me && !message.pending ? chat.unread + 1 : chat.unread;
        // Only the newest message speaks for the chat in the list.
        if (message.created_at < chat.last_message_at) return { ...chat, unread };
        return {
          ...chat, unread, last_message_at: message.created_at,
          last_body: message.body, last_sender: message.sender_id, last_kind: message.kind,
          last_file: message.attachment && !message.attachment.type ? message.attachment.name : null,
        };
      });
      return { ...state, messages: { ...state.messages, [message.chat_id]: mergeMessages(known, [message]) }, chats: sortChats(chats) };
    }
    case "changed": {
      // Deleted for everyone: gone from the conversation, as in Telegram.
      if (action.message.deleted_at) return removeMessages(state, action.message.chat_id, [action.message.id]);
      const known = state.messages[action.message.chat_id];
      const messages = known
        ? { ...state.messages, [action.message.chat_id]: known.map(entry => entry.id === action.message.id ? { ...entry, ...action.message } : entry) }
        : state.messages;
      // Pinned or unpinned: the pinned bar follows.
      const pins = state.pinned[action.message.chat_id];
      if (!pins) return { ...state, messages };
      const others = pins.filter(entry => entry.id !== action.message.id);
      const merged = known?.find(entry => entry.id === action.message.id);
      const next = action.message.pinned_at ? [{ ...merged, ...action.message }, ...others].sort(byPin) : others;
      return { ...state, messages, pinned: { ...state.pinned, [action.message.chat_id]: next } };
    }
    case "failed": {
      const known = state.messages[action.chatId];
      if (!known) return state;
      return { ...state, messages: { ...state.messages, [action.chatId]: known.map(entry => entry.id === action.id ? { ...entry, pending: "failed" } : entry) } };
    }
    case "drop": {
      // Only a copy that came straight from another browser, never one the database has confirmed.
      const known = state.messages[action.chatId];
      if (!known?.some(entry => entry.id === action.id && entry.provisional)) return state;
      return { ...state, messages: { ...state.messages, [action.chatId]: known.filter(entry => entry.id !== action.id) } };
    }
    case "remove":
      return removeMessages(state, action.chatId, action.ids);
    case "clear": {
      // Everything up to then is gone; there is nothing older to load.
      const keep = (list: Message[] | undefined) => (list ?? []).filter(entry => entry.created_at > action.upTo);
      return {
        ...state,
        messages: { ...state.messages, [action.chatId]: keep(state.messages[action.chatId]) },
        pinned: state.pinned[action.chatId] ? { ...state.pinned, [action.chatId]: keep(state.pinned[action.chatId]) } : state.pinned,
        more: { ...state.more, [action.chatId]: false },
      };
    }
    case "view":
      return { ...state, chats: sortChats(state.chats.map(chat => chat.id === action.chatId ? { ...chat, ...action.view } : chat)) };
    case "leave":
      return {
        ...state, chats: state.chats.filter(chat => chat.id !== action.chatId), members: without(state.members, action.chatId),
        messages: without(state.messages, action.chatId), more: without(state.more, action.chatId), pinned: without(state.pinned, action.chatId),
      };
    case "pinned":
      return { ...state, pinned: { ...state.pinned, [action.chatId]: [...action.messages].sort(byPin) } };
    case "member": {
      const list = state.members[action.member.chat_id] ?? [];
      const next = list.some(entry => entry.user_id === action.member.user_id)
        ? list.map(entry => entry.user_id === action.member.user_id ? { ...entry, ...action.member } : entry)
        : [...list, action.member];
      return { ...state, members: { ...state.members, [action.member.chat_id]: next } };
    }
    case "member-gone": {
      const list = state.members[action.chatId];
      if (!list) return state;
      return { ...state, members: { ...state.members, [action.chatId]: list.filter(entry => entry.user_id !== action.userId) } };
    }
    case "read":
      return { ...state, chats: state.chats.map(chat => chat.id === action.chatId ? { ...chat, unread: 0, marked_unread: false } : chat) };
  }
}

function removeMessages(state: ChatState, chatId: string, ids: string[]): ChatState {
  const gone = new Set(ids);
  const known = state.messages[chatId], pins = state.pinned[chatId];
  if (!known?.some(entry => gone.has(entry.id)) && !pins?.some(entry => gone.has(entry.id))) return state;
  return {
    ...state,
    messages: known ? { ...state.messages, [chatId]: known.filter(entry => !gone.has(entry.id)) } : state.messages,
    pinned: pins ? { ...state.pinned, [chatId]: pins.filter(entry => !gone.has(entry.id)) } : state.pinned,
  };
}

/** Two runs of messages as one, in time order, each message once, none deleted.
 * The database's copy wins over one still sending or come straight from
 * another browser; such a copy never replaces one the database has confirmed. */
function mergeMessages(first: Message[], second: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of [...first, ...second]) {
    if (message.deleted_at) continue;
    const known = byId.get(message.id);
    if (!known) byId.set(message.id, message);
    else if (settled(message)) byId.set(message.id, { ...known, ...message, pending: undefined, provisional: undefined });
    else if (!settled(known)) byId.set(message.id, { ...known, ...message });
  }
  return [...byId.values()].sort(byTime);
}
