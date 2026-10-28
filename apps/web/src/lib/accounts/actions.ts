"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { reasons } from "@/content/accounts";
import { noticeDecision, noticeRequest } from "@/lib/chat/server";
import { TEAM_COLORS } from "@/lib/teams/colors";
import { alertPerson, isAlertAddress, pushReady } from "./push";
import { accountsLive, currentViewer, publicSupabase, siteClient, visitorClient } from "./server";
import { VIEWER_COOKIE, initialsOf, photoUrl, type ViewerBadge } from "./viewer";

/** What a form shows after it is sent: done, or what to fix. `preview` means
 * accounts are not connected yet, so nothing was sent. */
export type FormState = { done?: boolean; preview?: boolean; error?: string };

const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const RETRY = "That did not work just now. Please try again in a minute.";

async function setBadge(badge: ViewerBadge) {
  // Next encodes the value itself.
  (await cookies()).set(VIEWER_COOKIE, JSON.stringify(badge), {
    path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30,
  });
}

/** A request for an account, from the sign-up page. The person can sign in only
 * once one of KIASA's admins approves it. */
export async function requestAccount(_: FormState, form: FormData): Promise<FormState> {
  if (!accountsLive) return { done: true, preview: true };
  // A field people never see: only a robot fills it in. It is told nothing.
  if (text(form, "website", 200)) return { done: true };

  const first = text(form, "first", 80), last = text(form, "last", 80);
  const email = text(form, "email", 254).toLowerCase();
  const organization = text(form, "organization", 160);
  const reason = text(form, "reason", 80);
  const password = String(form.get("password") ?? "");
  if (!first || !last) return { error: "Please give your first and last name." };
  if (!EMAIL.test(email)) return { error: "Please give an email address we can reach you at." };
  if (password.length < 10 || password.length > 72) return { error: "Please choose a password of 10 to 72 characters." };
  if (!(reasons as readonly string[]).includes(reason)) return { error: "Please choose what brings you to KIASA." };
  if (form.get("terms") !== "on") return { error: "Please agree to the terms to send your request." };

  const site = siteClient();
  const name = `${first} ${last}`;
  const created = await site.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (created.error || !created.data.user) {
    const code = created.error?.code;
    if (code === "email_exists" || code === "user_already_exists") {
      return { error: "This email already has an account or a request. Sign in with it, or wait for the request to be approved." };
    }
    if (code === "weak_password") return { error: "Please choose a stronger password: longer, or less common." };
    return { error: RETRY };
  }
  const saved = await site.from("profiles").insert({
    id: created.data.user.id, email, name, organization: organization || null, reason, digest: form.get("digest") === "on",
  });
  if (saved.error) {
    // Without the request the sign-in would lead nowhere: undo it.
    await site.auth.admin.deleteUser(created.data.user.id);
    return { error: RETRY };
  }
  // The admins hear of it in their chat the moment the request is made.
  const requestId = created.data.user.id;
  after(() => noticeRequest({ id: requestId, name, email, organization: organization || null, reason }));
  // Signed in at once, so their request page knows them: it shows the request's
  // status from the database (a refresh cannot lose it) and changes the moment
  // a person at KIASA decides.
  await (await visitorClient()).auth.signInWithPassword({ email, password });
  await setBadge({ name, initials: initialsOf(name), href: "/account" });
  redirect("/account");
}

/** Signing in with email and password. Admins go to the admin page; everyone
 * else to their account, which shows a request still waiting, or declined, for
 * what it is. The first sign-in after approval is welcomed. */
