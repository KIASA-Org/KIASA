"use server";

import { after } from "next/server";
import { accountsLive, currentViewer, ranks, siteClient } from "@/lib/accounts/server";
import { chatViewer, noticeContact, noticeContactDecision } from "@/lib/chat/server";
import { reachOf } from "./rules";

const SETUP = "Requests to talk are not set up in the database yet: an admin runs supabase/migrations/20261027210000_team_chats.sql in Supabase's SQL Editor.";
const RETRY = "That did not work. Please try again.";
const missing = (code?: string) => code === "42P01" || code === "PGRST205";

/** How someone appears in chats: their approved name, or an admin's. */
async function nameOf(id: string): Promise<string | null> {
  const site = siteClient();
  const { data: person } = await site.from("profiles").select("name").eq("id", id).eq("status", "approved").maybeSingle();
  if (person) return person.name as string;
  const { data: admins } = await site.rpc("admin_users");
  return ((admins ?? []) as { id: string; name: string }[]).find(admin => admin.id === id)?.name ?? null;
}

/** Asking the admin to let one message someone outside one's team (or, for a
 * manager, another manager). The admins get a card in their "Contact
 * requests" chat, to approve or decline there. */
export async function askContact(otherId: string, reason: string): Promise<{ error?: string; already?: boolean }> {
  if (!accountsLive) return { error: RETRY };
  const me = await chatViewer();
  if (!me) return { error: "Please sign in again." };
  const tidy = reason.replace(/\s+/g, " ").trim().slice(0, 300);
  const [other, known] = await Promise.all([nameOf(otherId), ranks()]);
  if (!other || otherId === me.id) return { error: "You cannot message that person." };
  const site = siteClient();
  const { data: requests, error: unread } = await site.from("contact_requests").select("id, from_user, to_user, status, asked_at")
    .or(`and(from_user.eq.${me.id},to_user.eq.${otherId}),and(from_user.eq.${otherId},to_user.eq.${me.id})`);
  if (unread) return { error: missing(unread.code) ? SETUP : RETRY };
  const reach = reachOf(me.id, otherId, known, requests ?? []);
  if (reach === "free") return { already: true };
  if (reach === "waiting") return { error: `Your request to message ${other} is already with the admin.` };
  const { data: made, error } = await site.from("contact_requests").insert({ from_user: me.id, to_user: otherId, reason: tidy }).select("id").single();
  if (error || !made) return { error: error?.code === "23505" ? `A request about you and ${other} is already with the admin.` : RETRY };
  after(() => noticeContact({ id: made.id as string, from: { id: me.id, name: me.name }, to: { id: otherId, name: other }, reason: tidy }));
  return {};
}

/** The admin approving or declining a request to talk: from then on, the two
 * may (or still may not) message each other, and both are told. */
export async function decideContact(id: string, status: "approved" | "declined"): Promise<{ error?: string }> {
  if (!accountsLive) return { error: RETRY };
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: "Only KIASA's admins can decide on requests." };
  if (status !== "approved" && status !== "declined") return { error: RETRY };
  const site = siteClient();
  const { data: request, error } = await site.from("contact_requests")
    .update({ status, decided_at: new Date().toISOString(), decided_by: viewer.email })
    .eq("id", id).eq("status", "waiting").select("from_user, to_user").maybeSingle();
  if (error) return { error: missing(error.code) ? SETUP : RETRY };
  if (!request) return { error: "Another admin has decided on this request already." };
  const [from, to] = await Promise.all([nameOf(request.from_user as string), nameOf(request.to_user as string)]);
  const by = viewer.admin.name;
  after(() => noticeContactDecision({ id, from: { id: request.from_user as string, name: from ?? "Someone" }, to: { id: request.to_user as string, name: to ?? "someone" } }, status, by));
  return {};
}
