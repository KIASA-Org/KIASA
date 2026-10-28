import "server-only";
import { publicSupabase, siteClient, visitorClient } from "@/lib/accounts/server";
import { photoUrl } from "@/lib/accounts/viewer";
import type { ChatMe } from "@/lib/chat/types";
import type { Admission, Meeting, MeetStart } from "./types";

type Ice = MeetStart["ice"];

/** Cloudflare's relay (TURN), when its key is set (CLOUDFLARE_TURN_KEY_ID and
 * CLOUDFLARE_TURN_API_TOKEN): fresh passwords for a day, asked for as the
 * meeting opens, so a call gets through on any network. Nothing, if it is not
 * set or does not answer within three seconds: calls then go straight between
 * browsers, as before. */
async function cloudflareRelay(): Promise<Ice> {
  const key = process.env.CLOUDFLARE_TURN_KEY_ID, token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!key || !token) return [];
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: 86_400 }), cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) { console.error("Cloudflare relay:", response.status); return []; }
    const { iceServers } = await response.json() as { iceServers?: Ice | Ice[number] };
    // Port 53 is left out: some browsers wait on it for a long time.
    return [iceServers ?? []].flat().map(server => ({ ...server, urls: [server.urls].flat().filter(url => !/:53(\?|$)/.test(url)) }))
      .filter(server => server.urls.length);
  } catch (error) {
    console.error("Cloudflare relay:", (error as Error).message);
    return [];
  }
}

// Where browsers learn their own address on the internet; and a relay (TURN),
// for networks that let no call through directly: Cloudflare's (above), or one
// set by hand (MEETING_TURN_URLS, comma-separated, with its username and credential).
async function iceServers(): Promise<Ice> {
  const servers: Ice = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const turn = (process.env.MEETING_TURN_URLS ?? "").split(",").map(url => url.trim()).filter(Boolean);
  if (turn.length) servers.push({ urls: turn, username: process.env.MEETING_TURN_USERNAME, credential: process.env.MEETING_TURN_CREDENTIAL });
  return [...servers, ...await cloudflareRelay()];
}

/** A meeting, as the person signed in may see it (the database's rules: a
 * member of its chat), with everyone who may join it. Null if they may not. */
export async function meetingFor(id: string, me: ChatMe): Promise<MeetStart | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  // Asked for at once, beside everything else.
  const ice = iceServers();
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
    admissions: (admissions.data ?? []) as Admission[], me: { id: me.id, name: me.name, admin: me.admin, photo: me.photo }, ice: await ice,
  };
}
