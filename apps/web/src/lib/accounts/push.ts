import "server-only";
import webpush from "web-push";
import { siteClient } from "./server";

const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const privateKey = process.env.VAPID_PRIVATE_KEY || "";

/** Alerts on a person's computer work once the site's push keys are set (see
 * `.env.example`). The public key goes to the browser; the private one signs
 * each alert and never leaves the server. */
export const pushReady = Boolean(publicKey && privateKey);
export const pushPublicKey = pushReady ? publicKey : "";
if (pushReady) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://kiasa.tech", publicKey, privateKey);

/** The browsers' own alert services. An alert address anywhere else is refused,
 * so no one can make the site send requests to an address of their choosing. */
const SERVICES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];
export const isAlertAddress = (endpoint: string) => {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && (url.hostname === "fcm.googleapis.com" || SERVICES.some(host => url.hostname.endsWith(host)));
  } catch {
    return false;
  }
};

export type Alert = { title: string; body: string; url: string };

/** Sends an alert to every browser in which this person asked for them. Kept
 * by the browsers' services for a week if the computer is off. A browser that
 * has since withdrawn its permission is forgotten. */
export async function alertPerson(userId: string, alert: Alert): Promise<number> {
  if (!pushReady) return 0;
  const site = siteClient();
  const { data } = await site.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
  const rows = data ?? [];
  const sent = await Promise.all(rows.map(async row => {
    const service = new URL(row.endpoint as string).hostname;
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint as string, keys: { p256dh: row.p256dh as string, auth: row.auth as string } },
        JSON.stringify({ ...alert, tag: "kiasa-request" }),
        { TTL: 60 * 60 * 24 * 7, urgency: "high" },
      );
      return true;
    } catch (error) {
      const { statusCode, body } = error as { statusCode?: number; body?: string };
      if (statusCode === 404 || statusCode === 410) await site.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
      console.error(`[alerts] ${service} refused an alert: ${statusCode ?? "no answer"} ${String(body ?? (error as Error).message).slice(0, 200)}`);
      return false;
    }
  }));
  const delivered = sent.filter(Boolean).length;
  console.info(`[alerts] "${alert.title}" handed to ${delivered} of ${rows.length} browser(s)`);
  return delivered;
}
