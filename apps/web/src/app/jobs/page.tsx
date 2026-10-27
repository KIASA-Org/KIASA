import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LeafMark } from "@/components/site/brand";
import { YourPhoto } from "@/components/site/your-photo";
import { ChatWatch } from "@/components/chat/chat-watch";
import { JobsApp } from "@/components/jobs/jobs-app";
import { signOut } from "@/lib/accounts/actions";
import { accountsLive, publicSupabase, signedIn } from "@/lib/accounts/server";
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
  const [me, start, pending, asked] = await Promise.all([jobsViewer(), jobsStart(person.id), pendingReports().catch(() => 0), searchParams]);
  if (!me) redirect("/account");
  if (start.setup) return <JobsFrame me={me}>
    <div className="jobs-empty"><p>{me.admin ? SETUP : "KIASA Jobs is being set up. Please try again a little later."}</p></div>
  </JobsFrame>;
  return <JobsFrame me={me}>
    <JobsApp me={me} start={{ ...start, pending: me.admin ? pending : 0 } as JobsStart} realtime={publicSupabase} tab={typeof asked.tab === "string" ? asked.tab : null} />
  </JobsFrame>;
}

/** The jobs desk's frame: its own bar (the firm's leaf, a rule, "Jobs", who is
 * signed in, the way to the chat and to their account or the admin page). */
function JobsFrame({ me, children }: { me?: JobsMe; children: React.ReactNode }) {
  const home = me?.admin ? { href: "/admin", label: "Admin" } : { href: "/account", label: "Your account" };
  return <div className="site jobs-page">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="practice-header admin-header jobs-bar">
      <div className="admin-bar wrap wrap-wide">
        <Link href="/" className="practice-lockup" aria-label="KIASA home">
          <LeafMark className="practice-mark" weight={3.4} />
          <span className="practice-divider" aria-hidden="true" />
          <span className="practice-word">KIASA <span>Jobs</span></span>
        </Link>
        {me && <div className="admin-user">
          <YourPhoto person={{ id: me.id, name: me.name }} photo={me.photo} realtime={publicSupabase} className="account-initials"
            details="bar" role={me.admin ? "Admin" : "Team"}>
            <Link href="/chat">Chat</Link>
            <Link href={home.href}>{home.label}</Link>
          </YourPhoto>
          <Link href="/chat" className="account-button admin-exit">Chat</Link>
          <Link href={home.href} className="account-button admin-exit">{home.label}</Link>
          <form action={signOut}><button type="submit" className="account-button">Sign out</button></form>
        </div>}
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="jobs-main">{children}</main>
    {me && <ChatWatch me={me.id} realtime={publicSupabase} />}
  </div>;
}
