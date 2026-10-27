"use server";

import { accountsLive, currentViewer, siteClient } from "@/lib/accounts/server";
import type { Attachment } from "@/lib/chat/types";

type Card = Extract<Attachment, { type: "meeting" }>;
const SETUP = "Meetings are not set up in the database yet: an admin runs supabase/migrations/20261027120000_meetings.sql in Supabase's SQL Editor.";
const RETRY = "That did not work just now. Please try again.";

/** The admin asking, if they are one and are in this chat. Checked here, not
 * only on the page: an action can be called by anyone who finds it. */
async function organizer(chatId: string): Promise<{ id: string; name: string } | { error: string }> {
  if (!accountsLive) return { error: "Meetings open once accounts are connected." };
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: "Only KIASA's admins can organize meetings." };
  const site = siteClient();
  const [member, chat] = await Promise.all([
    site.from("chat_members").select("user_id").eq("chat_id", chatId).eq("user_id", viewer.id).maybeSingle(),
    site.from("chats").select("kind").eq("id", chatId).maybeSingle(),
  ]);
  if (!member.data || !chat.data) return { error: "You are not in that chat." };
  if (chat.data.kind !== "group" && chat.data.kind !== "direct") return { error: "Meetings are held in group chats and one-to-one chats." };
  return { id: viewer.id, name: viewer.admin.name };
}

/** A meeting's card in its chat. A new card is a new message, so everyone in
 * the chat is told (their chat alerts, and the ringing on an open chat). */
async function postCard(chatId: string, body: string, card: Card) {
  await siteClient().from("messages").insert({ chat_id: chatId, kind: "notice", body, attachment: card });
}

/** Every card of a meeting, brought up to date (they change live on open pages). */
async function updateCards(meetingId: string, change: Partial<Card>) {
  const site = siteClient();
  const { data: cards } = await site.from("messages").select("id, attachment").eq("attachment->>type", "meeting").eq("attachment->>id", meetingId);
  await Promise.all((cards ?? []).map(card => site.from("messages").update({ attachment: { ...(card.attachment as Card), ...change } }).eq("id", card.id)));
}

const cleanTitle = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, 120);

/** An admin starts a meeting in a chat now: everyone in it is rung. */
export async function startMeeting(chatId: string, title: string): Promise<{ id?: string; error?: string }> {
  const who = await organizer(chatId);
  if ("error" in who) return who;
  const name = cleanTitle(title) || "Meeting";
  const now = new Date().toISOString();
  const { data, error } = await siteClient().from("meetings")
    .insert({ chat_id: chatId, title: name, starts_at: now, started_at: now, created_by: who.id }).select("id").single();
  if (error || !data) return { error: error?.code === "42P01" || error?.code === "PGRST205" ? SETUP : RETRY };
  await postCard(chatId, `📹 ${who.name} started a meeting: ${name}`, { type: "meeting", id: data.id as string, title: name, starts_at: now, status: "live", by: who.name });
  return { id: data.id as string };
}

/** An admin plans a meeting for later: its card waits in the chat. */
export async function scheduleMeeting(chatId: string, title: string, startsAt: string): Promise<{ id?: string; error?: string }> {
  const who = await organizer(chatId);
  if ("error" in who) return who;
  const when = Date.parse(startsAt);
  if (!Number.isFinite(when)) return { error: "Please choose a day and time." };
  if (when < Date.now() - 5 * 60_000) return { error: "That time has passed. Please choose a later one." };
  if (when > Date.now() + 366 * 86400_000) return { error: "Please choose a time within a year." };
  const name = cleanTitle(title) || "Meeting";
  const at = new Date(when).toISOString();
  const { data, error } = await siteClient().from("meetings")
    .insert({ chat_id: chatId, title: name, starts_at: at, created_by: who.id }).select("id").single();
  if (error || !data) return { error: error?.code === "42P01" || error?.code === "PGRST205" ? SETUP : RETRY };
  await postCard(chatId, `📅 ${who.name} scheduled a meeting: ${name}`, { type: "meeting", id: data.id as string, title: name, starts_at: at, status: "scheduled", by: who.name });
  return { id: data.id as string };
}

