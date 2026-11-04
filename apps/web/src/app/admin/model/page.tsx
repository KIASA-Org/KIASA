import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ModelServerView, NotAdminView } from "@/components/site/admin";
import { accountsLive, currentViewer, ranks } from "@/lib/accounts/server";

export const metadata: Metadata = {
  title: "Admin: model server",
  description: "How the model is, and whose browsers are connected to it.",
  robots: { index: false, follow: false },
};

/** The admin's Model server: for KIASA's admins only. */
export default async function ModelServerPage() {
  if (!accountsLive) redirect("/admin");
  const [viewer, badges] = await Promise.all([currentViewer(), ranks()]);
  if (!viewer) redirect("/sign-in");
  if (!viewer.admin) return <NotAdminView email={viewer.email} />;
  return <ModelServerView ranks={badges} admin={{ name: viewer.admin.name, role: viewer.email, id: viewer.id, photo: viewer.photo }} />;
}
