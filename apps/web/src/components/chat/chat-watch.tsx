"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/accounts/browser";
import { photoUrl } from "@/lib/accounts/viewer";
import type { ChatRow, Message } from "@/lib/chat/types";
import { showTabBadge } from "../site/tab-badge";
import { alertNewMessage, alertsWorker, messageAlert } from "./chat-alerts";

/** On KIASA's other desks (the jobs desk, the admin page, the account page):
 * the unread messages on the tab's icon, and an alert on this computer when one
 * comes, so the chat need not be open. It draws nothing on the page. */
export function ChatWatch({ me, realtime }: { me: string; realtime: { url: string; key: string } }) {
  useEffect(() => {
    const supabase = browserClient(realtime.url, realtime.key);
    let stopped = false;
    let timer: number | undefined;
    let channel: RealtimeChannel | null = null;
    let chats = new Map<string, ChatRow>();
    let photos = new Map<string, string>();

    // The chat list's unread counts, muted chats aside, as the chat itself counts them.
    const refresh = async () => {
      const { data, error } = await supabase.rpc("inbox");
      if (stopped || error) return;
      chats = new Map(((data ?? []) as ChatRow[]).map(row => [row.id, row]));
      showTabBadge([...chats.values()].reduce((sum, chat) => sum + (chat.muted ? 0 : Number(chat.unread) || 0), 0));
    };
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 300);
    };
    const arrived = async (message: Message) => {
      if (message.sender_id !== me) {
        if (!chats.has(message.chat_id)) await refresh();
        const chat = chats.get(message.chat_id);
        if (chat && !chat.muted && !stopped) {
          void alertNewMessage(messageAlert(message, chat, chat.members ?? [], { id: me }, id => (id ? photos.get(id) ?? null : null)));
        }
      }
      soon();
    };

    (async () => {
      if ("Notification" in window && Notification.permission === "granted") void alertsWorker();
      await supabase.realtime.setAuth();
      if (stopped) return;
      channel = supabase.channel("chat-watch")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => void arrived(payload.new as Message))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, soon)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, soon)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_settings" }, soon)
        .subscribe();
      const [, faces] = await Promise.all([refresh(), supabase.from("avatars").select("user_id, path")]);
      photos = new Map(((faces.data ?? []) as { user_id: string; path: string }[]).map(row => [row.user_id, photoUrl(realtime.url, row.path)]));
    })().catch(() => {});

    // Back on the tab: the counts again, in case the connection slept.
    const look = () => { if (document.visibilityState === "visible") soon(); };
    document.addEventListener("visibilitychange", look);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", look);
      if (channel) void supabase.removeChannel(channel);
      showTabBadge(0);
    };
  }, [me, realtime.url, realtime.key]);
  return null;
}
