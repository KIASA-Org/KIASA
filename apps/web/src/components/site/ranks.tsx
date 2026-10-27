"use client";

import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { refreshBadge } from "@/lib/accounts/actions";
import { browserClient } from "@/lib/accounts/browser";
import { readBadge, type Rank, type Ranks } from "@/lib/accounts/viewer";

const Known = createContext<Ranks>({ owners: [], top: [] });

/** Who wears a badge on their photo, for every Avatar inside: KIASA's admins
 * and the top managers. A badge given or taken away on the admin page reaches
 * this page the moment it happens. `me`: the person signed in, whose own badge
 * cookie (which the header of every page reads) is brought up to date with it. */
export function RanksProvider({ initial, realtime, me, children }: {
  initial: Ranks; realtime?: { url: string; key: string }; me?: string; children: ReactNode;
}) {
  const [top, setTop] = useState(initial.top);
  const url = realtime?.url, key = realtime?.key;

  useEffect(() => {
    if (!url || !key) return;
    const supabase = browserClient(url, key);
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let stopped = false;
    (async () => {
      // Signed in first: a stranger hears of no change at all.
      await supabase.realtime.setAuth();
      if (stopped) return;
      channel = supabase.channel("ranks")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "top_managers" }, payload => {
          const id = (payload.new as { user_id?: string }).user_id;
          if (id) setTop(current => current.includes(id) ? current : [...current, id]);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "top_managers" }, payload => {
          const id = (payload.old as { user_id?: string }).user_id;
          if (id) setTop(current => current.filter(other => other !== id));
        })
        .subscribe(status => {
          // Back from a pause: what happened meanwhile.
          if (status === "SUBSCRIBED" && !stopped) void supabase.from("top_managers").select("user_id").then(({ data, error }) => {
            if (!stopped && !error && data) setTop(data.map(row => row.user_id as string));
          });
        });
    })().catch(() => {});
    return () => {
      stopped = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [url, key]);

  const mine = me ? rankIn({ owners: initial.owners, top }, me) : null;
  const update = useEffectEvent(() => {
    const badge = readBadge(document.cookie);
    if (badge && (badge.rank ?? null) !== mine) void refreshBadge();
  });
  useEffect(() => { if (me) update(); }, [me, mine]);

  return <Known value={{ owners: initial.owners, top }}>{children}</Known>;
}

const rankIn = (ranks: Ranks, id: string): Rank | null =>
  ranks.owners.includes(id) ? "owner" : ranks.top.includes(id) ? "top" : null;

/** The badge someone wears, as this page knows it now. */
export function useRank(id: string | null | undefined): Rank | null {
  const ranks = useContext(Known);
  return id ? rankIn(ranks, id) : null;
}

/** Everyone wearing the top manager's badge (Jobs' Live view leaves them out). */
export const useTopManagers = () => useContext(Known).top;

/** The badges on a photo: KIASA's leaf (the logo's own, cut from
 * public/brand/kiasa-logo.png) at its bottom right, as a verified mark, and for
 * an admin, a crown on top. */
export function RankBadges({ rank }: { rank: Rank }) {
  return <>
    {rank === "owner" && <span className="rank-crown" title="KIASA admin">
      <svg className="rank-art" viewBox="0 0 24 18" aria-hidden="true" focusable="false">
        <path d="M2 15.5 0.8 4.2l6 4.6L12 0.8l5.2 8 6-4.6L22 15.5Z" />
        <rect x="2" y="15.2" width="20" height="2.6" rx="1" />
      </svg>
    </span>}
    {/* eslint-disable-next-line @next/next/no-img-element -- one small picture, the same everywhere: the browser keeps it */}
    <img className="rank-leaf" src="/brand/kiasa-leaf-badge.png" alt="" width={160} height={160} decoding="async"
      title={rank === "owner" ? "KIASA admin" : "KIASA top manager"} />
  </>;
}
