import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SupportRoom } from "@/components/support/support-room";
import { accountsLive, publicSupabase, signedIn, visitorClient } from "@/lib/accounts/server";
import { sessionNames } from "@/lib/support/server";

export const metadata: Metadata = {
  title: { absolute: "KIASA Support session" },
  description: "A member's shared screen and sound.",
  robots: { index: false, follow: false },
};

/** One live support session, for its assigned manager only (the database decides: the
 * row is readable by the two people in it, and opening it is refused to anyone else). */
export default async function SupportSessionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!accountsLive) redirect("/");
  const person = await signedIn();
  if (!person) redirect("/sign-in");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return <Outside text="There is no such session." />;
  const { data: row } = await (await visitorClient()).from("support_sessions").select("member_id, manager_id, status").eq("id", id).maybeSingle();
  if (!row || row.manager_id !== person.id) return <Outside text="This session is not yours to open. Sessions open only for the manager the member chose or accepted." />;
  if (row.status !== "live") return <Outside text={row.status === "invited" ? "The member has not accepted yet. This page opens once they do." : "This session has ended."} />;
  const names = await sessionNames([row.member_id as string]);
  return <SupportRoom session={id} member={names[row.member_id as string] ?? "The member"} realtime={publicSupabase} />;
}

function Outside({ text }: { text: string }) {
  return <div className="meet meet-outside">
    <main className="meet-outside-main">
      <div className="meet-message">
        <h1>KIASA support session</h1>
        <p>{text}</p>
        <Link className="admin-approve" href="/support">Back to support</Link>
      </div>
    </main>
  </div>;
}
