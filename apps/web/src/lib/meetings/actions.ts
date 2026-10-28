"use server";

import { accountsLive, currentViewer, siteClient } from "@/lib/accounts/server";
import { chatPeople, contactsChat, personalChat, personalChats } from "@/lib/chat/server";
import type { Attachment } from "@/lib/chat/types";
import type { MeetingChoice, MeetingRoster } from "./types";

type Card = Extract<Attachment, { type: "meeting" }>;
type Ask = Extract<Attachment, { type: "meeting_request" }>;
type Person = { id: string; name: string };
const SETUP = "Meetings are not set up in the database yet: an admin runs supabase/migrations/20261027120000_meetings.sql in Supabase's SQL Editor.";
const PEOPLE_SETUP = "Choosing who is in a meeting is not set up in the database yet: an admin runs supabase/migrations/20261029150000_meeting_people.sql in Supabase's SQL Editor.";
const RETRY = "That did not work just now. Please try again.";
const ONLY = "Only KIASA's admins, and a team's manager for their own team, can organize meetings.";
const missing = (code?: string) => code === "42P01" || code === "PGRST205";
// A column or table of the people file not there yet (or a meeting without a chat refused).
const unready = (code?: string) => missing(code) || code === "42703" || code === "PGRST204" || code === "23502";

/** Who may organize a meeting: one of KIASA's admins (anyone, any time), or a
 * top manager with a team (their team freely; anyone else with an admin's OK).
 * Checked here, not only on the page: an action can be called by anyone who finds it. */
type Organizer = { id: string; name: string; admin: boolean; team: string | null };
async function organizer(): Promise<Organizer | { error: string }> {
  if (!accountsLive) return { error: "Meetings open once accounts are connected." };
  const viewer = await currentViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (viewer.admin) return { id: viewer.id, name: viewer.admin.name, admin: true, team: null };
  if (viewer.member?.status !== "approved") return { error: ONLY };
  const site = siteClient();
  const [top, team] = await Promise.all([
    site.from("top_managers").select("user_id").eq("user_id", viewer.id).maybeSingle(),
    site.from("team_members").select("team_id").eq("user_id", viewer.id).maybeSingle(),
  ]);
  if (!top.data || !team.data) return { error: ONLY };
  return { id: viewer.id, name: viewer.member.name, admin: false, team: team.data.team_id as string };
}

/** A chat to hold a meeting from: a group or a one-to-one chat the organizer is in. */
async function chatFor(who: Organizer, chatId: string): Promise<{ error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(chatId)) return { error: RETRY };
  const site = siteClient();
  const [member, chat] = await Promise.all([
    site.from("chat_members").select("user_id").eq("chat_id", chatId).eq("user_id", who.id).maybeSingle(),
    site.from("chats").select("kind").eq("id", chatId).maybeSingle(),
  ]);
  if (!member.data || !chat.data) return { error: "You are not in that chat." };
  if (chat.data.kind !== "group" && chat.data.kind !== "direct") return { error: "Meetings are held in group chats and one-to-one chats." };
  return {};
}

/** Everyone the organizer may put in a meeting (of a chat: its people), each
 * marked if they are outside the manager's team and so need an admin's OK.
 * For an admin no one is outside. Simulated members never join calls. */
async function choices(who: Organizer, chatId?: string | null): Promise<MeetingChoice[]> {
  const site = siteClient();
  const [everyone, team, inChat] = await Promise.all([
    chatPeople(),
    who.team ? site.from("team_members").select("user_id").eq("team_id", who.team) : null,
    chatId ? site.from("chat_members").select("user_id").eq("chat_id", chatId) : null,
  ]);
  const mine = new Set(((team?.data ?? []) as { user_id: string }[]).map(row => row.user_id));
  const chatIds = inChat ? new Set(((inChat.data ?? []) as { user_id: string }[]).map(row => row.user_id)) : null;
  return everyone.filter(person => person.id !== who.id && !person.hours && (!chatIds || chatIds.has(person.id)))
    .map(person => ({ id: person.id, name: person.name, detail: person.detail, photo: person.photo, outside: !who.admin && (person.admin || !mine.has(person.id)) }));
}

/** For the box that makes a meeting: who can be in it, and who is chosen to
 * start with (of a chat, everyone in it). */
export async function meetingChoices(chatId?: string | null): Promise<{ people?: MeetingChoice[]; chosen?: string[]; manager?: boolean; error?: string }> {
  const who = await organizer();
  if ("error" in who) return who;
  if (chatId) {
    const chat = await chatFor(who, chatId);
    if (chat.error) return chat;
  }
  const people = await choices(who, chatId);
  return { people, chosen: chatId ? people.map(person => person.id) : [], manager: !who.admin };
}

