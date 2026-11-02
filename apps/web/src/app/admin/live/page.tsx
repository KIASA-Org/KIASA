import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotAdminView, LiveScriptsView } from "@/components/site/admin";
import { accountsLive, currentViewer, everyone, ranks } from "@/lib/accounts/server";

export const metadata: Metadata = {
  title: "Admin: live scripts",
  description: "Whose live script is on now, word by word.",
  robots: { index: false, follow: false },
};

/** The admin's Live scripts: for KIASA's admins only. */
export default async function LiveScriptsPage() {
  if (!accountsLive) redirect("/admin");
  const [viewer, people, badges] = await Promise.all([currentViewer(), everyone().catch((error: Error) => error), ranks()]);
  if (!viewer) redirect("/sign-in");
  if (!viewer.admin) return <NotAdminView email={viewer.email} />;
  if (people instanceof Error) throw people;
  const names = Object.fromEntries(people.map(person => [person.id, person.name]));
  return <LiveScriptsView names={{ ...names, [viewer.id]: viewer.admin.name }} ranks={badges}
    admin={{ name: viewer.admin.name, role: viewer.email, id: viewer.id, photo: viewer.photo }} />;
}
