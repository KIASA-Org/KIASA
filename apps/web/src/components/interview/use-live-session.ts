"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { ScriptWriter, startClock, tokenFrom } from "./live-link";

const STILL_HERE_MS = 15_000;     // How often the admins' list hears that the script is on.
const TRY_AGAIN_MS = 4_000;       // Sooner if that did not get through: it counts for 90 seconds.
const GIVE_UP_MS = 12_000;        // A request on a poor connection may hang: it is not waited for.

/** A member's live script, as KIASA's admins see it. While the script is on, the member is on
 * the admins' list and an admin may read the words; the page tells the member so. The words go
 * over a private channel and are never stored (see live-link.ts for how). A closed page stops
 * saying it is on, so it drops off the list. */
export function useLiveSession(me: string, realtime: { url: string; key: string }, current: () => string, on: boolean) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const writer = useRef<ScriptWriter | null>(null);

  // The socket to the app is set up once, and goes on calling this same function.
  const changed = useCallback(() => writer.current?.changed(), []);

  // The script is the capture: it goes on the admins' list with it, and off with it.
  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let release = () => {};

    const stillHere = () => {
      let next = 0;
      let asking = false;
      return () => {
        const now = Date.now();
        if (asking || now < next) return;
        asking = true;
        // An upsert, so that it comes back even if the row went or was never made.
        void supabase.from("live_sessions").upsert({ user_id: me }).abortSignal(AbortSignal.timeout(GIVE_UP_MS)).then(
          ({ error }) => { asking = false; next = Date.now() + (error ? TRY_AGAIN_MS : STILL_HERE_MS); },
          () => { asking = false; next = Date.now() + TRY_AGAIN_MS; },
        );
      };
    };
    const stopBeat = startClock(1_000, stillHere());

    const write = () => {
      if (stopped) return;
      const started = new ScriptWriter({ url: realtime.url, key: realtime.key, token: tokenFrom(supabase) }, me, current);
      writer.current = started;
      started.start();
    };
    // One tab writes: a copy of the tab is not to send the same words again. If that tab
    // closes, this one takes over. Holding this also tells Chrome not to freeze the tab.
    if (navigator.locks) {
      void navigator.locks.request(`kiasa-live-writer:${me}`, () => {
        if (stopped) return;
        write();
        return new Promise<void>(resolve => { release = resolve; });
      }).catch(() => write());
    } else write();

    return () => {
      stopped = true;
      stopBeat();
      writer.current?.stop();
      writer.current = null;
      release();
      void supabase.from("live_sessions").delete().eq("user_id", me).then(() => {});
    };
  }, [on, me, supabase, realtime.url, realtime.key, current]);

  // A row left by a closed page goes stale and drops off by itself. It is not for a page
  // opening to clear it: that row may be another tab's, with the script still on.
  return { changed };
}
