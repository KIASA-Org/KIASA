import { useSyncExternalStore } from "react";
import type { ChatMe, ChatMember, ChatSummary, Message } from "@/lib/chat/types";
import { chatTitle, gist } from "./chat-format";

/** Alerts on this computer for new messages. Every open KIASA desk (the chat,
 * the jobs desk, the admin and account pages) hears a new message and hands it to
 * KIASA's service worker (public/sw.js), which shows it once, as the computer's
 * own notification, unless KIASA Chat is the window in front; a click opens that
 * chat. The browser asks the person's leave once. */

export type AlertsState = NotificationPermission | "unsupported";

const supported = () => "Notification" in window && "serviceWorker" in navigator;
const current = (): AlertsState => (supported() ? Notification.permission : "unsupported");

// The browser's answer, as it changes: here, or in its own settings.
const listeners = new Set<() => void>();
const tell = () => listeners.forEach(listener => listener());
let watching = false;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!watching && supported() && navigator.permissions) {
    watching = true;
    navigator.permissions.query({ name: "notifications" }).then(status => { status.onchange = tell; }, () => {});
  }
  return () => { listeners.delete(listener); };
}

/** Whether alerts are on in this browser: "granted", "default" (not asked yet),
 * "denied", or "unsupported". Before the page is here, "unsupported": nothing
 * about alerts is drawn on the server. */
export const useAlerts = () => useSyncExternalStore(subscribe, current, (): AlertsState => "unsupported");

let ready: Promise<ServiceWorkerRegistration | null> | null = null;
/** KIASA's service worker, made ready once per page: it shows the alerts. */
export function alertsWorker() {
  if (!supported()) return Promise.resolve(null);
  ready ??= navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready, () => null);
  return ready;
}

/** One alert at once, to see that this computer shows them. */
export async function testAlert() {
  const worker = await alertsWorker();
  worker?.active?.postMessage({ type: "alert", test: true, title: "KIASA Chat alerts are on", body: "A new message will show here, like this." });
}

/** Asking the browser's leave, from a click; on yes, a first alert shows what they look like. */
export async function turnOnAlerts(): Promise<AlertsState> {
  if (!supported()) return "unsupported";
  const answer = await Notification.requestPermission();
  tell();
  if (answer === "granted") await testAlert();
  return answer;
}

export type ChatAlert = { id: string; chatId: string; title: string; body: string; icon: string | null };

/** What an alert says of a message: the chat (a person, or a group and who
 * wrote in it), and the message's words. */
export function messageAlert(message: Message, chat: Pick<ChatSummary, "kind" | "title">, members: ChatMember[], me: Pick<ChatMe, "id">,
  photoOf: (id: string | null) => string | null): ChatAlert {
  const writer = members.find(member => member.user_id === message.sender_id)?.name;
  const words = gist(message);
  return {
    id: message.id,
    chatId: message.chat_id,
    title: chatTitle(chat, members, me),
    body: chat.kind === "group" && writer ? `${writer.split(" ")[0]}: ${words}` : words,
    icon: photoOf(message.sender_id),
  };
}

/** A new message for this person, handed to the service worker, which shows it
 * unless they are reading the chat. In a browser that refused the worker, the
 * page itself says it, while it is not in front; a click brings KIASA forward. */
export async function alertNewMessage(alert: ChatAlert) {
  if (current() !== "granted") return;
  const worker = await alertsWorker();
  if (worker?.active) return worker.active.postMessage({ type: "alert", ...alert });
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const notice = new Notification(alert.title, { body: alert.body, icon: alert.icon ?? "/icon.png", tag: `chat-${alert.chatId}` });
  notice.onclick = () => {
    window.focus();
    notice.close();
  };
}
