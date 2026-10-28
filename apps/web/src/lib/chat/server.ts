import "server-only";
import { cache } from "react";
import { accountsLive, currentViewer, hiddenFromViewer, publicSupabase, siteClient, visitorClient } from "@/lib/accounts/server";
import { hoursOf, simRows, teamZone } from "@/lib/sims/server";
import { photoUrl } from "@/lib/accounts/viewer";
import { splitChatList, type ChatMember, type ChatPerson, type ChatRow, type ChatSummary, type ChatMe, type ContactRequest, type GroupEntry } from "./types";

/** Who may chat: an approved person, or one of KIASA's admins. */
export const chatViewer = cache(async (): Promise<ChatMe | null> => {
  if (!accountsLive) return null;
  const viewer = await currentViewer();
  if (!viewer) return null;
  const { id, email, photo } = viewer;
  if (viewer.admin) return { id, name: viewer.admin.name, email, admin: true, photo };
  if (viewer.member?.status === "approved") return { id, name: viewer.member.name, email, admin: false, photo };
  return null;
});

/** Everyone who may chat, to start a chat or make a group with: KIASA's
 * admins and the approved people, with their photos, usernames and bios, and
 * when they were last here. */
export async function chatPeople(): Promise<ChatPerson[]> {
  const site = siteClient();
  const [admins, approved, avatars, profiles, seen, hidden, sims, zone] = await Promise.all([
    site.rpc("admin_users"),
    site.from("profiles").select("id, name, organization, email").eq("status", "approved"),
    site.from("avatars").select("user_id, path"),
    site.from("chat_profiles").select("user_id, username, bio"),
    site.from("seen").select("user_id, at"),
    hiddenFromViewer(), simRows(), teamZone(),
  ]);
  const photos = new Map(((avatars.data ?? []) as { user_id: string; path: string }[]).map(row => [row.user_id, photoUrl(publicSupabase.url, row.path)]));
  const extras = new Map(((profiles.data ?? []) as { user_id: string; username: string | null; bio: string }[]).map(row => [row.user_id, row]));
  const lastHere = new Map(((seen.data ?? []) as { user_id: string; at: string }[]).map(row => [row.user_id, row.at]));
  const person = (id: string, name: string, detail: string, admin: boolean): ChatPerson => ({
    id, name, detail, admin, photo: photos.get(id) ?? null,
    username: extras.get(id)?.username ?? null, bio: extras.get(id)?.bio ?? "", seen: lastHere.get(id) ?? null,
  });
  const people = new Map<string, ChatPerson>();
  for (const admin of (admins.data ?? []) as { id: string; email: string; name: string }[]) {
    people.set(admin.id, person(admin.id, admin.name, "KIASA admin", true));
  }
  for (const someone of (approved.data ?? []) as { id: string; name: string; organization: string | null; email: string }[]) {
    if (people.has(someone.id) || hidden.has(someone.id)) continue;
    const sim = sims.get(someone.id);
    // A simulated member is shown as any member (by its organization, never its address).
    people.set(someone.id, sim ? { ...person(someone.id, someone.name, someone.organization ?? "KIASA team", false), hours: hoursOf(sim, zone) }
      : person(someone.id, someone.name, someone.organization ?? "KIASA team", false));
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The signed-in person's chats, as the database's rules let them see them:
 * each with its last message, unread count, who is in it and their own view
 * of it, in one answer. `setup` says what the database still needs: the chat
 * files themselves ("missing"), or the latest of them ("outdated"). */
export async function myChats(): Promise<{ setup: "missing" | "outdated" | null; chats: ChatSummary[]; members: ChatMember[] }> {
  const visitor = await visitorClient();
  const { data, error } = await visitor.rpc("inbox");
  if (error?.code === "PGRST202") {
    const older = await visitor.rpc("chat_list");
    return { setup: older.error?.code === "PGRST202" ? "missing" : "outdated", chats: [], members: [] };
  }
  return { setup: null, ...splitChatList(data as ChatRow[] | null) };
}

/** The requests to talk this person made or was asked about, as the
 * database's rules let them see them (an admin: everyone's). */
export async function myRequests(): Promise<ContactRequest[]> {
  const { data, error } = await (await visitorClient()).from("contact_requests")
    .select("id, from_user, to_user, status, asked_at").order("asked_at", { ascending: false }).limit(500);
  return error ? [] : (data as ContactRequest[]);
}

/** For an admin: every group and one-to-one chat they are not in, to read
 * unseen (the others get nothing). */
export async function chatsToWatch(): Promise<{ chats: ChatSummary[]; members: ChatMember[] } | null> {
  const viewer = await currentViewer();
  if (!viewer?.admin) return null;
  const { data, error } = await (await visitorClient()).rpc("all_chats");
  return error ? null : splitChatList(data as ChatRow[] | null);
}

/** Every group, by name, photo, team and size, as everyone who may chat sees them. */
export async function groupDirectory(): Promise<GroupEntry[]> {
  const { data, error } = await (await visitorClient()).rpc("group_directory");
  return error ? [] : (data as GroupEntry[]);
}

const REQUESTS = "Account requests";
const CONTACTS = "Contact requests";
const KIASA = "KIASA";

/** One of the admins' chats where requests arrive (account requests, or
 * requests to talk), made on first use. Every admin is in it, including any
 * added since. */
async function requestsChat(title = REQUESTS): Promise<string | null> {
  const site = siteClient();
  const { data: admins } = await site.rpc("admin_users");
  const rows = (admins ?? []) as { id: string; name: string }[];
  if (!rows.length) return null;
  let id = (await site.from("chats").select("id").eq("kind", "notices").eq("title", title).limit(1).maybeSingle()).data?.id as string | undefined;
  if (!id) id = (await site.from("chats").insert({ kind: "notices", title }).select("id").single()).data?.id as string | undefined;
  // Two requests at the same moment: the database lets only one chat be made; use it.
  if (!id) id = (await site.from("chats").select("id").eq("kind", "notices").eq("title", title).limit(1).maybeSingle()).data?.id as string | undefined;
  if (!id) return null;
  await site.from("chat_members").upsert(rows.map(admin => ({ chat_id: id, user_id: admin.id, name: admin.name, role: "member" })), { onConflict: "chat_id,user_id", ignoreDuplicates: true });
  return id;
}

/** The admins' chat for requests to talk, and to meet people outside one's team. */
export const contactsChat = () => requestsChat(CONTACTS);

/** The own chats with KIASA of these people (those who have one). */
export async function personalChats(personIds: string[]): Promise<string[]> {
  if (!personIds.length) return [];
  const { data } = await siteClient().from("chat_members").select("chat_id, chats!inner(kind, title)")
    .in("user_id", personIds).eq("chats.kind", "notices").eq("chats.title", KIASA);
  return [...new Set((data ?? []).map(row => row.chat_id as string))];
}

/** A person's own chat with KIASA, where their account notices arrive. */
export async function personalChat(personId: string, name: string): Promise<string | null> {
  const site = siteClient();
  const { data: found } = await site.from("chat_members").select("chat_id, chats!inner(kind, title)")
    .eq("user_id", personId).eq("chats.kind", "notices").eq("chats.title", KIASA).limit(1);
  if (found?.length) return found[0].chat_id as string;
  const made = await site.from("chats").insert({ kind: "notices", title: KIASA }).select("id").single();
  const id = made.data?.id as string | undefined;
  if (!id) return null;
  await site.from("chat_members").insert({ chat_id: id, user_id: personId, name, role: "member" });
  return id;
}

/** A request to talk, the moment it is made, in the admins' chat for them: a
 * card with who asks to message whom, and why, to approve or decline there. */
export async function noticeContact(request: { id: string; from: { id: string; name: string }; to: { id: string; name: string }; reason: string }) {
  const chat = await requestsChat(CONTACTS);
  if (!chat) return;
  await siteClient().from("messages").insert({
    chat_id: chat, kind: "notice", body: `${request.from.name} asks to message ${request.to.name}.`,
    attachment: { type: "contact", ...request, status: "waiting" },
  });
}

/** A request to talk decided: marked on its card; the one who asked is told
 * in their own chat with KIASA, and, once approved, so is the other person. */
export async function noticeContactDecision(request: { id: string; from: { id: string; name: string }; to: { id: string; name: string } }, status: "approved" | "declined", by: string) {
  const site = siteClient();
  const chat = await requestsChat(CONTACTS);
  if (chat) {
    const { data: cards } = await site.from("messages").select("id, attachment").eq("chat_id", chat).eq("attachment->>id", request.id);
    for (const card of cards ?? []) {
      await site.from("messages").update({ attachment: { ...(card.attachment as object), status, decided_by: by } }).eq("id", card.id);
    }
  }
  const asker = await personalChat(request.from.id, request.from.name);
  if (asker) await site.from("messages").insert({ chat_id: asker, kind: "notice", body: status === "approved"
    ? `You can message ${request.to.name} now: the admin approved your request.`
    : `The admin declined your request to message ${request.to.name}.` });
  if (status !== "approved") return;
  const asked = await personalChat(request.to.id, request.to.name);
  if (asked) await site.from("messages").insert({ chat_id: asked, kind: "notice", body: `You and ${request.from.name} can message each other now.` });
}

/** A new account request, the moment it arrives, in the admins' chat: a card
 * with who it is, which admins can approve or decline right there. */
export async function noticeRequest(person: { id: string; name: string; email: string; organization?: string | null; reason: string }) {
  const chat = await requestsChat();
  if (!chat) return;
  await siteClient().from("messages").insert({
    chat_id: chat, kind: "notice", body: `New account request from ${person.name}.`,
    attachment: { type: "request", id: person.id, name: person.name, email: person.email, organization: person.organization ?? null, reason: person.reason, status: "waiting" },
  });
}

/** A decision, or a deletion: marked on the request's card, and, once
 * approved, a welcome in the person's own chat with KIASA. */
export async function noticeDecision(personId: string, status: "approved" | "declined" | "deleted", by: string) {
  const site = siteClient();
  const chat = await requestsChat();
  if (chat) {
    const { data: cards } = await site.from("messages").select("id, attachment").eq("chat_id", chat).eq("attachment->>id", personId);
    for (const card of cards ?? []) {
      await site.from("messages").update({ attachment: { ...(card.attachment as object), status, decided_by: by } }).eq("id", card.id);
    }
  }
  if (status !== "approved") return;
  if ((await simRows()).has(personId)) return;
  const { data: person } = await site.from("profiles").select("name").eq("id", personId).maybeSingle();
  if (!person) return;
  const own = await personalChat(personId, person.name as string);
  if (own) await site.from("messages").insert({ chat_id: own, kind: "notice", body: `Your KIASA account is approved, ${String(person.name).split(" ")[0]}. Welcome: your team is a message away.` });
}
