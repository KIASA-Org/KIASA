import "server-only";
import { cache } from "react";
import { currentViewer, hiddenFromViewer, publicSupabase, siteClient, visitorClient } from "@/lib/accounts/server";
import { photoUrl } from "@/lib/accounts/viewer";
import type { BoardRow, Job, JobSettings, JobsMe, JobsStart, Plan, Resume, TeamPerson } from "./types";

/** Who is looking, if they are on the team: an approved member, or an admin. */
export const jobsViewer = cache(async (): Promise<JobsMe | null> => {
  const viewer = await currentViewer();
  if (!viewer) return null;
  const member = viewer.member?.status === "approved";
  if (!viewer.admin && !member) return null;
  return { id: viewer.id, name: viewer.admin?.name ?? viewer.member?.name ?? viewer.email, admin: !!viewer.admin, member, photo: viewer.photo };
});

/** The team: every approved member, with who they are and their photo. */
export async function jobsTeam(): Promise<TeamPerson[]> {
  const site = siteClient();
  const [approved, avatars, hidden] = await Promise.all([
    site.from("profiles").select("id, name, organization").eq("status", "approved").order("name"),
    site.from("avatars").select("user_id, path"),
    hiddenFromViewer(),
  ]);
  const photos = new Map(((avatars.data ?? []) as { user_id: string; path: string }[]).map(row => [row.user_id, photoUrl(publicSupabase.url, row.path)]));
  return ((approved.data ?? []) as { id: string; name: string; organization: string | null }[])
    .filter(person => !hidden.has(person.id))
    .map(person => ({ id: person.id, name: person.name, detail: person.organization ?? "KIASA team", photo: photos.get(person.id) ?? null }));
}

/** The date it is now in a time zone, as YYYY-MM-DD. */
export const dayIn = (zone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

// The team's time zone and currency change rarely: kept here a minute, so the
// day's jobs can be asked for at once, with everything else.
let known: { settings: JobSettings; until: number } | null = null;

/** Everything the page starts with, asked for together (in one trip once the
 * team's time zone is known), as the person signed in (so the database's rules
 * decide what they see). `setup`: the database has not been given the jobs file yet. */
export async function jobsStart(userId: string): Promise<{ setup: boolean } & Partial<Omit<JobsStart, "pending">>> {
  const visitor = await visitorClient();
  const remembered = known && known.until > Date.now() ? known.settings : null;
  const asked = remembered ? null : visitor.from("job_settings").select("timezone, currency").eq("id", 1).maybeSingle();
  const dayOf = (settings: JobSettings) => dayIn(settings.timezone ?? "UTC");
  // (A query starts when it is awaited or then'd: this one is started now, to run beside the rest.)
  const early = remembered ? visitor.rpc("jobs_on", { on_day: dayOf(remembered) }).then(result => result) : null;
  const [read, board, resumes, plans, team] = await Promise.all([
    asked,
    visitor.rpc("team_board"),
    visitor.from("resumes").select("*").eq("user_id", userId).order("created_at"),
    visitor.from("plans").select("*").limit(5000),
    jobsTeam(),
  ]);
  if (read?.error) return { setup: true };
  const settings: JobSettings = remembered ?? { timezone: (read?.data?.timezone as string | null) ?? null, currency: (read?.data?.currency as string) ?? "USD" };
  if (read?.data) known = { settings, until: Date.now() + 60_000 };
  const today = dayOf(settings);
  const jobs = await (early ?? visitor.rpc("jobs_on", { on_day: today }));
  if (jobs.error?.code === "PGRST202") return { setup: true };
  return {
    setup: false, settings, today,
    jobs: (jobs.data ?? []) as Job[],
    board: (board.data ?? []) as BoardRow[],
    resumes: (resumes.data ?? []) as Resume[],
    plans: (plans.data ?? []) as Plan[],
    team,
  };
}

/** Reports waiting for an admin to confirm (for admins only: the page asks it beside the rest). */
export async function pendingReports(): Promise<number> {
  const site = siteClient();
  const [positions, payments] = await Promise.all([
    site.from("positions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    site.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return (positions.count ?? 0) + (payments.count ?? 0);
}
