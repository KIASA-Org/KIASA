import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotAdminView, StorageView } from "@/components/site/admin";
import { accountsLive, currentViewer, ranks } from "@/lib/accounts/server";

export const metadata: Metadata = {
  title: "Admin: storage",
  description: "How much the database and its files hold, and how much room is left.",
  robots: { index: false, follow: false },
};

/** The admin's Storage page: for KIASA's admins only. */
export default async function StoragePage() {
  if (!accountsLive) redirect("/admin");
  const [viewer, badges] = await Promise.all([currentViewer(), ranks()]);
  if (!viewer) redirect("/sign-in");
  if (!viewer.admin) return <NotAdminView email={viewer.email} />;
  return <StorageView ranks={badges} admin={{ name: viewer.admin.name, role: viewer.email, id: viewer.id, photo: viewer.photo }} />;
}
