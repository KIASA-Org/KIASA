"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { after } from "next/server";
import { accountsLive, currentViewer, siteClient } from "@/lib/accounts/server";
import { dayIn } from "@/lib/jobs/server";
import { noticeDecision, noticeRequest } from "@/lib/chat/server";
import { freshNames, simEmail } from "./names";
import { simRows, teamZone } from "./server";

const SETUP = "Simulated members are not set up in the database yet: run supabase/migrations/20261028090000_simulated_members.sql in Supabase's SQL Editor.";
const RETRY = "That could not be saved. Please try again.";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
type Done = { error?: string; done?: string };

/** The admin asking, if they are one: checked here, as anyone can call an action. */
async function admin(): Promise<{ name: string; email: string } | { error: string }> {
  if (!accountsLive) return { error: "Accounts are not connected yet." };
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: "Only KIASA's admins manage simulated members." };
  return { name: viewer.admin.name, email: viewer.email };
}

/** Only ids of simulated members, never anyone real. */
async function onlySims(ids: string[]): Promise<string[]> {
  const rows = await simRows();
  return [...new Set(ids)].filter(id => rows.has(id));
}

/** New simulated members, each asking for an account as anyone does: its
 * request reaches the admins' chat, to approve there or on this page. */
export async function addSims(count: number): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const wanted = Math.floor(Number(count));
  if (!(wanted >= 1 && wanted <= 100)) return { error: "Add between 1 and 100 at a time." };
  const site = siteClient();
  const probe = await site.from("sim_members").select("user_id", { head: true, count: "exact" });
  if (probe.error) return { error: SETUP };
  const { data: profiles } = await site.from("profiles").select("name");
  const names = freshNames(wanted, ((profiles ?? []) as { name: string }[]).map(row => row.name));
  const made: { id: string; name: string; email: string }[] = [];
  for (const name of names) {
    const email = simEmail(name);
    // A password no one knows: a simulated member never signs in.
    const { data, error } = await site.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true, user_metadata: { name } });
    if (error || !data.user) continue;
    const id = data.user.id;
    const reason = "I am looking for a job";
    const [profile, sim] = await Promise.all([
      site.from("profiles").insert({ id, email, name, reason, status: "waiting" }),
      site.from("sim_members").insert({ user_id: id, created_by: who.email }),
    ]);
    if (profile.error || sim.error) { await site.auth.admin.deleteUser(id); continue; }
    made.push({ id, name, email });
  }
  if (!made.length) return { error: RETRY };
  after(async () => {
    for (const person of made) await noticeRequest({ ...person, organization: null, reason: "I am looking for a job" });
  });
  refresh();
  return { done: `${made.length} ${made.length === 1 ? "person asks" : "people ask"} for an account now.` };
}

/** Approving (or declining) simulated members' requests, as the Users page does: their cards in the chat say so. */
export async function decideSims(ids: string[], status: "approved" | "declined"): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  if (status !== "approved" && status !== "declined") return { error: RETRY };
  const sims = await onlySims(ids);
  if (!sims.length) return { error: "Choose someone first." };
  const { error } = await siteClient().from("profiles").update({ status, decided_at: new Date().toISOString(), decided_by: who.email }).in("id", sims);
  if (error) return { error: RETRY };
  after(async () => { for (const id of sims) await noticeDecision(id, status, who.name); });
  refresh();
  return { done: `${sims.length} ${status}.` };
}

/** Putting simulated members in a team (or, with null, in none). Only approved ones can be. */
export async function placeSims(ids: string[], teamId: string | null): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const site = siteClient();
  const sims = await onlySims(ids);
  const { data: approved } = await site.from("profiles").select("id").in("id", sims).eq("status", "approved");
  const placeable = ((approved ?? []) as { id: string }[]).map(row => row.id);
  if (!placeable.length) return { error: "Approve them first: only approved people can be in a team." };
  const { error } = teamId
    ? await site.from("team_members").upsert(placeable.map(id => ({ user_id: id, team_id: teamId, assigned_at: new Date().toISOString(), assigned_by: who.email })), { onConflict: "user_id" })
    : await site.from("team_members").delete().in("user_id", placeable);
  if (error) return { error: RETRY };
  refresh();
  return { done: teamId ? `${placeable.length} put in the team.` : `${placeable.length} taken out of their team.` };
}

/** Working hours, days, pace, and pausing, for one or many. Only what is given changes. */
export async function setSims(ids: string[], change: { from?: string; to?: string; days?: number[]; paceMin?: number; paceMax?: number; paused?: boolean }): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const sims = await onlySims(ids);
  if (!sims.length) return { error: "Choose someone first." };
  const row: Record<string, unknown> = {};
  if (change.from !== undefined || change.to !== undefined) {
    if (!TIME.test(change.from ?? "") || !TIME.test(change.to ?? "") || change.to! <= change.from!) return { error: "Give the hours as from–to, the end after the start (for example 09:00–17:00)." };
    row.active_from = change.from;
    row.active_to = change.to;
  }
  if (change.days !== undefined) {
    const days = [...new Set(change.days)].filter(day => Number.isInteger(day) && day >= 1 && day <= 7).sort();
    if (!days.length) return { error: "Choose at least one day." };
    row.days = days;
  }
  if (change.paceMin !== undefined || change.paceMax !== undefined) {
    const low = Number(change.paceMin), high = Number(change.paceMax);
    if (!(low >= 1 && high <= 2 && high >= low)) return { error: "The pace goes from 100% to 200%, the highest at least the lowest." };
    row.pace_min = Math.round(low * 100) / 100;
    row.pace_max = Math.round(high * 100) / 100;
  }
  if (change.paused !== undefined) row.paused = !!change.paused;
  if (!Object.keys(row).length) return {};
  const { error } = await siteClient().from("sim_members").update(row).in("user_id", sims);
  if (error) return { error: RETRY };
  refresh();
  return { done: `Saved for ${sims.length}.` };
}

