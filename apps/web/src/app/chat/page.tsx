import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppBar } from "@/components/site/app-bar";
import { RanksProvider } from "@/components/site/ranks";
import { ChatApp } from "@/components/chat/chat-app";
import { accountsLive, publicSupabase, ranks, signedIn } from "@/lib/accounts/server";
import type { Ranks } from "@/lib/accounts/viewer";
import { chatPeople, chatsToWatch, chatViewer, groupDirectory, myChats, myRequests } from "@/lib/chat/server";
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
  const [me, { setup, chats, members }, people, badges, requests, groups, watched, asked] = await Promise.all([chatViewer(), myChats(), chatPeople(), ranks(), myRequests(), groupDirectory(), chatsToWatch(), searchParams]);
  if (!me) redirect("/sign-in");
  if (setup) return <ChatFrame me={me} ranks={badges}>
    <div className="chat-empty"><p>{me.admin ? SETUP[setup] : "KIASA Chat is being updated. Please try again a little later."}</p></div>
  </ChatFrame>;
  const opening = typeof asked.c === "string" && [...chats, ...(watched?.chats ?? [])].some(chat => chat.id === asked.c) ? asked.c : null;
  return <ChatFrame me={me} ranks={badges}>
    <ChatApp me={me} initialChats={chats} initialMembers={members} people={people} realtime={publicSupabase} initialChat={opening} initialRequests={requests} initialDirectory={groups} initialWatched={watched} />
  </ChatFrame>;
}

/** The chat's frame: its own bar (the firm's leaf, a rule, "Chat", who is
 * signed in, with their photo to change), then the chat filling the rest of
 * the window. `ranks`: who wears a badge on their photo. */
function ChatFrame({ me, ranks, children }: { me?: ChatMe; ranks?: Ranks; children: React.ReactNode }) {
  return <RanksProvider initial={ranks ?? { owners: [], top: [] }} realtime={me ? publicSupabase : undefined} me={me?.id}>
    <div className="site chat-page">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <div className="chat-bar">
      <AppBar area="chat" person={me ? { id: me.id, name: me.name, detail: me.admin ? "Admin" : "Team", admin: me.admin, photo: me.photo } : { name: "KIASA", detail: "", admin: false }}
        realtime={publicSupabase} live={!!me} />
    </div>
    <main id="main-content" tabIndex={-1} className="chat-main">{children}</main>
    </div>
  </RanksProvider>;
}
