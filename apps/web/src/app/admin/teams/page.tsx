import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotAdminView, TeamsView } from "@/components/site/admin";
import { accountsLive, currentViewer, everyone, ranks } from "@/lib/accounts/server";

export const metadata: Metadata = {
  title: "Admin: teams",
  description: "KIASA's teams: their badges, managers and members.",
  robots: { index: false, follow: false },
};

/** The admin's teams: for KIASA's admins only. Until accounts are connected, it says so. */
export default async function TeamsPage() {
  if (!accountsLive) redirect("/admin");
  const [viewer, people, badges] = await Promise.all([currentViewer(), everyone().catch((error: Error) => error), ranks()]);
  if (!viewer) redirect("/sign-in");
  if (!viewer.admin) return <NotAdminView email={viewer.email} />;
  if (people instanceof Error) throw people;
  return <TeamsView people={people} teams={badges.teams ?? []} ranks={badges}
    admin={{ name: viewer.admin.name, role: viewer.email, id: viewer.id, photo: viewer.photo }} />;
}
