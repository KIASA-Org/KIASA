import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatWatch } from "@/components/chat/chat-watch";
import { InterviewApp } from "@/components/interview/interview-app";
import { AppBar } from "@/components/site/app-bar";
import { RanksProvider } from "@/components/site/ranks";
import { accountsLive, publicSupabase, ranks, signedIn } from "@/lib/accounts/server";
import { jobsViewer } from "@/lib/jobs/server";

export const metadata: Metadata = {
  title: { absolute: "KIASA Interview" },
  description: "KIASA's live script: what this PC plays, as text, as it is spoken.",
  robots: { index: false, follow: false },
};

/** The Interview area: for approved members and KIASA's admins, as the Job desk is. */
export default async function InterviewPage() {
  if (!accountsLive) redirect("/");
  const person = await signedIn();
  if (!person) redirect("/sign-in");
  const [me, badges] = await Promise.all([jobsViewer(), ranks()]);
  if (!me) redirect("/account");
  return <RanksProvider initial={badges} realtime={publicSupabase} me={me.id}>
    <div className="site jobs-page">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="jobs-bar">
        <AppBar area="interview" person={{ id: me.id, name: me.name, detail: me.admin ? "Admin" : "Team", admin: me.admin, photo: me.photo }} realtime={publicSupabase} />
      </div>
      <main id="main-content" tabIndex={-1} className="jobs-main"><InterviewApp /></main>
      <ChatWatch me={me.id} realtime={publicSupabase} />
    </div>
  </RanksProvider>;
}