export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  if (!accountsLive) return { preview: true };
  const email = text(form, "email", 254).toLowerCase();
  const password = String(form.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { error: "Please give your email and password." };

  const visitor = await visitorClient();
  const { data, error } = await visitor.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "That email and password do not match an account." };

  const site = siteClient();
  const [admin, profile, avatar, top, team] = await Promise.all([
    site.from("admins").select("name").eq("email", email).maybeSingle(),
    site.from("profiles").select("name, status, decided_at, last_sign_in_at").eq("id", data.user.id).maybeSingle(),
    site.from("avatars").select("path").eq("user_id", data.user.id).maybeSingle(),
    site.from("top_managers").select("user_id").eq("user_id", data.user.id).maybeSingle(),
    site.from("team_members").select("teams(name, color)").eq("user_id", data.user.id).maybeSingle(),
  ]);
  const inTeam = team.data?.teams as { name: string; color: string } | null | undefined;
  const photo = avatar.data ? photoUrl(publicSupabase.url, avatar.data.path as string) : undefined;
  if (admin.data) {
    const name = admin.data.name as string;
    await setBadge({ name, initials: initialsOf(name), href: "/admin", photo, mark: { kind: "owner" } });
    redirect("/admin");
  }
  if (!profile.data) {
    await visitor.auth.signOut({ scope: "local" });
    return { error: "That email and password do not match an account." };
  }
  const name = profile.data.name as string;
  await setBadge({
    name, initials: initialsOf(name), href: "/account", photo,
    mark: inTeam ? { kind: "team", name: inTeam.name, color: inTeam.color, lead: !!top.data } : top.data ? { kind: "top" } : undefined,
  });
  if (profile.data.status !== "approved") redirect("/account");
  const firstSinceApproval = !profile.data.last_sign_in_at || profile.data.last_sign_in_at < (profile.data.decided_at ?? "");
  await site.from("profiles").update({ last_sign_in_at: new Date().toISOString() }).eq("id", data.user.id);
  redirect(firstSinceApproval ? "/account?welcome=1" : "/account");
}

export async function signOut() {
  if (accountsLive) await (await visitorClient()).auth.signOut({ scope: "local" });
  (await cookies()).delete(VIEWER_COOKIE);
  redirect("/");
}

/** After someone sets or removes their photo (in their browser, straight to
 * Supabase), or an admin gives or takes away their top manager's badge: the
 * badge that names them on every page shows it too. Setting the cookie redraws
 * the page they are on. */
export async function refreshBadge(): Promise<void> {
  if (!accountsLive) return;
  const viewer = await currentViewer();
  const name = viewer?.admin?.name ?? viewer?.member?.name;
  if (!viewer || !name) return;
  await setBadge({
    name, initials: initialsOf(name), href: viewer.admin ? "/admin" : "/account", photo: viewer.photo ?? undefined,
    mark: viewer.mark ?? undefined,
  });
}

/** A person's photo files, when their account goes. */
async function forgetPhotos(id: string) {
  const files = siteClient().storage.from("avatars");
  const { data } = await files.list(id);
  if (data?.length) await files.remove(data.map(file => `${id}/${file.name}`));
}

/** An admin's decision on a request. Checked here, not only on the page: an
 * action can be called by anyone who finds it. */
export async function decide(id: string, status: "approved" | "declined"): Promise<{ error?: string }> {
  if (!accountsLive) return {};
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: "Only KIASA's admins can decide on requests." };
  if (status !== "approved" && status !== "declined") return { error: RETRY };
  const { error } = await siteClient().from("profiles")
    .update({ status, decided_at: new Date().toISOString(), decided_by: viewer.email })
    .eq("id", id);
  if (error) return { error: "That decision could not be saved. Please try again." };
  // Once the admin's page has its answer: the person's computer is told, the
  // request's card in the admins' chat is marked, and an approval is welcomed
  // in the person's own chat with KIASA.
  const by = viewer.admin.name;
  after(async () => {
    await alertPerson(id, status === "approved"
      ? { title: "Your KIASA account is approved", body: "A person at KIASA approved your request. Click to open your account.", url: "/account?welcome=1" }
      : { title: "About your KIASA request", body: "A person at KIASA has decided on your request. Click to see it.", url: "/account" });
    await noticeDecision(id, status, by);
  });
  refresh();
  return {};
}

/** An admin making an approved person a top manager, or a member again. Their
 * photo wears KIASA's leaf wherever it appears, from that moment, on every open
 * page. Admins wear theirs (and a crown) already. A new top manager in no team
 * is given one of their own, named for them ("Leon Team"), which they lead; a
 * top manager made a member again keeps the team, for the admin to hand on. */
