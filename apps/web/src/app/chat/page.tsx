import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LeafMark } from "@/components/site/brand";
import { RanksProvider } from "@/components/site/ranks";
import { YourPhoto } from "@/components/site/your-photo";
import { ChatApp } from "@/components/chat/chat-app";
import { signOut } from "@/lib/accounts/actions";
import { accountsLive, publicSupabase, ranks, signedIn } from "@/lib/accounts/server";
import type { Ranks } from "@/lib/accounts/viewer";
import { chatPeople, chatViewer, myChats } from "@/lib/chat/server";
import type { ChatMe } from "@/lib/chat/types";

export const metadata: Metadata = {
  title: { absolute: "KIASA Chat" },
  description: "KIASA's team chat.",
  robots: { index: false, follow: false },
};

const SETUP = {
  missing: "KIASA Chat is not set up in the database yet. In Supabase's SQL Editor, run the files in supabase/migrations in order (chat, chat_speed, avatars, chat_more), then reload this page.",
  outdated: "KIASA Chat has an update for the database: deleting, clearing and pinning chats, reactions, forwarding, Saved Messages and profiles. In Supabase's SQL Editor, run supabase/migrations/20261026233000_chat_more.sql, then reload this page.",
};

/** KIASA Chat: for approved people and KIASA's admins. Anyone else is sent to
 * sign in. Until accounts are connected, it says so. Who is asking, their
 * chats and the people they can chat with are asked for together, in one
 * trip; what is asked for someone who may not chat is never shown. `?c=` opens
 * one chat (from "Open in new tab"). */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!accountsLive) return <ChatFrame>
    <div className="chat-empty"><p>KIASA Chat opens once accounts are connected.</p></div>
  </ChatFrame>;
  if (!(await signedIn())) redirect("/sign-in");
  const [me, { setup, chats, members }, people, badges, asked] = await Promise.all([chatViewer(), myChats(), chatPeople(), ranks(), searchParams]);
  if (!me) redirect("/sign-in");
  if (setup) return <ChatFrame me={me} ranks={badges}>
    <div className="chat-empty"><p>{me.admin ? SETUP[setup] : "KIASA Chat is being updated. Please try again a little later."}</p></div>
  </ChatFrame>;
  const opening = typeof asked.c === "string" && chats.some(chat => chat.id === asked.c) ? asked.c : null;
  return <ChatFrame me={me} ranks={badges}>
    <ChatApp me={me} initialChats={chats} initialMembers={members} people={people} realtime={publicSupabase} initialChat={opening} />
  </ChatFrame>;
}

/** The chat's frame: its own bar (the firm's leaf, a rule, "Chat", who is
 * signed in, with their photo to change), then the chat filling the rest of
 * the window. `ranks`: who wears a badge on their photo. */
function ChatFrame({ me, ranks, children }: { me?: ChatMe; ranks?: Ranks; children: React.ReactNode }) {
  return <RanksProvider initial={ranks ?? { owners: [], top: [] }} realtime={me ? publicSupabase : undefined} me={me?.id}>
    <div className="site chat-page">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="practice-header admin-header chat-bar">
      <div className="admin-bar wrap wrap-wide">
        <Link href="/" className="practice-lockup" aria-label="KIASA home">
          <LeafMark className="practice-mark" weight={3.4} />
          <span className="practice-divider" aria-hidden="true" />
          <span className="practice-word">KIASA <span>Chat</span></span>
        </Link>
        {me && <div className="admin-user">
          <YourPhoto person={{ id: me.id, name: me.name }} photo={me.photo} realtime={publicSupabase} className="account-initials"
            details="bar" role={me.admin ? "Admin" : "Team"}>
            <Link href={me.admin ? "/admin" : "/account"}>{me.admin ? "Admin" : "Your account"}</Link>
          </YourPhoto>
          <Link href="/jobs" className="account-button admin-exit">Jobs</Link>
          <Link href={me.admin ? "/admin" : "/account"} className="account-button admin-exit">{me.admin ? "Admin" : "Your account"}</Link>
          <form action={signOut}><button type="submit" className="account-button">Sign out</button></form>
        </div>}
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="chat-main">{children}</main>
    </div>
  </RanksProvider>;
}
