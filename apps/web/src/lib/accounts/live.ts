"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { browserClient } from "./browser";

export type Listening = "connecting" | "live" | "paused";
/** A change to a request: what it became (`new`), or what it was, if deleted (`old`). */
export type RowChange = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown>; old: Record<string, unknown> };

/** Hears of changes to the requests table the moment they happen, as the
 * signed-in visitor: the database's rules decide what they may hear (an admin,
 * every request; anyone else, only their own). `filter` narrows it further, as
 * "id=eq.…". When live updates are not flowing, `catchUp` runs every 30 seconds
 * instead, and whenever the visitor comes back to the tab, since a sleeping
 * computer misses what happened meanwhile. */
export function useLiveRows({ realtime, filter, onChange, catchUp }: {
  realtime?: { url: string; key: string };
  filter?: string;
  onChange: (change: RowChange) => void;
  catchUp: () => void;
}): Listening {
  const [listening, setListening] = useState<Listening>("connecting");
  const changed = useEffectEvent(onChange);
  const look = useEffectEvent(() => { if (document.visibilityState === "visible") catchUp(); });
  const url = realtime?.url, key = realtime?.key;

  useEffect(() => {
    if (!url || !key) return;
    const supabase = browserClient(url, key);
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let stopped = false;
    (async () => {
      // Hand over the visitor's sign-in before joining. A channel joined
      // without it is accepted, but as a stranger, and the database's rules
      // (rightly) let a stranger hear of no request at all.
      await supabase.realtime.setAuth();
      if (stopped) return;
      channel = supabase.channel(`requests:${filter ?? "all"}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles", ...(filter ? { filter } : {}) },
          payload => changed(payload as unknown as RowChange))
        .subscribe(status => { if (!stopped) setListening(status === "SUBSCRIBED" ? "live" : "paused"); });
    })().catch(() => { if (!stopped) setListening("paused"); });
    return () => {
      stopped = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [url, key, filter]);

  useEffect(() => {
    if (!url) return;
    const tick = () => look();
    const timer = listening === "live" ? undefined : window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [url, listening]);

  return listening;
}
