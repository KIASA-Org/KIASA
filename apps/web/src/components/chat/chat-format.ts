import { useSyncExternalStore } from "react";
import type { ChatMe, ChatMember, ChatPerson, ChatSummary } from "@/lib/chat/types";

/** A chat's name: a group's own, the other person's for a direct chat. */
export function chatTitle(chat: Pick<ChatSummary, "kind" | "title">, members: ChatMember[], me: Pick<ChatMe, "id">) {
  if (chat.kind === "direct") {
    // One the admin reads, between two others: both their names, in a steady order.
    if (members.length > 1 && !members.some(member => member.user_id === me.id)) return members.map(member => member.name).sort((a, b) => a.localeCompare(b)).join(" & ");
    return members.find(member => member.user_id !== me.id)?.name ?? "Direct message";
  }
  if (chat.kind === "saved") return "Saved Messages";
  return chat.title ?? "Chat";
}

/** Whether someone answers a search: every word in their name, who they are, or @username. */
export const findable = (person: ChatPerson, words: string[]) =>
  words.every(word => `${person.name} ${person.detail} ${person.username ? `@${person.username}` : ""}`.toLowerCase().includes(word));

export const initialsOf = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase() || "·";
};

const quiet = () => () => {};
/** True once the page is running in the browser: times are shown in the
 * reader's own time zone, which the server cannot know. */
export const useInBrowser = () => useSyncExternalStore(quiet, () => true, () => false);

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const DAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const LONG = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

/** For the chat list: the time today, the weekday this week, else the date. */
export function shortWhen(iso: string) {
  const when = new Date(iso), now = new Date();
  if (sameDay(when, now)) return clock(iso);
  if (now.getTime() - when.getTime() < 6 * 864e5) return DAY.format(when);
  return DATE.format(when);
}

/** For the line between days in a conversation. */
export function dayLabel(iso: string) {
  const when = new Date(iso), now = new Date();
  if (sameDay(when, now)) return "Today";
  if (sameDay(when, new Date(now.getTime() - 864e5))) return "Yesterday";
  return LONG.format(when);
}
export const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** When someone not online was last here, as Telegram says it. */
export function lastSeen(iso: string | null | undefined) {
  if (!iso) return "offline";
  const when = new Date(iso), now = new Date(), minutes = Math.floor((now.getTime() - when.getTime()) / 60000);
  if (minutes < 1) return "last seen just now";
  if (minutes < 60) return `last seen ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (sameDay(when, now)) return `last seen today at ${clock(iso)}`;
  if (sameDay(when, new Date(now.getTime() - 864e5))) return `last seen yesterday at ${clock(iso)}`;
  return `last seen ${DATE.format(when)}`;
}

/** Up to three emoji and nothing else: shown large, without a bubble, as Telegram shows them. */
const EMOJI = new RegExp("^(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic})*)+$", "u");
export function bigEmoji(text: string) {
  const plain = text.replace(/\s+/g, "");
  if (!plain || plain.length > 32 || !EMOJI.test(plain)) return false;
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(plain)].length <= 3;
}

/** Each person's own colour for their name in a group, the same every time (as in Telegram). */
const AUTHORS = ["#b8ec93", "#45c8ff", "#ffb86b", "#ff8fa3", "#c4a7ff", "#7ee0d3", "#f2d36b"];
export function authorColor(person: string | null) {
  let hash = 0;
  for (const char of person ?? "") hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AUTHORS[Math.abs(hash) % AUTHORS.length];
}

/** A message's words in a line, for a quote, the pinned bar or a search result. */
export const gist = (message: { body: string; attachment?: { type?: string; name?: string } | null }) =>
  message.body || (message.attachment && !message.attachment.type ? `📎 ${message.attachment.name}` : "Message");

export const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