const cleanTitle = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, 120);
const listed = (names: string[]) => names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** A meeting's card in a chat. A new card is a new message, so everyone in
 * the chat is told (their chat alerts, and the ringing on an open chat). */
async function postCard(chatId: string | null, body: string, card: Card | Ask) {
  if (chatId) await siteClient().from("messages").insert({ chat_id: chatId, kind: "notice", body, attachment: card });
}

/** A meeting's card to its people: once in its chat, or, for a meeting of
 * chosen people, in each one's own chat with KIASA. */
async function deliver(meeting: { chat_id: string | null }, body: string, card: Card, to: Person[]) {
  if (meeting.chat_id) return postCard(meeting.chat_id, body, card);
  await Promise.all(to.map(async person => postCard(await personalChat(person.id, person.name), body, card)));
}

/** Every card of a meeting, brought up to date (they change live on open pages). */
async function updateCards(meetingId: string, change: Partial<Card>, type: "meeting" | "meeting_request" = "meeting") {
  const site = siteClient();
  let asked = site.from("messages").select("id, attachment").eq("attachment->>type", type).eq("attachment->>id", meetingId);
  if (type === "meeting_request") asked = asked.eq("attachment->>status", "waiting");
  const { data: cards } = await asked;
  await Promise.all((cards ?? []).map(card => site.from("messages").update({ attachment: { ...(card.attachment as Card), ...change } }).eq("id", card.id)));
}

/** For the admins, in their requests chat: a manager asks to meet people outside their team. */
async function askAdmins(meeting: { id: string; title: string; starts_at: string }, by: string, people: string[]) {
  const chat = await contactsChat();
  await postCard(chat, `${by} asks to meet ${listed(people)}.`,
    { type: "meeting_request", id: meeting.id, title: meeting.title, starts_at: meeting.starts_at, by, people, status: "waiting" });
}

/** A line to someone in their own chat with KIASA. */
async function tell(person: Person, body: string) {
  const chat = await personalChat(person.id, person.name);
  if (chat) await siteClient().from("messages").insert({ chat_id: chat, kind: "notice", body });
}

/** A meeting, now (everyone in it is rung) or planned for later, for the
 * chosen people: from a chat (its card waits there) or from anywhere (each
 * gets the card in their own chat with KIASA). A manager's meeting with anyone
 * outside their team waits for an admin's OK, and no one else hears of it until then. */
export async function createMeeting(input: { chatId?: string | null; title: string; startsAt?: string | null; people: string[] }): Promise<{ id?: string; waiting?: boolean; error?: string }> {
  const who = await organizer();
  if ("error" in who) return who;
  const chatId = input.chatId || null;
  if (chatId) {
    const chat = await chatFor(who, chatId);
    if (chat.error) return chat;
  }
  const options = new Map((await choices(who, chatId)).map(person => [person.id, person]));
  const ids = [...new Set(input.people)].filter(id => options.has(id));
  if (!ids.length) return { error: "Please choose who is in the meeting." };
  const now = !input.startsAt;
  const when = now ? Date.now() : Date.parse(input.startsAt!);
  if (!Number.isFinite(when)) return { error: "Please choose a day and time." };
  if (!now && when < Date.now() - 5 * 60_000) return { error: "That time has passed. Please choose a later one." };
  if (when > Date.now() + 366 * 86400_000) return { error: "Please choose a time within a year." };
  const outside = ids.filter(id => options.get(id)!.outside);
  const waiting = outside.length > 0;
  const name = cleanTitle(input.title) || "Meeting";
  const at = new Date(when).toISOString();
  const site = siteClient();
  const { data, error } = await site.from("meetings").insert({
    chat_id: chatId, title: name, starts_at: at, started_at: now && !waiting ? at : null, created_by: who.id, ...(waiting ? { approval: "waiting" } : {}),
  }).select("id").single();
  if (error || !data) return { error: missing(error?.code) ? SETUP : unready(error?.code) ? PEOPLE_SETUP : RETRY };
  const id = data.id as string;
  const people = await site.from("meeting_people").insert([
    { meeting_id: id, user_id: who.id, name: who.name, status: "in" },
    ...ids.map(person => ({ meeting_id: id, user_id: person, name: options.get(person)!.name, status: outside.includes(person) ? "asked" : "in" })),
  ]);
  if (people.error) {
    await site.from("meetings").delete().eq("id", id);
    return { error: unready(people.error.code) ? PEOPLE_SETUP : RETRY };
  }
  const invited = ids.filter(person => !outside.includes(person));
  const card: Card = { type: "meeting", id, title: name, starts_at: at, status: waiting ? "waiting" : now ? "live" : "scheduled", by: who.name, by_id: who.id, people: [who.id, ...invited] };
  if (waiting) {
    const names = outside.map(person => options.get(person)!.name);
    await postCard(await personalChat(who.id, who.name), `⏳ Your meeting "${name}" waits for an admin's OK: ${listed(names)} ${names.length === 1 ? "is" : "are"} outside your team.`, card);
    await askAdmins({ id, title: name, starts_at: at }, who.name, names);
    return { id, waiting: true };
  }
  await deliver({ chat_id: chatId }, `${now ? "📹" : "📅"} ${who.name} ${now ? "started" : "scheduled"} a meeting: ${name}`, card,
    [who, ...invited.map(person => ({ id: person, name: options.get(person)!.name }))]);
  return { id };
}

