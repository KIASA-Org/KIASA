import type { ReactNode } from "react";

/** Someone's square: their photo if they have set one, over their initials.
 * The initials stay underneath, so a photo that cannot load leaves them showing.
 * `className` gives the size and colours (account-initials, chat-avatar…). */
export function Avatar({ initials, photo, className, kind, children }: {
  initials: string; photo?: string | null; className: string; kind?: string; children?: ReactNode;
}) {
  return <span className={className} data-kind={kind} data-photo={photo ? "" : undefined} aria-hidden="true">
    {initials}
    {/* eslint-disable-next-line @next/next/no-img-element -- already a small square, made in the browser, at an address never reused: nothing for the image optimizer to do */}
    {photo && <img className="avatar-photo" src={photo} alt="" width={96} height={96} decoding="async" />}
    {children}
  </span>;
}
