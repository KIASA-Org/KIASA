import Link from "next/link";
import type { ReactNode } from "react";
import type { Account } from "@/content/accounts";
import { signOut } from "@/lib/accounts/actions";
import { publicSupabase } from "@/lib/accounts/server";
import { initialsOf } from "@/lib/accounts/viewer";
import { PreviewNote } from "./account";
import { AdminDesk } from "./admin-desk";
import { Avatar } from "./avatar";
import { LeafMark } from "./brand";
import { YourPhoto } from "./your-photo";

/** `id` and `photo` once accounts are connected: their square is then their photo, which they can change there. */
type Admin = { name: string; role: string; id?: string; photo?: string | null };

/** The admin page's frame: its own bar, as a practice page has (the firm's leaf,
 * a rule, "Admin", and who is signed in), then the page. */
function AdminFrame({ admin, live, children }: { admin: Admin; live: boolean; children: ReactNode }) {
  return <div className="site admin">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="practice-header admin-header">
      <div className="admin-bar wrap wrap-wide">
        <Link href="/" className="practice-lockup" aria-label="KIASA home">
          <LeafMark className="practice-mark" weight={3.4} />
          <span className="practice-divider" aria-hidden="true" />
          <span className="practice-word">KIASA <span>Admin</span></span>
        </Link>
        <div className="admin-user">
          {live && admin.id
            ? <YourPhoto person={{ id: admin.id, name: admin.name }} photo={admin.photo ?? null} realtime={publicSupabase} className="account-initials"
              details="bar" role={admin.role} />
            : <>
              <Avatar initials={initialsOf(admin.name)} className="account-initials" />
              <span className="admin-user-text">
                <span className="admin-user-name">{admin.name}</span>
                <span className="admin-user-role">{admin.role}</span>
              </span>
            </>}
          {live && <Link href="/jobs" className="account-button admin-exit">Jobs</Link>}
          {live && <Link href="/chat" className="account-button admin-exit">Chat</Link>}
          <Link href="/" className="account-button admin-exit">Back to the site</Link>
          {live && <form action={signOut}><button type="submit" className="account-button">Sign out</button></form>}
        </div>
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="page">{children}</main>
  </div>;
}

/** The admin page (`/admin`): where a person at KIASA approves who may sign in,
 * and finds anyone who has asked. `live` once accounts are connected; until
 * then it shows the sample people and keeps nothing. */
export function AdminView({ people, admin, live }: { people: Account[]; admin: Admin; live: boolean }) {
  return <AdminFrame admin={admin} live={live}>
    {!live && <div className="wrap wrap-wide admin-preview"><PreviewNote /></div>}
    <AdminDesk people={people} live={live} realtime={live ? publicSupabase : undefined} />
  </AdminFrame>;
}

/** Signed in, but not one of KIASA's admins. */
export function NotAdminView({ email }: { email: string }) {
  return <AdminFrame admin={{ name: email, role: "Signed in" }} live>
    <section className="block admin-top" aria-labelledby="admin-title">
      <div className="wrap wrap-wide">
        <p className="eyebrow block-eyebrow">Admin</p>
        <h1 id="admin-title" className="account-title">This page is for KIASA&apos;s admins</h1>
        <p className="account-lead">You are signed in as {email}, which is not an admin account. Sign out to sign in as an admin.</p>
      </div>
    </section>
  </AdminFrame>;
}