/** The meeting, and the admin asking, if they may run it. */
async function running(meetingId: string) {
  if (!/^[0-9a-f-]{36}$/.test(meetingId)) return { error: RETRY };
  const { data: meeting } = await siteClient().from("meetings").select("id, chat_id, title, started_at, ended_at").eq("id", meetingId).maybeSingle();
  if (!meeting) return { error: "That meeting is gone." };
  const who = await organizer(meeting.chat_id as string);
  if ("error" in who) return who;
  return { meeting: meeting as { id: string; chat_id: string; title: string; started_at: string | null; ended_at: string | null }, who };
}

/** An admin starts a planned meeting: its card turns live, and a new card rings everyone. */
export async function beginMeeting(meetingId: string): Promise<{ error?: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { meeting, who } = found;
  if (meeting.ended_at) return { error: "That meeting is over." };
  if (meeting.started_at) return {};
  const now = new Date().toISOString();
  const { error } = await siteClient().from("meetings").update({ started_at: now }).eq("id", meetingId).is("started_at", null);
  if (error) return { error: RETRY };
  await updateCards(meetingId, { status: "live" });
  await postCard(meeting.chat_id, `📹 ${who.name} started the meeting: ${meeting.title}`, { type: "meeting", id: meetingId, title: meeting.title, starts_at: now, status: "live", by: who.name });
  return {};
}

/** An admin ends a meeting for everyone, or calls off a planned one. */
export async function endMeeting(meetingId: string): Promise<{ error?: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { meeting } = found;
  if (meeting.ended_at) return {};
  const now = new Date().toISOString();
  const { error } = await siteClient().from("meetings").update({ ended_at: now }).eq("id", meetingId);
  if (error) return { error: RETRY };
  await updateCards(meetingId, { status: meeting.started_at ? "ended" : "cancelled", ended_at: now });
  return {};
}

/** A member asks to join a meeting: an admin in it lets them in, or not.
 * Someone already let in stays in (they may leave and come back). */
export async function askToJoin(meetingId: string): Promise<{ status?: "waiting" | "admitted"; error?: string }> {
  if (!accountsLive) return { error: "Meetings open once accounts are connected." };
  if (!/^[0-9a-f-]{36}$/.test(meetingId)) return { error: RETRY };
  const viewer = await currentViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (viewer.admin) return { status: "admitted" };
  const site = siteClient();
  const { data: meeting } = await site.from("meetings").select("chat_id, ended_at").eq("id", meetingId).maybeSingle();
  if (!meeting || meeting.ended_at) return { error: "That meeting is over." };
  const { data: member } = await site.from("chat_members").select("name").eq("chat_id", meeting.chat_id).eq("user_id", viewer.id).maybeSingle();
  if (!member) return { error: "This meeting is for the people of its chat." };
  const { data: asked } = await site.from("meeting_admissions").select("status").eq("meeting_id", meetingId).eq("user_id", viewer.id).maybeSingle();
  if (asked?.status === "admitted") return { status: "admitted" };
  const { error } = await site.from("meeting_admissions").upsert({
    meeting_id: meetingId, user_id: viewer.id, name: member.name as string, status: "waiting", asked_at: new Date().toISOString(), decided_at: null, decided_by: null,
  }, { onConflict: "meeting_id,user_id" });
  if (error) return { error: error.code === "42P01" || error.code === "PGRST205"
    ? "Asking to join is not set up in the database yet: an admin runs supabase/migrations/20261027150000_meeting_admissions.sql in Supabase's SQL Editor." : RETRY };
  return { status: "waiting" };
}

/** An admin lets someone into a meeting, or turns them away. */
export async function decideJoin(meetingId: string, userId: string, admit: boolean): Promise<{ error?: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { error } = await siteClient().from("meeting_admissions")
    .update({ status: admit ? "admitted" : "denied", decided_at: new Date().toISOString(), decided_by: found.who.name })
    .eq("meeting_id", meetingId).eq("user_id", userId);
  if (error) return { error: RETRY };
  return {};
}
