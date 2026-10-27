"use client";

import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { refreshBadge } from "@/lib/accounts/actions";
import { browserClient } from "@/lib/accounts/browser";
import { markKey, markOf, readBadge, type Mark, type Ranks, type Team } from "@/lib/accounts/viewer";

const Known = createContext<Ranks>({ owners: [], top: [], teams: [], placed: {} });

/** Who wears what on their photo, for every Avatar inside: KIASA's admins, the
 * top managers, and each team's shield on its people. A badge given or taken
 * away, a team made, renamed or recoloured, or someone moved between teams on
 * the admin page reaches this page the moment it happens. `me`: the person
 * signed in, whose own badge cookie (which the header of every page reads) is
 * brought up to date with it. */
export function RanksProvider({ initial, realtime, me, children }: {
  initial: Ranks; realtime?: { url: string; key: string }; me?: string; children: ReactNode;
}) {
  const [top, setTop] = useState(initial.top);
  const [teams, setTeams] = useState<Team[]>(initial.teams ?? []);
  const [placed, setPlaced] = useState<Record<string, string>>(initial.placed ?? {});
  const url = realtime?.url, key = realtime?.key;

  useEffect(() => {
    if (!url || !key) return;
    const supabase = browserClient(url, key);
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let stopped = false;
    // All of it again: after a pause, or when anything changed (the lists are short).
    const reload = () => void Promise.all([
      supabase.from("top_managers").select("user_id"),
      supabase.from("teams").select("id, name, color").order("name"),
      supabase.from("team_members").select("user_id, team_id"),
    ]).then(([managers, made, members]) => {
      if (stopped) return;
      if (!managers.error && managers.data) setTop(managers.data.map(row => row.user_id as string));
      if (!made.error && made.data) setTeams(made.data as Team[]);
      if (!members.error && members.data) setPlaced(Object.fromEntries(members.data.map(row => [row.user_id as string, row.team_id as string])));
    });
    (async () => {
      // Signed in first: a stranger hears of no change at all.
      await supabase.realtime.setAuth();
      if (stopped) return;
      channel = supabase.channel("ranks")
        .on("postgres_changes", { event: "*", schema: "public", table: "top_managers" }, reload)
        .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, reload)
        .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, reload)
        .subscribe(status => { if (status === "SUBSCRIBED" && !stopped) reload(); });
    })().catch(() => {});
    return () => {
      stopped = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [url, key]);

  const known: Ranks = { owners: initial.owners, top, teams, placed };
  const mine = me ? markKey(markOf(known, me)) : "";
  const update = useEffectEvent(() => {
    const badge = readBadge(document.cookie);
    if (badge && markKey(badge.mark) !== mine) void refreshBadge();
  });
  useEffect(() => { if (me) update(); }, [me, mine]);

  return <Known value={known}>{children}</Known>;
}

/** The mark someone wears, as this page knows it now. */
export function useMark(id: string | null | undefined): Mark | null {
  const ranks = useContext(Known);
  return id ? markOf(ranks, id) : null;
}

/** Everything the page knows of who wears what, and who is in which team. */
export const useRanks = () => useContext(Known);
/** Everyone wearing the top manager's badge (Jobs' Live view leaves them out). */
export const useTopManagers = () => useContext(Known).top;
/** The teams, and who is in which (user id → team id). */
export const useTeams = () => { const { teams = [], placed = {} } = useContext(Known); return { teams, placed }; };

/** White or night letters, whichever reads better on a colour. */
const inkOn = (color: string) => {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#030807" : "#ffffff";
};

/** A team's shield: its colour, its first letter, and for its manager a gold rim. */
export function TeamShield({ name, color, lead, className }: { name: string; color: string; lead?: boolean; className?: string }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return <svg className={className} viewBox="0 0 24 28" aria-hidden="true" focusable="false">
    <path d="M12 1.5 21.5 4.8V13c0 6.2-4.1 10.9-9.5 13.4C6.6 23.9 2.5 19.2 2.5 13V4.8Z" fill={color}
      stroke={lead ? "#f6c945" : "#030807"} strokeWidth={lead ? 2.4 : 1.4} strokeLinejoin="round" />
    <path d="M12 3.6 19.4 6.2V13c0 5-3.2 8.8-7.4 10.9" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1" />
    <text x="12" y="17.4" textAnchor="middle" fontSize="12.5" fontWeight="800" fontFamily="system-ui, sans-serif" fill={inkOn(color)}>{letter}</text>
  </svg>;
}

/** The badges on a photo, at its bottom right as a verified mark: KIASA's leaf
 * (the logo's own, cut from public/brand/kiasa-logo.png), and for an admin a
 * crown on top; or the person's team shield, gold-rimmed for its manager. */
export function RankBadges({ mark }: { mark: Mark }) {
  if (mark.kind === "team") return <span className="rank-team" title={`${mark.name}${mark.lead ? " · manager" : ""}`}>
    <TeamShield name={mark.name} color={mark.color} lead={mark.lead} className="rank-shield" />
  </span>;
  return <>
    {mark.kind === "owner" && <span className="rank-crown" title="KIASA admin">
      <svg className="rank-art" viewBox="0 0 24 18" aria-hidden="true" focusable="false">
        <path d="M2 15.5 0.8 4.2l6 4.6L12 0.8l5.2 8 6-4.6L22 15.5Z" />
        <rect x="2" y="15.2" width="20" height="2.6" rx="1" />
      </svg>
    </span>}
    {/* eslint-disable-next-line @next/next/no-img-element -- one small picture, the same everywhere: the browser keeps it */}
    <img className="rank-leaf" src="/brand/kiasa-leaf-badge.png" alt="" width={160} height={160} decoding="async"
      title={mark.kind === "owner" ? "KIASA admin" : "KIASA top manager"} />
  </>;
}
