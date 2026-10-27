import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminView, NotAdminView } from "@/components/site/admin";
import { accounts, admin as sampleAdmin } from "@/content/accounts";
import { accountsLive, currentViewer, everyone } from "@/lib/accounts/server";

export const metadata: Metadata = {
  title: "Admin: accounts",
  description: "Approve who may sign in to KIASA, and find anyone who has asked.",
  // A private page: kept out of search engines.
  robots: { index: false, follow: false },
};

/** Where KIASA approves account requests: for its admins only (the `admins`
 * table, chrislim@kiasa.tech first). Until accounts are connected, it shows the
 * sample people and keeps nothing. */
export default async function AdminPage() {
  if (!accountsLive) return <AdminView people={accounts} admin={sampleAdmin} live={false} />;
  // Who is asking and the requests, together; the requests are shown only to an admin.
  const [viewer, people] = await Promise.all([currentViewer(), everyone().catch((error: Error) => error)]);
  if (!viewer) redirect("/sign-in");
  if (!viewer.admin) return <NotAdminView email={viewer.email} />;
  if (people instanceof Error) throw people;
  return <AdminView people={people} admin={{ name: viewer.admin.name, role: viewer.email, id: viewer.id, photo: viewer.photo }} live />;
}
