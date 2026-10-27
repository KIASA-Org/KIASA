"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

// How many loading screens are showing (a page's loading.tsx, while the server makes the page).
let screens = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const tell = () => listeners.forEach(listener => listener());

/** Put in a loading screen: while it shows, the line along the top keeps going. */
export function LoadingSignal() {
  useEffect(() => {
    screens += 1;
    tell();
    return () => { screens -= 1; tell(); };
  }, []);
  return null;
}

/** A thin leaf line along the top of the window while the next page comes: from
 * the click on a link to another page of the site, through its loading screen,
 * until the page itself is there. One line all the way, never starting over. */
export function RouteProgress() {
  const pathname = usePathname();
  const waiting = useSyncExternalStore(subscribe, () => screens > 0, () => false);
  const [run, setRun] = useState<{ from: string; key: number } | null>(null);

  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      setRun({ from: window.location.pathname, key: Date.now() });
    };
    // Seen first, before the link itself handles the click.
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);

  const arrived = !!run && run.from !== pathname && !waiting;
  // Once there, it fills and fades; and it never stays, whatever happens.
  useEffect(() => {
    if (!run) return;
    const timer = window.setTimeout(() => setRun(null), arrived ? 600 : 20_000);
    return () => window.clearTimeout(timer);
  }, [run, arrived]);

  if (!run && !waiting) return null;
  return <div key={run?.key ?? "waiting"} className="route-progress" data-state={arrived ? "done" : "going"} aria-hidden="true" />;
}
