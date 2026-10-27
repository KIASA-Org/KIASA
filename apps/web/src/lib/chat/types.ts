/** The shapes KIASA Chat passes between the server and the page. */

/** The signed-in person. `photo`, here and below: the address of a profile photo, if set. */
export type ChatMe = { id: string; name: string; email: string; admin: boolean; photo: string | null };

/** Someone you can chat with. `detail` says who they are: their organization, or
 * "KIASA admin"; `username` and `bio`, as they set them; `seen`, when they were
 * last here. */
export type ChatPerson = {
  id: string; name: string; detail: string; admin: boolean; photo: string | null;
  username: string | null; bio: string; seen: string | null;
};

export type ChatKind = "group" | "direct" | "notices" | "saved";

/** A row of the chat list (the database's `inbox`): the chat, its last message,
 * and this person's own view of it (pinned, muted, archived, marked unread). */
export type ChatSummary = {
  id: string; kind: ChatKind; title: string | null; last_message_at: string; unread: number;
  last_body: string | null; last_sender: string | null; last_kind: string | null; last_file: string | null;
  pinned_at: string | null; muted: boolean; archived: boolean; marked_unread: boolean;
  /** On this page only: opened or made here, and not yet in the database's list. */
  draft?: boolean;
  /** On this page only: the newest message the database's list had counted when it came. */
  counted_to?: string;
};

export type ChatMember = { chat_id: string; user_id: string; name: string; role: "owner" | "member"; last_read_at: string };

/** A row as `inbox` gives it: the chat, with who is in it. */
export type ChatRow = ChatSummary & { members?: ChatMember[] };

/** The chat list as the database gives it, as the page keeps it: the chats,
 * and everyone in them. */
export function splitChatList(rows: ChatRow[] | null): { chats: ChatSummary[]; members: ChatMember[] } {
  const chats: ChatSummary[] = [], members: ChatMember[] = [];
  for (const { members: inChat = [], ...chat } of rows ?? []) {
    chats.push(chat);
    members.push(...inChat);
  }
  return { chats, members };
}

export type Attachment =
  | { type?: undefined; path: string; name: string; mime: string; size: number }
  | { type: "request"; id: string; name: string; email: string; organization: string | null; reason: string; status: "waiting" | "approved" | "declined" | "deleted"; decided_by?: string };

/** The reactions on a message: each emoji, with who gave it. */
export type Reactions = Record<string, string[]>;

/** The reactions anyone can give, in the order the menu shows them (as the database allows them). */
export const REACTIONS = ["❤️", "👍", "👎", "🔥", "🥰", "👏", "😁", "🎉", "🤔", "😢", "🙏", "👌"];

export type Message = {
  id: string; chat_id: string; sender_id: string | null; kind: "text" | "notice"; body: string;
  reply_to: string | null; attachment: Attachment | null; created_at: string; edited_at: string | null; deleted_at: string | null;
  reactions?: Reactions;
  /** Pinned to the top of its chat, since then. */
  pinned_at?: string | null;
  /** Forwarded: whose message it first was. */
  forwarded?: { name: string } | null;
  /** On this page only: still on its way, or failed to send. */
  pending?: "sending" | "failed";
  /** On this page only: arrived straight from another browser, not yet confirmed by the database. */
  provisional?: boolean;
};
