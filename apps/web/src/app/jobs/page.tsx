import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppBar } from "@/components/site/app-bar";
import { RanksProvider } from "@/components/site/ranks";
import { ChatWatch } from "@/components/chat/chat-watch";
import { JobsApp } from "@/components/jobs/jobs-app";
import { accountsLive, publicSupabase, ranks, signedIn } from "@/lib/accounts/server";
import type { Ranks } from "@/lib/accounts/viewer";
import { jobsStart, jobsViewer, pendingReports } from "@/lib/jobs/server";
import type { JobsMe, JobsStart } from "@/lib/jobs/types";

export const metadata: Metadata = {
  title: { absolute: "KIASA Jobs" },
  description: "KIASA's job desk: the day's job links, each member's applications, interviews, plans and the team's leaderboard.",
  robots: { index: false, follow: false },
};
// Finding the titles of a day's links reads their pages: room for a batch.
export const maxDuration = 60;

const SETUP = "KIASA Jobs is not set up in the database yet. In Supabase's SQL Editor, run supabase/migrations/20261026235000_jobs.sql, then reload this page.";

/** KIASA Jobs: for approved members and KIASA's admins. Anyone else signed in
 * is sent to their account; anyone signed out, to sign in. `?tab=` opens a tab. */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!accountsLive) return <JobsFrame>
    <div className="jobs-empty"><p>KIASA Jobs opens once accounts are connected.</p></div>
  </JobsFrame>;
  const person = await signedIn();
  if (!person) redirect("/sign-in");
  // Who they are, and everything the page starts with, asked for together.
  const [me, start, pending, badges, asked] = await Promise.all([jobsViewer(), jobsStart(person.id), pendingReports().catch(() => 0), ranks(), searchParams]);
  if (!me) redirect("/account");
  if (start.setup) return <JobsFrame me={me} ranks={badges}>
    <div className="jobs-empty"><p>{me.admin ? SETUP : "KIASA Jobs is being set up. Please try again a little later."}</p></div>
  </JobsFrame>;
  return <JobsFrame me={me} ranks={badges}>
    <JobsApp me={me} start={{ ...start, pending: me.admin ? pending : 0 } as JobsStart} realtime={publicSupabase} tab={typeof asked.tab === "string" ? asked.tab : null} />
  </JobsFrame>;
}

/** The jobs desk's frame: its own bar (the firm's leaf, a rule, "Jobs", who is
 * signed in, the way to the chat and to their account or the admin page).
 * `ranks`: who wears a badge on their photo. */
function JobsFrame({ me, ranks, children }: { me?: JobsMe; ranks?: Ranks; children: React.ReactNode }) {
  return <RanksProvider initial={ranks ?? { owners: [], top: [] }} realtime={me ? publicSupabase : undefined} me={me?.id}>
    <div className="site jobs-page">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <div className="jobs-bar">
      <AppBar area="jobs" person={me ? { id: me.id, name: me.name, detail: me.admin ? "Admin" : "Team", admin: me.admin, photo: me.photo } : { name: "KIASA", detail: "", admin: false }}
        realtime={publicSupabase} live={!!me} />
    </div>
    <main id="main-content" tabIndex={-1} className="jobs-main">{children}</main>
    {me && <ChatWatch me={me.id} realtime={publicSupabase} />}
    </div>
  </RanksProvider>;
}
