"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { INTRO_EVENT } from "./config";
import { useMarkPlayback, type MarkCallbacks } from "./playback";
import { MarkScene } from "./scene";
import { useSkipTool } from "./skip-tool";

/** Real application state. It is never derived from the animation clock. */
export type ApplicationReadiness = { status: "ready" } | { status: "pending"; message?: string };
export type StartupBoundaryProps = MarkCallbacks & {
  /** The page the mark stands in front of. It is rendered only once `readiness` is ready. */
  children: ReactNode;
  readiness?: ApplicationReadiness;
};

const READY: ApplicationReadiness = { status: "ready" };

// The pre-paint bootstrap is the source of truth for whether the entrance is in front of the page.
const subscribe = (notify: () => void) => {
  window.addEventListener(INTRO_EVENT, notify);
  return () => window.removeEventListener(INTRO_EVENT, notify);
};
const isCovering = () => !!window.__kiasaIntro && !window.__kiasaIntro.result;
const noSubscription = () => () => {};

/** Puts the animated mark in front of a page: the entrance plays once, and the
 * mark keeps flowing for as long as the application is genuinely still loading.
 * The landing page uses `StartupMark` directly; this is the integration point
 * for the public site and the staff dashboard.
 */
export function StartupBoundary({ children, readiness = READY, onComplete, onSkip }: StartupBoundaryProps) {
  const { clock, flow } = useMarkPlayback({ onComplete, onSkip });
  // The server always renders the stage; CSS keeps it hidden unless the bootstrap activates it.
  const covering = useSyncExternalStore(subscribe, isCovering, () => true);
  // Only a hydrated page can ever leave "pending", so only then may pending keep the stage up.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const pending = readiness.status === "pending";
  useSkipTool();

  return <>
    <div id="site-content" suppressHydrationWarning>{pending ? null : children}</div>
    {(covering || pending) && <div id="kiasa-intro" className="startup-stage" data-pending={hydrated && pending ? "" : undefined}>
      <MarkScene clock={clock} flow={flow} />
      {/* Announced only when work is actually pending, and only once the entrance is over. */}
      {pending && !covering && <p className="sr-only" role="status">{readiness.message ?? "Loading…"}</p>}
      {covering && <a href="#main-content" className="skip-intro" data-skip-intro>Skip intro</a>}
    </div>}
  </>;
}
