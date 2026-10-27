"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/accounts/actions";
import { initialsOf } from "@/lib/accounts/viewer";
import { Avatar } from "./avatar";
import { LeafMark } from "./brand";
import { useMark } from "./ranks";
import { ChevronDown, Leave } from "./icons";
import { YourPhoto } from "./your-photo";

export type AppArea = "admin" | "teams" | "simulated" | "chat" | "jobs";
/** Who is signed in, as the bar shows them. `id` and `photo` once accounts are connected. */
export type AppPerson = { id?: string; name: string; detail: string; admin: boolean; photo?: string | null };

/** KIASA's private areas, in the order the bar names them. Users is for admins only. */
const AREAS: { area: AppArea; href: string; label: string; admins?: true }[] = [
  { area: "admin", href: "/admin", label: "Users", admins: true },
  { area: "teams", href: "/admin/teams", label: "Teams", admins: true },
  { area: "simulated", href: "/admin/simulated", label: "Simulated", admins: true },
  { area: "chat", href: "/chat", label: "Chat" },
  { area: "jobs", href: "/jobs", label: "Job desk" },
];

/** The bar along the top of KIASA's private areas (the admin's console, Chat
 * and the Job desk): the leaf and KIASA, the areas as tabs, and on the right
 * who is signed in, whose menu holds their photo, their account, the website,
 * and signing out (asked first). */
export function AppBar({ area, person, realtime, live = true }: {
  area: AppArea; person: AppPerson; realtime?: { url: string; key: string }; live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  // Under the name: their team and role, as their badge says it.
  const mark = useMark(person.id);
  const detail = person.admin || !mark ? person.detail : mark.kind === "team" ? `${mark.name}${mark.lead ? " · Manager" : ""}` : mark.kind === "top" ? "Top manager" : person.detail;
  const root = useRef<HTMLDivElement>(null);

  // Escape, or a click outside the menu, closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      // The photo panel opens on the top layer from inside the menu: still the menu's.
      if (!root.current?.contains(target) && !target.closest?.(".photo-panel")) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return <header className="practice-header app-bar">
    <div className="app-bar-inner wrap wrap-wide">
      <Link href="/" className="app-bar-brand" aria-label="KIASA website">
        <LeafMark className="practice-mark" weight={3.4} />
        <span className="app-bar-word">KIASA</span>
      </Link>
      <nav className="app-bar-tabs" aria-label="KIASA">
        {AREAS.filter(entry => !entry.admins || person.admin).map(entry =>
          <Link key={entry.area} href={entry.href} className="app-bar-tab" aria-current={entry.area === area ? "page" : undefined}>{entry.label}</Link>)}
      </nav>
      <div className="app-bar-me" ref={root}>
        <button type="button" className="app-bar-who" aria-expanded={open} aria-haspopup="menu" aria-label={`Signed in as ${person.name}`} onClick={() => setOpen(!open)}>
          <Avatar initials={initialsOf(person.name)} photo={person.photo} className="account-initials app-bar-photo" who={person.id} mark={person.id ? undefined : person.admin ? { kind: "owner" } : null} />
          <span className="app-bar-who-text">
            <span className="app-bar-name">{person.name}</span>
            <span className="app-bar-detail">{detail}</span>
          </span>
          <ChevronDown className="app-bar-chevron" />
        </button>
        {open && <div className="app-menu" role="menu" aria-label="Your menu">
          <div className="app-menu-head">
            {live && person.id && realtime
              ? <YourPhoto person={{ id: person.id, name: person.name }} photo={person.photo ?? null} realtime={realtime} className="account-initials" details="card" role={detail} align="end" />
              : <p className="app-menu-name">{person.name}<span>{detail}</span></p>}
          </div>
          {!person.admin && <Link role="menuitem" className="app-menu-item" href="/account" onClick={() => setOpen(false)}>Your account</Link>}
          <Link role="menuitem" className="app-menu-item" href="/" onClick={() => setOpen(false)}>KIASA website</Link>
          {live && <button type="button" role="menuitem" className="app-menu-item app-menu-out" onClick={() => { setOpen(false); setAsking(true); }}><Leave /> Sign out</button>}
        </div>}
      </div>
    </div>
    {asking && <SignOutDialog onClose={() => setAsking(false)} />}
  </header>;
}

/** "Sign out of KIASA?", asked before signing out, wherever it is offered. */
export function SignOutDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [going, setGoing] = useState(false);
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);
  return <dialog ref={dialog} className="chat-dialog app-signout" aria-label="Sign out" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget && !going) onClose(); }}>
    <p className="chat-dialog-title">Sign out of KIASA?</p>
    <p className="chat-dialog-text">You will need your email and password to sign in again.</p>
    <form action={signOut} onSubmit={() => setGoing(true)} className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={going}>Cancel</button>
      <button type="submit" className="chat-dialog-button" data-danger="" autoFocus disabled={going}>{going ? "Signing out…" : "Sign out"}</button>
    </form>
  </dialog>;
}

/** A Sign out button that asks first (the account page's). */
export function SignOutButton({ className = "account-button" }: { className?: string }) {
  const [asking, setAsking] = useState(false);
  return <>
    <button type="button" className={className} onClick={() => setAsking(true)}>Sign out</button>
    {asking && <SignOutDialog onClose={() => setAsking(false)} />}
  </>;
}