/** A daily plan for one or many, from today on: so many applications a day,
 * which they go past at their pace. As the Plans page sets a member's. */
export async function planSims(ids: string[], applications: number): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const sims = await onlySims(ids);
  const count = Math.floor(Number(applications));
  if (!sims.length) return { error: "Choose someone first." };
  if (!(count >= 0 && count <= 1000)) return { error: "A daily plan is between 0 and 1,000 applications." };
  const today = dayIn(await teamZone());
  const { error } = await siteClient().from("plans").upsert(sims.map(id => ({ user_id: id, period: "day", starts_on: today, applications: count, updated_at: new Date().toISOString() })), { onConflict: "user_id,period,starts_on" });
  if (error) return { error: RETRY };
  refresh();
  return { done: `${count} applications a day, from today, for ${sims.length}.` };
}

/** A round of work now, for everyone at work, instead of waiting for the next (every five minutes). */
export async function workNow(): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const { data, error } = await siteClient().rpc("sims_work");
  if (error) return { error: error.code === "PGRST202" ? "Their work is not set up yet: run supabase/migrations/20261028120000_sims_work.sql in Supabase's SQL Editor." : RETRY };
  refresh();
  const made = Number(data ?? 0);
  return { done: made ? `${made} ${made === 1 ? "application" : "applications"} made, on today's links.` : "Nothing to do now: no one is behind, or there are no links left today." };
}

/** A new name, wherever it shows. */
export async function renameSim(id: string, name: string): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const [sim] = await onlySims([id]);
  const tidy = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!sim) return { error: RETRY };
  if (!tidy) return { error: "Please give a name." };
  const site = siteClient();
  const { error } = await site.from("profiles").update({ name: tidy }).eq("id", sim);
  if (error) return { error: RETRY };
  await site.auth.admin.updateUserById(sim, { user_metadata: { name: tidy } });
  refresh();
  return {};
}

/** A photo, made small in the admin's browser (a square WebP or JPEG); or, with no file, none. */
export async function setSimPhoto(id: string, form: FormData): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const [sim] = await onlySims([id]);
  if (!sim) return { error: RETRY };
  const site = siteClient();
  const { data: before } = await site.from("avatars").select("path").eq("user_id", sim).maybeSingle();
  const file = form.get("photo");
  if (file instanceof File && file.size) {
    if (file.size > 1048576 || !["image/webp", "image/jpeg", "image/png"].includes(file.type)) return { error: "That photo is too large." };
    const path = `${sim}/${randomUUID()}.${file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg"}`;
    // As bytes: the storage client sends these as they are, from the server.
    const up = await site.storage.from("avatars").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (up.error) { console.error("simulated member photo:", up.error.message); return { error: RETRY }; }
    const { error } = await site.from("avatars").upsert({ user_id: sim, path });
    if (error) { await site.storage.from("avatars").remove([path]); return { error: RETRY }; }
  } else {
    await site.from("avatars").delete().eq("user_id", sim);
  }
  if (before?.path) await site.storage.from("avatars").remove([before.path as string]);
  refresh();
  return {};
}

/** Simulated members gone for good: their accounts, photos, and everything they did. */
export async function deleteSims(ids: string[]): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const sims = await onlySims(ids);
  if (!sims.length) return { error: "Choose someone first." };
  const site = siteClient();
  const { data: photos } = await site.from("avatars").select("path").in("user_id", sims);
  const files = ((photos ?? []) as { path: string }[]).map(row => row.path);
  if (files.length) await site.storage.from("avatars").remove(files);
  let gone = 0;
  for (const id of sims) {
    await noticeDecision(id, "deleted", who.name).catch(() => {});
    if (!(await site.auth.admin.deleteUser(id)).error) gone++;
  }
  refresh();
  return { done: `${gone} deleted.` };
}

/** A real person named a tester (they see the simulated members, as an admin does), or no longer. */
export async function setTester(id: string, on: boolean): Promise<Done> {
  return setTesters([id], on);
}

/** Several real people named testers at once, or no longer: each one named, never anyone who joins later. */
export async function setTesters(ids: string[], on: boolean): Promise<Done> {
  const who = await admin();
  if ("error" in who) return who;
  const site = siteClient();
  const sims = await simRows();
  const real = [...new Set(ids)].filter(id => !sims.has(id));
  if (!real.length) return {};
  const { error } = on
    ? await site.from("testers").upsert(real.map(id => ({ user_id: id, added_by: who.email })), { onConflict: "user_id", ignoreDuplicates: true })
    : await site.from("testers").delete().in("user_id", real);
  if (error) return { error: RETRY };
  refresh();
  return ids.length > 1 ? { done: on ? `${real.length} testers now: they see the simulated members.` : "No testers now." } : {};
}
