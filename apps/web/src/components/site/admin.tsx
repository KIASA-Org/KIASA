import type { ReactNode } from "react";
import type { Account } from "@/content/accounts";
import { publicSupabase } from "@/lib/accounts/server";
import type { Ranks, Team } from "@/lib/accounts/viewer";
import { ChatWatch } from "../chat/chat-watch";
import { PreviewNote } from "./account";
import { AdminDesk } from "./admin-desk";
import { AdminDevices } from "./admin-devices";
import type { AdminDevice } from "@/lib/accounts/devices";
import { AppBar, type AppArea } from "./app-bar";
import { RanksProvider } from "./ranks";
import type { SimDesk } from "@/lib/sims/server";
import { SimsDesk } from "./sims-desk";
import { TeamsDesk } from "./teams-desk";

/** `id` and `photo` once accounts are connected: their square is then their photo, which they can change there. */
type Admin = { name: string; role: string; id?: string; photo?: string | null };

/** The admin's console: KIASA's bar (Users, Chat, the Job desk, and who is
 * signed in), then the page. */
function AdminFrame({ admin, live, isAdmin = true, area = "admin", children }: { admin: Admin; live: boolean; isAdmin?: boolean; area?: AppArea; children: ReactNode }) {
  return <div className="site admin">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <AppBar area={area} person={{ id: admin.id, name: admin.name, detail: admin.role, admin: isAdmin, photo: admin.photo }} realtime={publicSupabase} live={live} />
    <main id="main-content" tabIndex={-1} className="page">{children}</main>
    {live && admin.id && <ChatWatch me={admin.id} realtime={publicSupabase} />}
  </div>;
}

/** The admin page (`/admin`): where a person at KIASA approves who may sign in,
 * and finds anyone who has asked. `live` once accounts are connected; until
 * then it shows the sample people and keeps nothing. */
export function AdminView({ people, admin, ranks, live, devices }: {
  people: Account[]; admin: Admin; ranks?: Ranks; live: boolean; devices?: { on: boolean; devices: AdminDevice[]; here: string | null };
}) {
  const asking = devices?.devices.filter(device => !device.approved_at).length ?? 0;
  return <RanksProvider initial={ranks ?? { owners: [], top: [] }} realtime={live ? publicSupabase : undefined} me={admin.id}>
    <AdminFrame admin={admin} live={live}>
      {!live && <div className="wrap wrap-wide admin-preview"><PreviewNote /></div>}
      {asking > 0 && <div className="wrap wrap-wide admin-preview">
        <p className="admin-notice" data-failed="">{asking === 1 ? "A device is" : `${asking} devices are`} asking to use your admin account. <a className="admin-notice-link" href="#admin-devices">See {asking === 1 ? "it" : "them"}</a></p>
      </div>}
      <AdminDesk people={people} teams={ranks?.teams ?? []} live={live} realtime={live ? publicSupabase : undefined} />
      {devices && <AdminDevices {...devices} />}
    </AdminFrame>
  </RanksProvider>;
}

/** The admin's teams (`/admin/teams`): each team's shield, its manager and members. */
export function TeamsView({ people, teams, admin, ranks }: { people: Account[]; teams: Team[]; admin: Admin; ranks: Ranks }) {
  return <RanksProvider initial={ranks} realtime={publicSupabase} me={admin.id}>
    <AdminFrame admin={admin} live area="teams">
      <TeamsDesk teams={teams} people={people} />
    </AdminFrame>
  </RanksProvider>;
}

/** The admin's simulated members (`/admin/simulated`): adding them, approving, teams, hours, pace, photos, testers. */
export function SimsView({ desk, admin, ranks }: { desk: SimDesk; admin: Admin; ranks: Ranks }) {
  return <RanksProvider initial={ranks} realtime={publicSupabase} me={admin.id}>
    <AdminFrame admin={admin} live area="simulated">
      {desk.setup
        ? <div className="wrap wrap-wide admin-preview"><p className="admin-notice" data-failed="">Simulated members are not set up in the database yet: run supabase/migrations/20261028090000_simulated_members.sql in Supabase&apos;s SQL Editor, then reload this page.</p></div>
        : <SimsDesk sims={desk.sims} people={desk.people} teams={ranks.teams ?? []} zone={desk.zone} links={desk.links} />}
    </AdminFrame>
  </RanksProvider>;
}

/** Signed in, but not one of KIASA's admins. */
export function NotAdminView({ email }: { email: string }) {
  return <AdminFrame admin={{ name: email, role: "Signed in" }} live isAdmin={false}>
    <section className="block admin-top" aria-labelledby="admin-title">
      <div className="wrap wrap-wide">
        <p className="eyebrow block-eyebrow">Admin</p>
        <h1 id="admin-title" className="account-title">This page is for KIASA&apos;s admins</h1>
        <p className="account-lead">You are signed in as {email}, which is not an admin account. Sign out to sign in as an admin.</p>
      </div>
    </section>
  </AdminFrame>;
}
