import "server-only";
import { cache } from "react";
import { publicSupabase, siteClient, visitorClient } from "@/lib/accounts/server";
import { photoUrl } from "@/lib/accounts/viewer";
import type { SimHours } from "./hours";

type SimRow = { user_id: string; active_from: string; active_to: string; days: number[]; pace_min: number; pace_max: number; paused: boolean; created_at: string };

/** Every simulated member's hours, by who they are; none before their file has been run. */
export const simRows = cache(async (): Promise<Map<string, SimRow>> => {
  const { data, error } = await siteClient().from("sim_members").select("user_id, active_from, active_to, days, pace_min, pace_max, paused, created_at");
  return new Map(error ? [] : (data as SimRow[]).map(row => [row.user_id, row]));
});

/** The team's time zone, which their hours follow. */
export const teamZone = cache(async (): Promise<string> => {
  const { data } = await siteClient().from("job_settings").select("timezone").eq("id", 1).maybeSingle();
  return (data?.timezone as string | null) ?? "UTC";
});

/** A simulated member's hours, as the pages use them. */
export const hoursOf = (row: SimRow, zone: string): SimHours =>
  ({ from: row.active_from.slice(0, 5), to: row.active_to.slice(0, 5), days: row.days, paused: row.paused, zone });

/** One simulated member, as the admin's page shows it. */
export type SimMember = {
  id: string; name: string; email: string; status: "waiting" | "approved" | "declined"; team: string | null; photo: string | null;
  hours: SimHours; paceMin: number; paceMax: number; created: string;
  /** Its day so far: its target (its plan at today's pace) and the applications made; null before the work file is run. */
  today: { target: number; done: number } | null;
};
/** Someone who may be named a tester: an approved real person. */
export type TesterChoice = { id: string; name: string; tester: boolean };

/** Everything the admin's page for simulated members shows. `setup`: its file has not been run yet. */
export type SimDesk = { setup: boolean; sims: SimMember[]; people: TesterChoice[]; zone: string; links: number | null };
export async function simDesk(): Promise<SimDesk> {
  const site = siteClient();
  const probe = await site.from("sim_members").select("user_id", { head: true, count: "exact" });
  if (probe.error) return { setup: true, sims: [], people: [], zone: "UTC", links: null };
  const [rows, zone, profiles, placed, avatars, testers, today] = await Promise.all([
    simRows(), teamZone(),
    site.from("profiles").select("id, name, email, status"),
    site.from("team_members").select("user_id, team_id"),
    site.from("avatars").select("user_id, path"),
    site.from("testers").select("user_id"),
    // As the admin, whose own rights the database checks.
    visitorClient().then(visitor => visitor.rpc("sims_today")),
  ]);
  const days = new Map(((today.error ? [] : today.data ?? []) as { user_id: string; target: number; done: number; links: number }[]).map(row => [row.user_id, row]));
  const teams = new Map(((placed.data ?? []) as { user_id: string; team_id: string }[]).map(row => [row.user_id, row.team_id]));
  const photos = new Map(((avatars.data ?? []) as { user_id: string; path: string }[]).map(row => [row.user_id, photoUrl(publicSupabase.url, row.path)]));
  const named = new Set(((testers.data ?? []) as { user_id: string }[]).map(row => row.user_id));
  const all = (profiles.data ?? []) as { id: string; name: string; email: string; status: SimMember["status"] }[];
  const sims = all.filter(person => rows.has(person.id)).map(person => {
    const row = rows.get(person.id)!;
    return {
      id: person.id, name: person.name, email: person.email, status: person.status, team: teams.get(person.id) ?? null, photo: photos.get(person.id) ?? null,
      hours: hoursOf(row, zone), paceMin: Number(row.pace_min), paceMax: Number(row.pace_max), created: row.created_at,
      today: days.has(person.id) ? { target: Number(days.get(person.id)!.target), done: Number(days.get(person.id)!.done) } : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const people = all.filter(person => !rows.has(person.id) && person.status === "approved")
    .map(person => ({ id: person.id, name: person.name, tester: named.has(person.id) })).sort((a, b) => a.name.localeCompare(b.name));
  return { setup: false, sims, people, zone, links: today.error ? null : Number(((today.data ?? []) as { links: number }[])[0]?.links ?? 0) };
}
