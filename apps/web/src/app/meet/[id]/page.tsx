import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MeetingRoom } from "@/components/meet/meeting-room";
import { RanksProvider } from "@/components/site/ranks";
import { accountsLive, publicSupabase, ranks, signedIn } from "@/lib/accounts/server";
import { chatViewer } from "@/lib/chat/server";
import { meetingFor } from "@/lib/meetings/server";

export const metadata: Metadata = {
  title: { absolute: "KIASA Meeting" },
  description: "A KIASA team meeting.",
  robots: { index: false, follow: false },
};

/** A KIASA meeting, in its own window: for the people invited to it (the
 * database's rules decide). Anyone else signed in is told it is not theirs;
 * anyone signed out is sent to sign in. */
export default async function MeetPage({ params }: { params: Promise<{ id: string }> }) {
  if (!accountsLive) return <Outside text="Meetings open once accounts are connected." />;
  if (!(await signedIn())) redirect("/sign-in");
  const [{ id }, me, badges] = await Promise.all([params, chatViewer(), ranks()]);
  if (!me) redirect("/sign-in");
  const start = await meetingFor(id, me);
  if (!start) return <Outside text="This meeting is not one you are in, or it is gone. Meetings are for the people invited to them." />;
  return <RanksProvider initial={badges} realtime={publicSupabase} me={me.id}>
    <MeetingRoom start={start} realtime={publicSupabase} />
  </RanksProvider>;
}

function Outside({ text }: { text: string }) {
  return <div className="meet meet-outside">
    <main className="meet-outside-main">
      <div className="meet-message">
        <h1>KIASA meeting</h1>
        <p>{text}</p>
        <Link className="admin-approve" href="/chat">Back to the chat</Link>
      </div>
    </main>
  </div>;
}
