"use client";

import type { ReactNode } from "react";
import { initialsOf, type Mark } from "@/lib/accounts/viewer";
import { RankBadges, useFaces, useMark } from "./ranks";

/** Someone's square: their photo if they have set one, over their initials.
 * The initials stay underneath, so a photo that cannot load leaves them showing.
 * `className` gives the size and colours (account-initials, chat-avatar…).
 * `who`: their user id, so their badge (an admin's, a top manager's, or their
 * team's shield) shows on it, as the page knows it now; `mark` gives the badge
 * outright instead. A new name or photo of `who`'s shows the moment they change it. */
export function Avatar({ initials, photo, className, kind, who, mark, children }: {
  initials: string; photo?: string | null; className: string; kind?: string; who?: string | null; mark?: Mark | null; children?: ReactNode;
}) {
  const known = useMark(who);
  const faces = useFaces();
  const badge = mark === undefined ? known : mark;
  const renamed = faces.name(who, "");
  if (renamed) initials = initialsOf(renamed);
  photo = faces.photo(who, photo);
  return <span className={className} data-kind={kind} data-photo={photo ? "" : undefined} data-rank={badge?.kind} aria-hidden="true">
    {initials}
    {/* eslint-disable-next-line @next/next/no-img-element -- already a small square, made in the browser, at an address never reused: nothing for the image optimizer to do */}
    {photo && <img className="avatar-photo" src={photo} alt="" width={96} height={96} decoding="async" />}
    {children}
    {badge && <RankBadges mark={badge} />}
  </span>;
}
