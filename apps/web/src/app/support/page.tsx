import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SupportDesk } from "@/components/support/support-desk";
import { accountsLive, currentViewer, publicSupabase, visitorClient } from "@/lib/accounts/server";
import { sessionNames } from "@/lib/support/server";

export const metadata: Metadata = {
  title: { absolute: "KIASA Support sessions" },
  description: "Screen and sound sharing between a member and their manager.",
  robots: { index: false, follow: false },
};

export default async function SupportPage() {
  if (!accountsLive) redirect("/");
  const viewer = await currentViewer();
  if (!viewer) redirect("/sign-in");
  const manager = !!viewer.admin || viewer.top;
  const visitor = await visitorClient();
  const [{ data: sessions }, { data: members }] = await Promise.all([
    visitor.from("support_sessions").select("member_id, manager_id").or(`member_id.eq.${viewer.id},manager_id.eq.${viewer.id}`).limit(200),
    manager ? visitor.rpc("support_members") : Promise.resolve({ data: [] }),
  ]);
  const ids = [...new Set((sessions ?? []).flatMap(row => [row.member_id as string, row.manager_id as string]))];
  const names = { ...await sessionNames(ids), ...Object.fromEntries(((members ?? []) as { id: string; name: string }[]).map(m => [m.id, m.name])) };
  return <main className="support-page"><SupportDesk me={viewer.id} manager={manager} names={names} realtime={publicSupabase} /></main>;
}