export async function setTopManager(id: string, top: boolean): Promise<{ error?: string }> {
  if (!accountsLive) return {};
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: "Only KIASA's admins can name top managers." };
  const site = siteClient();
  const { data: person } = await site.from("profiles").select("email, name, status").eq("id", id).maybeSingle();
  if (!person) return { error: "That account is gone." };
  if (person.status !== "approved") return { error: "Only an approved person can be a top manager." };
  const { error } = top
    ? await site.from("top_managers").upsert({ user_id: id, granted_by: viewer.email }, { onConflict: "user_id", ignoreDuplicates: true })
    : await site.from("top_managers").delete().eq("user_id", id);
  if (error) return { error: error.code === "42P01" || error.code === "PGRST205"
    ? "Top managers are not set up in the database yet: an admin runs supabase/migrations/20261027090000_top_managers.sql in Supabase's SQL Editor."
    : "That could not be saved. Please try again." };
  if (top) {
    const made = await ownTeam(id, person.name as string | null, person.email as string, viewer.email);
    if (made.error) { refresh(); return made; }
  }
  refresh();
  return {};
}

/** A top manager's own team, if they are in none yet: "<first name> Team" (or,
 * if that is taken, with their whole name, then a number), in a colour no team
 * wears yet where one is left; they are put in it, so they lead it. */
async function ownTeam(id: string, name: string | null, email: string, by: string): Promise<{ error?: string }> {
  const site = siteClient();
  const [{ data: member }, { data: isAdmin }, { data: teams, error: missing }] = await Promise.all([
    site.from("team_members").select("team_id").eq("user_id", id).maybeSingle(),
    site.from("admins").select("email").eq("email", email).maybeSingle(),
    site.from("teams").select("name, color"),
  ]);
  // Admins stand above the teams; without the teams set up, there is nothing to make.
  if (member || isAdmin || missing) return {};
  const whole = (name ?? "").replace(/\s+/g, " ").trim() || email.split("@")[0];
  const first = whole.split(" ")[0];
  const taken = new Set((teams ?? []).map(team => String(team.name).toLowerCase()));
  const names = [`${first} Team`, `${whole} Team`, ...Array.from({ length: 20 }, (_, index) => `${first} Team ${index + 2}`)].map(entry => entry.slice(0, 40));
  const teamName = names.find(entry => !taken.has(entry.toLowerCase()));
  if (!teamName) return { error: "They are a top manager now, but a team could not be named for them: please make one on the Teams page." };
  const worn = new Set((teams ?? []).map(team => team.color));
  const color = (TEAM_COLORS.find(entry => !worn.has(entry.color)) ?? TEAM_COLORS[(teams ?? []).length % TEAM_COLORS.length]).color;
  const { data: team, error } = await site.from("teams").insert({ name: teamName, color }).select("id").single();
  if (error || !team) return { error: "They are a top manager now, but their team could not be made: please make one on the Teams page." };
  const { error: joined } = await site.from("team_members").upsert({ user_id: id, team_id: team.id, assigned_at: new Date().toISOString(), assigned_by: by }, { onConflict: "user_id" });
  if (joined) return { error: `They are a top manager now, and ${teamName} is made: please put them in it on the Teams page.` };
  return {};
}

/** Where to alert this person: the address their browser's alert service gave
 * this browser ("Alert me on this computer"). Only an address at one of those
 * services is kept, and only for the person signed in. */
export async function savePushSubscription(subscription: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }): Promise<{ error?: string }> {
  if (!accountsLive || !pushReady) return { error: "Alerts are not set up on this site yet." };
  const viewer = await currentViewer();
  if (!viewer?.member) return { error: "Please sign in again." };
  const endpoint = String(subscription?.endpoint ?? "").slice(0, 1000);
  const p256dh = String(subscription?.keys?.p256dh ?? "").slice(0, 200);
  const auth = String(subscription?.keys?.auth ?? "").slice(0, 100);
  if (!isAlertAddress(endpoint) || !p256dh || !auth) return { error: "This browser's alert address could not be used." };
  const { error } = await siteClient().from("push_subscriptions").upsert({ endpoint, user_id: viewer.id, p256dh, auth });
  if (error) return { error: RETRY };
  return {};
}

/** An admin deleting someone: their sign-in and their request go together. An
 * admin's own sign-in is never deleted here, so no one can lock KIASA out. */
export async function removeAccount(id: string): Promise<{ error?: string }> {
  if (!accountsLive) return {};
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: "Only KIASA's admins can delete accounts." };
  const site = siteClient();
  const { data: person } = await site.from("profiles").select("email").eq("id", id).maybeSingle();
  if (!person) return { error: "That account is already gone." };
  const { data: isAdmin } = await site.from("admins").select("email").eq("email", person.email as string).maybeSingle();
  if (isAdmin || id === viewer.id) return { error: "Admins' accounts cannot be deleted here." };
  const { error } = await site.auth.admin.deleteUser(id);
  if (error) return { error: "That account could not be deleted. Please try again." };
  const by = viewer.admin.name;
  after(() => Promise.all([noticeDecision(id, "deleted", by), forgetPhotos(id)]));
  refresh();
  return {};
}