type Row = { id: string; chat_id: string | null; title: string; starts_at: string; started_at: string | null; ended_at: string | null; created_by: string | null; approval: "waiting" | "allowed" | "refused" | null };

/** The meeting, and the person asking, if they may run it: an admin, or the
 * manager who called it. */
async function running(meetingId: string): Promise<{ meeting: Row; who: Organizer } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/.test(meetingId)) return { error: RETRY };
  const who = await organizer();
  if ("error" in who) return who;
  const { data: meeting, error } = await siteClient().from("meetings").select("id, chat_id, title, starts_at, started_at, ended_at, created_by, approval").eq("id", meetingId).maybeSingle();
  if (unready(error?.code)) return { error: PEOPLE_SETUP };
  if (!meeting) return { error: "That meeting is gone." };
  if (!who.admin && meeting.created_by !== who.id) return { error: "Only an admin, or the manager who called it, can run this meeting." };
  return { meeting: meeting as Row, who };
}

/** Who is in a meeting ('in'), and who waits for an admin's OK ('asked'). */
async function peopleOf(meetingId: string) {
  const { data } = await siteClient().from("meeting_people").select("user_id, name, status").eq("meeting_id", meetingId).order("added_at");
  return (data ?? []) as { user_id: string; name: string; status: "in" | "asked" }[];
}

/** Someone who runs a meeting starts a planned one: its card turns live, and
 * a new card rings everyone in it. */
export async function beginMeeting(meetingId: string): Promise<{ error?: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { meeting, who } = found;
  if (meeting.ended_at || meeting.approval === "refused") return { error: "That meeting is over." };
  if (meeting.approval === "waiting") return { error: "This meeting is waiting for an admin's OK." };
  if (meeting.started_at) return {};
  const now = new Date().toISOString();
  const { error } = await siteClient().from("meetings").update({ started_at: now }).eq("id", meetingId).is("started_at", null);
  if (error) return { error: RETRY };
  const people = (await peopleOf(meetingId)).filter(person => person.status === "in");
  await updateCards(meetingId, { status: "live" });
  await deliver(meeting, `📹 ${who.name} started the meeting: ${meeting.title}`, {
    type: "meeting", id: meetingId, title: meeting.title, starts_at: now, status: "live", by: who.name, by_id: who.id, people: people.map(person => person.user_id),
  }, people.filter(person => person.user_id !== who.id).map(person => ({ id: person.user_id, name: person.name })));
  return {};
}

/** Someone who runs a meeting ends it for everyone, or calls off a planned
 * one (a manager, also one still waiting for an admin's OK). */
export async function endMeeting(meetingId: string): Promise<{ error?: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { meeting, who } = found;
  if (meeting.ended_at) return {};
  const now = new Date().toISOString();
  const { error } = await siteClient().from("meetings").update({ ended_at: now }).eq("id", meetingId);
  if (error) return { error: RETRY };
  await updateCards(meetingId, { status: meeting.started_at ? "ended" : "cancelled", ended_at: now });
  await updateCards(meetingId, { status: "refused", decided_by: `${who.name}, who called it off` } as Partial<Card>, "meeting_request");
  return {};
}

