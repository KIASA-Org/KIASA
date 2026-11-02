"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/accounts/browser";
import { scriptTopic } from "./live-words";

const SEND_MS = 30;        // At most this often, for one member's words (kept short so the admin reads it live).
// "Still here": a hidden tab's timers may run only once a minute, so words coming in say it too.
const HEARTBEAT_MS = 15_000;

/** A member's live script, as KIASA's admins see it. While the script is on,
 * the member is on the admins' list and an admin may read the words; the page
 * tells the member so. The words go over a private channel and are never
 * stored: each change as where it differs from the last, and the whole script
 * when an admin opens it. A closed page stops saying it is on, so it drops off. */
export function useLiveSession(me: string, realtime: { url: string; key: string }, current: () => string, on: boolean) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [live, setLive] = useState(false);
  const channel = useRef<RealtimeChannel | null>(null);
  const beat = useRef(0);
  const sentText = useRef("");
  const sentCount = useRef(0);
  const timer = useRef(0);
  const lastSent = useRef(0);
  const lastBeat = useRef(0);

  // (A query only goes when asked for its answer: hence each `then`.)
  const removeRow = useCallback(() => {
    void supabase.from("live_sessions").delete().eq("user_id", me).then(() => {});
  }, [supabase, me]);

  const stop = useCallback(() => {
    window.clearInterval(beat.current);
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (channel.current) void supabase.removeChannel(channel.current);
    channel.current = null;
    setLive(false);
    removeRow();
  }, [supabase, removeRow]);

  const sendWhole = useCallback(() => {
    const text = current();
    sentText.current = text;
    sentCount.current += 1;
    void channel.current?.send({ type: "broadcast", event: "whole", payload: { n: sentCount.current, text } });
  }, [current]);

  const sendChange = useCallback(() => {
    timer.current = 0;
    lastSent.current = Date.now();
    const text = current();
    const before = sentText.current;
    if (text === before) return;
    let same = 0;
    const most = Math.min(text.length, before.length);
    while (same < most && text[same] === before[same]) same += 1;
    sentText.current = text;
    sentCount.current += 1;
    void channel.current?.send({ type: "broadcast", event: "change", payload: { n: sentCount.current, at: same, tail: text.slice(same) } });
  }, [current]);

  const stillHere = useCallback(() => {
    lastBeat.current = Date.now();
    void supabase.from("live_sessions").update({ user_id: me }).eq("user_id", me).then(() => {});
  }, [supabase, me]);

  /** The script changed: pass it on at once (unless just passed on: then in a moment). */
  const changed = useCallback(() => {
    if (!channel.current) return;
    if (Date.now() - lastBeat.current > HEARTBEAT_MS) stillHere();
    if (timer.current) return;
    const wait = lastSent.current + SEND_MS - Date.now();
    if (wait <= 0) sendChange();
    else timer.current = window.setTimeout(sendChange, wait);
  }, [sendChange, stillHere]);

  const start = useCallback(async () => {
    const { error } = await supabase.from("live_sessions").upsert({ user_id: me });
    if (error) return;
    await supabase.realtime.setAuth();
    const opened = supabase.channel(scriptTopic(me), { config: { private: true, broadcast: { self: false } } })
      .on("broadcast", { event: "want" }, () => sendWhole());
    channel.current = opened;
    opened.subscribe(status => {
      if (status === "SUBSCRIBED") {
        setLive(true);
        sentCount.current = 0;
        sendWhole();
      }
    });
    lastBeat.current = Date.now();
    beat.current = window.setInterval(stillHere, HEARTBEAT_MS);
  }, [supabase, me, sendWhole, stillHere]);

  // The script is the capture: it goes on the admins' list with it, and off with it.
  useEffect(() => {
    if (!on) return;
    void start();
    return () => { stop(); };
  }, [on, start, stop]);

  // A row left by an earlier page (closed, or reloaded) is not this page's.
  useEffect(() => { removeRow(); }, [removeRow]);

  return { live, changed };
}
