import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatWatch } from "@/components/chat/chat-watch";
import { ApplyBrowsers } from "@/components/apply/apply-browsers";
import { ApplyDetails } from "@/components/apply/apply-details";
import { ApplySetup } from "@/components/apply/apply-setup";
import { ApplyWork } from "@/components/apply/apply-work";
import { AppBar } from "@/components/site/app-bar";
import { RanksProvider } from "@/components/site/ranks";
import { accountsLive, publicSupabase, ranks, signedIn } from "@/lib/accounts/server";
import { jobsViewer } from "@/lib/jobs/server";

export const metadata: Metadata = {
  title: { absolute: "KIASA Auto apply" },
  description: "Set up the KIASA browser on this PC for automatic job applying.",
  robots: { index: false, follow: false },
};

/** The Auto apply area: for approved members and KIASA's admins, as the Job desk is. */
export default async function ApplyPage() {
  if (!accountsLive) redirect("/");
  const person = await signedIn();
  if (!person) redirect("/sign-in");
  const [me, badges] = await Promise.all([jobsViewer(), ranks()]);
  if (!me) redirect("/account");
  return <RanksProvider initial={badges} realtime={publicSupabase} me={me.id}>
    <div className="site jobs-page">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="jobs-bar">
        <AppBar area="apply" person={{ id: me.id, name: me.name, detail: me.admin ? "Admin" : "Team", admin: me.admin, photo: me.photo }} realtime={publicSupabase} />
      </div>
      <main id="main-content" tabIndex={-1} className="jobs-main"><ApplySetup />
        <ApplyDetails realtime={publicSupabase} me={me.id} />
        <ApplyBrowsers realtime={publicSupabase} admin={me.admin} me={me.id} />
        <ApplyWork realtime={publicSupabase} me={me.id} admin={me.admin} />
      </main>
      <ChatWatch me={me.id} realtime={publicSupabase} />
    </div>
  </RanksProvider>;
}