/** Who is in a meeting, and whom else one could add: for those who run it. */
export async function meetingRoster(meetingId: string): Promise<MeetingRoster | { error: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { meeting, who } = found;
  const [people, options] = await Promise.all([peopleOf(meetingId), choices(who)]);
  const photos = new Map(options.map(person => [person.id, person.photo]));
  return {
    title: meeting.title, over: !!meeting.ended_at || meeting.approval === "refused", manager: !who.admin,
    people: people.map(person => ({ id: person.user_id, name: person.name, photo: photos.get(person.user_id) ?? null, waiting: person.status === "asked", organizer: person.user_id === meeting.created_by })),
    choices: options.filter(person => !people.some(entry => entry.user_id === person.id)),
  };
}

/** Someone who runs a meeting adds people to it or takes them out, before it
 * or while it is on. Those added get its card (ringing, if it is on); those
 * taken out lose it, and a call they are in drops them. A manager adding
 * anyone outside their team asks an admin first. */
export async function setMeetingPeople(meetingId: string, add: string[], remove: string[]): Promise<MeetingRoster | { error: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { meeting, who } = found;
  if (meeting.ended_at || meeting.approval === "refused") return { error: "That meeting is over." };
  const site = siteClient();
  const before = await peopleOf(meetingId);
  const out = [...new Set(remove)].filter(id => id !== meeting.created_by && before.some(person => person.user_id === id));
  if (out.length) {
    const { error } = await site.from("meeting_people").delete().eq("meeting_id", meetingId).in("user_id", out);
    if (error) return { error: RETRY };
    // Someone let in is let in no more: the browsers in the call let them go.
    await site.from("meeting_admissions").update({ status: "denied", decided_at: new Date().toISOString(), decided_by: who.name }).eq("meeting_id", meetingId).in("user_id", out);
    const theirs = await personalChats(out);
    // Their cards go, as a message deleted for everyone does (their open chat follows).
    if (theirs.length) await site.from("messages").update({ deleted_at: new Date().toISOString() }).in("chat_id", theirs)
      .eq("attachment->>type", "meeting").eq("attachment->>id", meetingId).is("deleted_at", null);
  }
  const options = new Map((await choices(who)).map(person => [person.id, person]));
  const added = [...new Set(add)].filter(id => options.has(id) && !before.some(person => person.user_id === id));
  if (added.length) {
    const asked = added.filter(id => options.get(id)!.outside);
    const { error } = await site.from("meeting_people").insert(added.map(id => ({ meeting_id: meetingId, user_id: id, name: options.get(id)!.name, status: asked.includes(id) ? "asked" : "in" })));
    if (error) return { error: RETRY };
    if (asked.length) await askAdmins(meeting, who.name, asked.map(id => options.get(id)!.name));
    const invited = added.filter(id => !asked.includes(id));
    if (invited.length && meeting.approval !== "waiting") await welcome(meeting, who.name, invited.map(id => ({ id, name: options.get(id)!.name })));
  }
  await updateCards(meetingId, { people: (await peopleOf(meetingId)).filter(person => person.status === "in").map(person => person.user_id) });
  return meetingRoster(meetingId);
}

/** People added to a meeting already called: its card, in their own chat with
 * KIASA (a live one rings). */
async function welcome(meeting: Row, by: string, people: Person[]) {
  const live = !!meeting.started_at;
  const all = (await peopleOf(meeting.id)).filter(person => person.status === "in").map(person => person.user_id);
  const card: Card = { type: "meeting", id: meeting.id, title: meeting.title, starts_at: meeting.started_at ?? meeting.starts_at, status: live ? "live" : "scheduled", by, by_id: meeting.created_by ?? undefined, people: all };
  await Promise.all(people.map(async person => postCard(await personalChat(person.id, person.name), `${live ? "📹" : "📅"} ${by} added you to a meeting: ${meeting.title}`, card)));
}

/** An admin allows a manager's meeting with people outside their team, or
 * refuses it. Allowed, everyone in it gets its card; refused, a meeting that
 * waited is off (and people asked for later stay out). The manager is told. */
