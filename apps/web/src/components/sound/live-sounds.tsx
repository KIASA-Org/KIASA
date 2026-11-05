"use client";

import { useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { useSound } from "./sound-share";

type Share = { user_id: string; started_at: string };
const missing = (code?: string) => code === "42P01" || code === "PGRST205";

/** The admin's Live sounds: everyone sharing their computer's sound now, and any one of
 * them to listen to. Listening goes on while the admin moves around KIASA. */
export function LiveSounds({ names, realtime }: { names: Record<string, string>; realtime: { url: string; key: string } }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const sound = useSound();
  const [shares, setShares] = useState<Share[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notSetUp, setNotSetUp] = useState(false);

  // Who is sharing (the database shows only those whose page is still there): as the
  // list changes, and a look now and then, as a closed page says nothing.
  useEffect(() => {
    let stopped = false;
    let looking = false;
    const load = async () => {
      if (looking) return;
      looking = true;
      const { data, error } = await supabase.from("sound_shares").select("user_id, started_at").order("started_at").abortSignal(AbortSignal.timeout(12_000));
      looking = false;
      if (stopped) return;
      if (error) { setNotSetUp(missing(error.code)); return; }
      setNotSetUp(false);
      setShares((data ?? []) as Share[]);
      setLoaded(true);
    };
    void load();
    const changes = supabase.channel("sound-shares-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "sound_shares" }, () => void load())
      .subscribe();
    const tick = window.setInterval(() => void load(), 5_000);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      void supabase.removeChannel(changes);
    };
  }, [supabase]);

  const nameOf = (id: string) => names[id] ?? "A KIASA member";
  const listening = sound?.listening;
  const onNow = (id: string) => listening?.member === id && listening.state !== "ended" && listening.state !== "refused";

  return <div className="interview wrap wrap-wide">
    <div>
      <h1 className="interview-title">Live sounds</h1>
      <p className="jobs-form-hint">Everyone sharing their computer&apos;s sound now. Choose anyone to listen; it goes on while you move around KIASA. Only KIASA&apos;s admins can hear it. Each of them chose to share it and sees a notice while they do. Nothing is recorded or kept.</p>
    </div>
    <div className="jobs-card live-now-list sound-list">
      <p className="resume-folder-title">Sharing now{loaded ? ` (${shares.length})` : ""}</p>
      {notSetUp && <p className="jobs-empty-line">Live sounds are not set up in the database yet: an admin runs supabase/migrations/20261105120000_sound_shares.sql in Supabase&apos;s SQL Editor.</p>}
      {loaded && !shares.length && <p className="jobs-empty-line">No one is sharing their sound.</p>}
      {shares.map(share => {
        const on = onNow(share.user_id);
        return <button key={share.user_id} type="button" className="live-now-person" aria-current={on || undefined}
          onClick={() => { if (on) sound?.stopListening(); else sound?.listen(share.user_id, nameOf(share.user_id)); }}>
          <span className="bridge-status-dot live-now-dot" aria-hidden="true" />
          <span className="live-now-name">{nameOf(share.user_id)}</span>
          <span className="live-now-since">since {new Date(share.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <span className="sound-list-action">{on ? "Stop listening" : "Listen"}</span>
        </button>;
      })}
    </div>
  </div>;
}
