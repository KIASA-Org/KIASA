import "server-only";
import { cache } from "react";
import { accountsLive, currentViewer, publicSupabase, siteClient, visitorClient } from "@/lib/accounts/server";
import { photoUrl } from "@/lib/accounts/viewer";
import { splitChatList, type ChatMember, type ChatPerson, type ChatRow, type ChatSummary, type ChatMe } from "./types";

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
  const [admins, approved, avatars, profiles, seen] = await Promise.all([
    site.rpc("admin_users"),
    site.from("profiles").select("id, name, organization, email").eq("status", "approved"),
    site.from("avatars").select("user_id, path"),
    site.from("chat_profiles").select("user_id, username, bio"),
    site.from("seen").select("user_id, at"),
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
    if (!people.has(someone.id)) people.set(someone.id, person(someone.id, someone.name, someone.organization ?? someone.email, false));
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

const REQUESTS = "Account requests";
const KIASA = "KIASA";

/** The admins' chat where account requests arrive, made on first use. Every
 * admin is in it, including any added since. */
async function requestsChat(): Promise<string | null> {
  const site = siteClient();
  const { data: admins } = await site.rpc("admin_users");
  const rows = (admins ?? []) as { id: string; name: string }[];
  if (!rows.length) return null;
  let id = (await site.from("chats").select("id").eq("kind", "notices").eq("title", REQUESTS).limit(1).maybeSingle()).data?.id as string | undefined;
  if (!id) id = (await site.from("chats").insert({ kind: "notices", title: REQUESTS }).select("id").single()).data?.id as string | undefined;
  // Two requests at the same moment: the database lets only one chat be made; use it.
  if (!id) id = (await site.from("chats").select("id").eq("kind", "notices").eq("title", REQUESTS).limit(1).maybeSingle()).data?.id as string | undefined;
  if (!id) return null;
  await site.from("chat_members").upsert(rows.map(admin => ({ chat_id: id, user_id: admin.id, name: admin.name, role: "member" })), { onConflict: "chat_id,user_id", ignoreDuplicates: true });
  return id;
}

/** A person's own chat with KIASA, where their account notices arrive. */
async function personalChat(personId: string, name: string): Promise<string | null> {
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
  const { data: person } = await site.from("profiles").select("name").eq("id", personId).maybeSingle();
  if (!person) return;
  const own = await personalChat(personId, person.name as string);
  if (own) await site.from("messages").insert({ chat_id: own, kind: "notice", body: `Your KIASA account is approved, ${String(person.name).split(" ")[0]}. Welcome: your team is a message away.` });
}