export async function decideMeeting(meetingId: string, allow: boolean): Promise<{ error?: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { meeting, who } = found;
  if (!who.admin) return { error: "Only KIASA's admins decide this." };
  const site = siteClient();
  const people = await peopleOf(meetingId);
  const asked = people.filter(person => person.status === "asked");
  const caller = people.find(person => person.user_id === meeting.created_by);
  const decided = (status: "allowed" | "refused") => updateCards(meetingId, { status, decided_by: who.name } as Partial<Card>, "meeting_request");
  if (meeting.ended_at || meeting.approval === "refused") { await decided("refused"); return { error: "That meeting is over." }; }
  const names = listed(asked.map(person => person.name));
  if (!allow) {
    if (meeting.approval === "waiting") {
      const now = new Date().toISOString();
      await site.from("meetings").update({ approval: "refused", ended_at: now }).eq("id", meetingId);
      await updateCards(meetingId, { status: "refused", ended_at: now });
    } else if (asked.length) await site.from("meeting_people").delete().eq("meeting_id", meetingId).eq("status", "asked");
    await decided("refused");
    if (caller) await tell({ id: caller.user_id, name: caller.name }, meeting.approval === "waiting"
      ? `An admin did not allow your meeting "${meeting.title}" with ${names || "people outside your team"}.`
      : `An admin did not allow ${names} in your meeting "${meeting.title}".`);
    return {};
  }
  if (asked.length) {
    const { error } = await site.from("meeting_people").update({ status: "in" }).eq("meeting_id", meetingId).eq("status", "asked");
    if (error) return { error: RETRY };
  }
  const by = caller?.name ?? who.name;
  const everyone = people.map(person => person.user_id);
  if (meeting.approval === "waiting") {
    await site.from("meetings").update({ approval: "allowed" }).eq("id", meetingId);
    // The manager's own card turns planned; everyone else gets the card now.
    await updateCards(meetingId, { status: "scheduled", people: everyone });
    await deliver(meeting, `📅 ${by} scheduled a meeting: ${meeting.title}`, {
      type: "meeting", id: meetingId, title: meeting.title, starts_at: meeting.starts_at, status: "scheduled", by, by_id: meeting.created_by ?? undefined, people: everyone,
    }, people.filter(person => person.user_id !== meeting.created_by).map(person => ({ id: person.user_id, name: person.name })));
  } else {
    await updateCards(meetingId, { people: everyone });
    if (asked.length) await welcome(meeting, by, asked.map(person => ({ id: person.user_id, name: person.name })));
  }
  await decided("allowed");
  if (caller) await tell({ id: caller.user_id, name: caller.name }, meeting.approval === "waiting"
    ? `An admin allowed your meeting "${meeting.title}"${names ? ` with ${names}` : ""}. Start it from its card when it is time.`
    : `An admin allowed ${names} in your meeting "${meeting.title}".`);
  return {};
}

/** Someone invited asks to join a meeting: whoever runs it (an admin in it, or
 * the manager who called it) lets them in, or not. Someone already let in
 * stays in (they may leave and come back). */
export async function askToJoin(meetingId: string): Promise<{ status?: "waiting" | "admitted"; error?: string }> {
  if (!accountsLive) return { error: "Meetings open once accounts are connected." };
  if (!/^[0-9a-f-]{36}$/.test(meetingId)) return { error: RETRY };
  const viewer = await currentViewer();
  if (!viewer) return { error: "Please sign in again." };
  const site = siteClient();
  const { data: meeting } = await site.from("meetings").select("ended_at, created_by").eq("id", meetingId).maybeSingle();
  if (!meeting || meeting.ended_at) return { error: "That meeting is over." };
  if (viewer.admin || meeting.created_by === viewer.id) return { status: "admitted" };
  const { data: member } = await site.from("meeting_people").select("name").eq("meeting_id", meetingId).eq("user_id", viewer.id).eq("status", "in").maybeSingle();
  if (!member) return { error: "This meeting is for the people invited to it." };
  const { data: asked } = await site.from("meeting_admissions").select("status").eq("meeting_id", meetingId).eq("user_id", viewer.id).maybeSingle();
  if (asked?.status === "admitted") return { status: "admitted" };
  const { error } = await site.from("meeting_admissions").upsert({
    meeting_id: meetingId, user_id: viewer.id, name: member.name as string, status: "waiting", asked_at: new Date().toISOString(), decided_at: null, decided_by: null,
  }, { onConflict: "meeting_id,user_id" });
  if (error) return { error: missing(error.code)
    ? "Asking to join is not set up in the database yet: an admin runs supabase/migrations/20261027150000_meeting_admissions.sql in Supabase's SQL Editor." : RETRY };
  return { status: "waiting" };
}

/** Whoever runs a meeting lets someone in, or turns them away. */
export async function decideJoin(meetingId: string, userId: string, admit: boolean): Promise<{ error?: string }> {
  const found = await running(meetingId);
  if ("error" in found) return found;
  const { error } = await siteClient().from("meeting_admissions")
    .update({ status: admit ? "admitted" : "denied", decided_at: new Date().toISOString(), decided_by: found.who.name })
    .eq("meeting_id", meetingId).eq("user_id", userId);
  if (error) return { error: RETRY };
  return {};
}
