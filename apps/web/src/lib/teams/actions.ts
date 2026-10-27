"use server";

import { refresh } from "next/cache";
import { accountsLive, currentViewer, siteClient } from "@/lib/accounts/server";
import { TEAM_COLORS } from "./colors";

const SETUP = "Teams are not set up in the database yet: an admin runs supabase/migrations/20261027180000_teams.sql in Supabase's SQL Editor.";
const RETRY = "That could not be saved. Please try again.";
const missing = (code?: string) => code === "42P01" || code === "PGRST205";

/** The admin asking, if they are one. Checked here, not only on the page: an
 * action can be called by anyone who finds it. */
async function admin(): Promise<{ name: string; email: string } | { error: string }> {
  if (!accountsLive) return { error: "Teams open once accounts are connected." };
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: "Only KIASA's admins can manage teams." };
  return { name: viewer.admin.name, email: viewer.email };
}

/** A team's name and colour, tidied and checked. */
function details(name: string, color: string): { name: string; color: string } | { error: string } {
  const tidy = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!tidy) return { error: "Please give the team a name." };
  if (!TEAM_COLORS.some(entry => entry.color === color)) return { error: "Please choose one of the colours." };
  return { name: tidy, color };
}

export async function createTeam(name: string, color: string): Promise<{ error?: string }> {
  const who = await admin();
  if ("error" in who) return who;
  const team = details(name, color);
  if ("error" in team) return team;
  const { error } = await siteClient().from("teams").insert(team);
  if (error) return { error: missing(error.code) ? SETUP : error.code === "23505" ? "There is already a team with that name." : RETRY };
  refresh();
  return {};
}

export async function updateTeam(id: string, name: string, color: string): Promise<{ error?: string }> {
  const who = await admin();
  if ("error" in who) return who;
  const team = details(name, color);
  if ("error" in team) return team;
  const { error } = await siteClient().from("teams").update(team).eq("id", id);
  if (error) return { error: error.code === "23505" ? "There is already a team with that name." : RETRY };
  refresh();
  return {};
}

/** A team goes; its people are in no team, and wear no shield, until put in another. */
export async function deleteTeam(id: string): Promise<{ error?: string }> {
  const who = await admin();
  if ("error" in who) return who;
  const { error } = await siteClient().from("teams").delete().eq("id", id);
  if (error) return { error: RETRY };
  refresh();
  return {};
}

/** Someone approved put in a team (or, with null, in none). A top manager put
 * in a team leads it, and wears its shield with a gold rim. */
export async function setTeam(userId: string, teamId: string | null): Promise<{ error?: string }> {
  const who = await admin();
  if ("error" in who) return who;
  const site = siteClient();
  const { data: person } = await site.from("profiles").select("email, status").eq("id", userId).maybeSingle();
  if (!person) return { error: "That account is gone." };
  if (person.status !== "approved") return { error: "Only an approved person can be in a team." };
  const { data: isAdmin } = await site.from("admins").select("email").eq("email", person.email as string).maybeSingle();
  if (isAdmin) return { error: "KIASA's admins stand above the teams, in none of them." };
  const { error } = teamId
    ? await site.from("team_members").upsert({ user_id: userId, team_id: teamId, assigned_at: new Date().toISOString(), assigned_by: who.email }, { onConflict: "user_id" })
    : await site.from("team_members").delete().eq("user_id", userId);
  if (error) return { error: missing(error.code) ? SETUP : RETRY };
  refresh();
  return {};
}
