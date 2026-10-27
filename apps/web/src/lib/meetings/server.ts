import "server-only";
import { publicSupabase, siteClient, visitorClient } from "@/lib/accounts/server";
import { photoUrl } from "@/lib/accounts/viewer";
import type { ChatMe } from "@/lib/chat/types";
import type { Admission, Meeting, MeetStart } from "./types";

// Where browsers learn their own address on the internet; and a relay (TURN),
// when one is set (MEETING_TURN_URLS, comma-separated, with its username and
// credential), for the few networks that let no call through directly.
function iceServers(): MeetStart["ice"] {
  const servers: MeetStart["ice"] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const turn = (process.env.MEETING_TURN_URLS ?? "").split(",").map(url => url.trim()).filter(Boolean);
  if (turn.length) servers.push({ urls: turn, username: process.env.MEETING_TURN_USERNAME, credential: process.env.MEETING_TURN_CREDENTIAL });
  return servers;
}

/** A meeting, as the person signed in may see it (the database's rules: a
 * member of its chat), with everyone who may join it. Null if they may not. */
export async function meetingFor(id: string, me: ChatMe): Promise<MeetStart | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const visitor = await visitorClient();
  const { data: meeting } = await visitor.from("meetings").select("*").eq("id", id).maybeSingle();
  if (!meeting) return null;
  const chatId = (meeting as Meeting).chat_id;
  const site = siteClient();
  const [chat, members, avatars, admins, admissions] = await Promise.all([
    visitor.from("chats").select("kind, title").eq("id", chatId).maybeSingle(),
    visitor.from("chat_members").select("user_id, name").eq("chat_id", chatId),
    site.from("avatars").select("user_id, path"),
    site.rpc("admin_users"),
    visitor.from("meeting_admissions").select("user_id, name, status, asked_at").eq("meeting_id", id),
  ]);
  const photos = new Map(((avatars.data ?? []) as { user_id: string; path: string }[]).map(row => [row.user_id, photoUrl(publicSupabase.url, row.path)]));
  const people = ((members.data ?? []) as { user_id: string; name: string }[]).map(row => ({ id: row.user_id, name: row.name, photo: photos.get(row.user_id) ?? null }));
  const others = people.filter(person => person.id !== me.id);
  const chatTitle = (chat.data?.title as string | null) ?? (others.map(person => person.name).join(", ") || "Meeting");
  return {
    meeting: meeting as Meeting, chatTitle, people,
    admins: ((admins.data ?? []) as { id: string }[]).map(admin => admin.id),
    admissions: (admissions.data ?? []) as Admission[], me: { id: me.id, name: me.name, admin: me.admin, photo: me.photo }, ice: iceServers(),
  };
}
