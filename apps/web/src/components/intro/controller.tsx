"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { IntroReason } from "./bootstrap";
import { INTRO_EVENT, LEAVE_MS } from "./config";
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

/** Where the stage is: in front of the page, fading away from it, or out of it. */
type Stage = "covering" | "leaving" | "gone";
/** Ways an entrance ends while the visitor is looking at it. The stage then fades; otherwise it was never seen. */
const WATCHED = new Set<IntroReason>(["complete", "skip", "expired", "initialization-error"]);

// The pre-paint bootstrap is the source of truth for whether the entrance is in front of the page.
const subscribe = (notify: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // CSS fades the stage out; once that is over it can leave the page.
  const afterFade = () => {
    clearTimeout(timer);
    const boot = window.__kiasaIntro;
    const left = boot?.result ? boot.startedAt + boot.result.elapsedMs + LEAVE_MS - performance.now() : LEAVE_MS;
    timer = setTimeout(notify, Math.max(0, left) + 16);
  };
  const onEnd = () => { notify(); afterFade(); };
  window.addEventListener(INTRO_EVENT, onEnd);
  // A skip can land before the page is hydrated and listening: the entrance has
  // already ended, so let the stage finish its fade and leave all the same.
  if (window.__kiasaIntro?.result) afterFade();
  return () => {
    window.removeEventListener(INTRO_EVENT, onEnd);
    clearTimeout(timer);
  };
};
function stage(): Stage {
  const boot = window.__kiasaIntro;
  if (!boot) return "gone";
  if (!boot.result) return "covering";
  const endedAt = boot.startedAt + boot.result.elapsedMs;
  return WATCHED.has(boot.result.reason) && performance.now() - endedAt < LEAVE_MS ? "leaving" : "gone";
}
const noSubscription = () => () => {};

/** Puts the animated mark in front of a page: the entrance plays once, then the
 * mark fades away and the page is there. If the application is genuinely still
 * loading, the mark stays and keeps flowing until it is ready. The homepage is
 * wrapped in this; so can any page that should open with the mark.
 */
export function StartupBoundary({ children, readiness = READY, onComplete, onSkip }: StartupBoundaryProps) {
  const { clock, flow } = useMarkPlayback({ onComplete, onSkip });
  // The server always renders the stage; CSS keeps it hidden unless the bootstrap activates it.
  const phase = useSyncExternalStore(subscribe, stage, () => "covering" as Stage);
  const covering = phase === "covering";
  // Only a hydrated page can ever leave "pending", so only then may pending keep the stage up.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const pending = readiness.status === "pending";
  useSkipTool();

  return <>
    <div id="site-content" suppressHydrationWarning>{pending ? null : children}</div>
    {(phase !== "gone" || pending) && <div id="kiasa-intro" className="startup-stage" data-pending={hydrated && pending ? "" : undefined}>
      <MarkScene clock={clock} flow={flow} />
      {/* Announced only when work is actually pending, and only once the entrance is over. */}
      {pending && !covering && <p className="sr-only" role="status">{readiness.message ?? "Loading…"}</p>}
      {covering && <a href="#main-content" className="skip-intro" data-skip-intro>Skip intro</a>}
    </div>}
  </>;
}
