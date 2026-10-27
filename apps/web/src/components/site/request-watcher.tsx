"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { savePushSubscription, sendTestAlert } from "@/lib/accounts/actions";
import { useLiveRows } from "@/lib/accounts/live";

type Alerts = "checking" | "unsupported" | "blocked" | "off" | "working" | "on";

/** The site's public push key, as the bytes a browser asks for. */
const keyBytes = (key: string) => {
  const base64 = `${key}${"=".repeat((4 - (key.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
};

/** Whether this browser can alert, and whether it already will. */
async function alertsNow(): Promise<Alerts> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/** Watches a request that is waiting, as its owner (the database's rules let
 * them hear only of their own): the moment a person at KIASA approves it, an
 * open page turns into their account, welcomed. And, if they ask, their
 * computer is alerted, by the browser itself, even with no KIASA page open. */
export function RequestWatcher({ id, realtime, pushKey }: { id: string; realtime: { url: string; key: string }; pushKey: string }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alerts>("checking");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let stopped = false;
    alertsNow().then(state => { if (!stopped) setAlerts(state); }, () => { if (!stopped) setAlerts("unsupported"); });
    return () => { stopped = true; };
  }, []);

  const listening = useLiveRows({
    realtime,
    filter: `id=eq.${id}`,
    onChange: change => {
      if (change.eventType === "UPDATE" && change.new.status === "approved") router.replace("/account?welcome=1");
      else router.refresh();
    },
    catchUp: () => router.refresh(),
  });

  const [testing, setTesting] = useState<"idle" | "sending" | "sent">("idle");
  const test = async () => {
    setTesting("sending");
    setProblem("");
    const result = await sendTestAlert();
    if (result.error) setProblem(result.error);
    setTesting(result.error ? "idle" : "sent");
  };

  const turnOn = async () => {
    setAlerts("working");
    setProblem("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setAlerts(permission === "denied" ? "blocked" : "off");
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) });
      const result = await savePushSubscription(subscription.toJSON());
      if (result.error) setProblem(result.error);
      setAlerts(result.error ? "off" : "on");
    } catch {
      setProblem("This browser could not turn alerts on. Please try again, or use another browser.");
      setAlerts("off");
    }
  };

  return <div className="request-watch">
    <p className="admin-live" data-state={listening}>
      <span aria-hidden="true" />
      {listening === "live" ? "Watching for the decision: this page changes the moment it is made."
        : listening === "connecting" ? "Connecting…"
          : "This page checks for the decision every 30 seconds."}
    </p>
    {pushKey && <div className="request-alerts" role="status">
      {(alerts === "off" || alerts === "working") && <>
        <button type="button" className="b-submit request-alerts-button" aria-disabled={alerts === "working" || undefined}
          onClick={alerts === "working" ? undefined : turnOn}>
          {alerts === "working" ? "Turning alerts on…" : "Alert me on this computer"}
        </button>
        <p className="account-note">Your computer tells you the moment you are approved, even with this page closed.</p>
      </>}
      {alerts === "on" && <>
        <p className="request-alerts-on">Alerts are on: this computer will tell you the moment you are approved, even with this page closed.</p>
        <button type="button" className="account-button" aria-disabled={testing === "sending" || undefined} onClick={testing === "sending" ? undefined : test}>
          {testing === "sending" ? "Sending…" : "Send me a test alert"}
        </button>
        {testing === "sent" && <p className="account-note">Sent. It should appear in a few seconds. If it does not, check that this browser may show notifications in your computer&apos;s settings, and that Do Not Disturb is off.</p>}
      </>}
      {alerts === "blocked" && <p className="account-note">Alerts are blocked here. A private window always blocks them: open this page in a normal window. Otherwise, allow them for this site: click the icon to the left of the address, then Notifications.</p>}
      {alerts === "unsupported" && <p className="account-note">This browser cannot show alerts. Private windows never can: open this page in a normal window to get one.</p>}
      {problem && <p className="b-form-error">{problem}</p>}
    </div>}
  </div>;
}
