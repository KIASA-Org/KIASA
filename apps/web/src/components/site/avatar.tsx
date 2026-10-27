"use client";

import type { ReactNode } from "react";
import type { Rank } from "@/lib/accounts/viewer";
import { RankBadges, useRank } from "./ranks";

/** Someone's square: their photo if they have set one, over their initials.
 * The initials stay underneath, so a photo that cannot load leaves them showing.
 * `className` gives the size and colours (account-initials, chat-avatar…).
 * `who`: their user id, so an admin's or a top manager's badge shows on it, as
 * the page knows it now; `rank` gives the badge outright instead. */
export function Avatar({ initials, photo, className, kind, who, rank, children }: {
  initials: string; photo?: string | null; className: string; kind?: string; who?: string | null; rank?: Rank | null; children?: ReactNode;
}) {
  const known = useRank(who);
  const badge = rank === undefined ? known : rank;
  return <span className={className} data-kind={kind} data-photo={photo ? "" : undefined} data-rank={badge ?? undefined} aria-hidden="true">
    {initials}
    {/* eslint-disable-next-line @next/next/no-img-element -- already a small square, made in the browser, at an address never reused: nothing for the image optimizer to do */}
    {photo && <img className="avatar-photo" src={photo} alt="" width={96} height={96} decoding="async" />}
    {children}
    {badge && <RankBadges rank={badge} />}
  </span>;
}
