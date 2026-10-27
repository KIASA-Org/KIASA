import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MemberAccountView, RequestStatusView, SampleAccountView } from "@/components/site/account";
import { RanksProvider } from "@/components/site/ranks";
import { SiteShell } from "@/components/site/shell";
import { member as sample } from "@/content/accounts";
import { pushPublicKey } from "@/lib/accounts/push";
import { accountsLive, currentViewer, publicSupabase, ranks } from "@/lib/accounts/server";
import { initialsOf } from "@/lib/accounts/viewer";

export const metadata: Metadata = {
  title: "Your account",
  description: "Your KIASA account: your details, and what you hear from us.",
  // A private page: kept out of search engines.
  robots: { index: false, follow: false },
};

/** A signed-in person's page: their account once approved; before that, their
 * request and its status, which changes the moment a person decides. Anyone not
 * signed in is sent to sign in, and an admin without a request to the admin
 * page. Until accounts are connected, the page shows its sample design. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!accountsLive) return <SiteShell viewer={{ name: sample.name, initials: initialsOf(sample.name), href: "/account" }}>
    <SampleAccountView />
  </SiteShell>;

  // Who is asking, and who wears which badge, together (the badges are only shown once approved).
  const [viewer, badges] = await Promise.all([currentViewer(), ranks()]);
  if (!viewer) redirect("/sign-in");
  const member = viewer.member;
  if (!member) redirect(viewer.admin ? "/admin" : "/sign-in");
  const badge = { name: member.name, initials: initialsOf(member.name), href: "/account", photo: viewer.photo ?? undefined, mark: viewer.mark ?? undefined };
  if (member.status !== "approved") return <SiteShell viewer={badge}>
    <RequestStatusView member={member} realtime={publicSupabase} pushKey={pushPublicKey} />
  </SiteShell>;
  // Just approved, while watching, or signing in for the first time since.
  const welcome = (await searchParams).welcome === "1";
  // Their own photo wears their badge; it comes and goes live as an admin changes it.
  return <SiteShell viewer={badge}>
    <RanksProvider initial={badges} realtime={publicSupabase} me={viewer.id}>
      <MemberAccountView member={member} photo={viewer.photo} realtime={publicSupabase} welcome={welcome} />
    </RanksProvider>
  </SiteShell>;
}