/** A test alert, so a person can see that their computer will really tell
 * them, before anyone has decided anything. */
export async function sendTestAlert(): Promise<{ error?: string; delivered?: number }> {
  if (!accountsLive || !pushReady) return { error: "Alerts are not set up on this site yet." };
  const viewer = await currentViewer();
  if (!viewer?.member) return { error: "Please sign in again." };
  const delivered = await alertPerson(viewer.id, { title: "Alerts from KIASA are on", body: "This is how this computer will tell you when your request is decided.", url: "/account" });
  return delivered ? { delivered } : { error: "No alert could be sent to this browser. Please turn alerts on again." };
}

/** A person changing their own details, from the account page: their name (as
 * the team sees it, in the chat and on the leaderboard too), organization and
 * why they joined. The badge that names them on every page follows. */
export async function updateDetails(_: FormState, form: FormData): Promise<FormState> {
  if (!accountsLive) return { done: true, preview: true };
  const viewer = await currentViewer();
  if (!viewer?.member || viewer.member.status !== "approved") return { error: "Please sign in again." };
  const name = text(form, "name", 80).replace(/\s+/g, " ");
  const organization = text(form, "organization", 160);
  const reason = text(form, "reason", 80);
  if (name.length < 2) return { error: "Please give your name." };
  if (!(reasons as readonly string[]).includes(reason)) return { error: "Please choose what brings you to KIASA." };
  const site = siteClient();
  const { error } = await site.from("profiles").update({ name, organization: organization || null, reason }).eq("id", viewer.id);
  if (error) return { error: RETRY };
  // Their chats show the name each member had when they joined: it changes with them.
  if (name !== viewer.member.name) await site.from("chat_members").update({ name }).eq("user_id", viewer.id);
  await setBadge({ name, initials: initialsOf(name), href: "/account", photo: viewer.photo ?? undefined });
  refresh();
  return { done: true };
}

/** A person changing their password: their current one first, as anyone at
 * their computer might not be them, then the new one (10 to 72 characters). */
export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  if (!accountsLive) return { done: true, preview: true };
  const viewer = await currentViewer();
  if (!viewer) return { error: "Please sign in again." };
  const current = String(form.get("current") ?? ""), next = String(form.get("next") ?? ""), again = String(form.get("again") ?? "");
  if (next.length < 10 || next.length > 72) return { error: "Please choose a new password of 10 to 72 characters." };
  if (next !== again) return { error: "The new password and its repeat are not the same." };
  const visitor = await visitorClient();
  const checked = await visitor.auth.signInWithPassword({ email: viewer.email, password: current });
  if (checked.error) return { error: "That is not your current password." };
  const { error } = await visitor.auth.updateUser({ password: next });
  if (error?.code === "same_password") return { error: "The new password is your current one. Please choose another." };
  if (error?.code === "weak_password") return { error: "Please choose a stronger password: longer, or less common." };
  if (error) return { error: RETRY };
  return { done: true };
}

/** Turning the monthly research digest on or off, from the account page. */
export async function setDigest(on: boolean): Promise<{ error?: string }> {
  if (!accountsLive) return {};
  const viewer = await currentViewer();
  if (viewer?.member?.status !== "approved") return { error: "Please sign in again." };
  const { error } = await siteClient().from("profiles").update({ digest: on }).eq("id", viewer.id);
  if (error) return { error: RETRY };
  refresh();
  return {};
}

/** Deleting an account and everything in it: the sign-in and the request go together. */
export async function deleteAccount(): Promise<{ error?: string }> {
  if (!accountsLive) return {};
  const viewer = await currentViewer();
  if (!viewer?.member || viewer.admin) return { error: "Please sign in again." };
  const { error } = await siteClient().auth.admin.deleteUser(viewer.id);
  if (error) return { error: RETRY };
  const id = viewer.id;
  after(() => forgetPhotos(id));
  await (await visitorClient()).auth.signOut({ scope: "local" });
  (await cookies()).delete(VIEWER_COOKIE);
  redirect("/");
}
