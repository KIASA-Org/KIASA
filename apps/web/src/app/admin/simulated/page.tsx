import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotAdminView, SimsView } from "@/components/site/admin";
import { accountsLive, currentViewer, ranks } from "@/lib/accounts/server";
import { simDesk } from "@/lib/sims/server";

export const metadata: Metadata = {
  title: "Admin: simulated members",
  description: "Accounts that fill KIASA while it is built and tested.",
  robots: { index: false, follow: false },
};

/** The admin's simulated members: for KIASA's admins only. Until accounts are connected, it says so. */
export default async function SimulatedPage() {
  if (!accountsLive) redirect("/admin");
  const viewer = await currentViewer();
  if (!viewer) redirect("/sign-in");
  if (!viewer.admin) return <NotAdminView email={viewer.email} />;
  const [desk, badges] = await Promise.all([simDesk(), ranks()]);
  return <SimsView desk={desk} ranks={badges} admin={{ name: viewer.admin.name, role: viewer.email, id: viewer.id, photo: viewer.photo }} />;
}
