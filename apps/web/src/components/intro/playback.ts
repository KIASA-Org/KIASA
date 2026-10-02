import { useEffect, useLayoutEffect, useRef } from "react";
import { animate, frame, useMotionValue, type MotionValue } from "motion/react";
import type { IntroResult } from "./bootstrap";
import { DEADLINE_GRACE_MS, INTRO_EVENT } from "./config";
import { FLOW_FADE, SETTLED } from "./timing";

/** The loop clock simply runs on. A day is far longer than any visit; if it is
 * ever reached the loop starts again. */
const RUN_SECONDS = 24 * 60 * 60;

export type MarkCallbacks = {
  /** Called once when the entrance ends for any reason, including when it never played. */
  onComplete?: (result: IntroResult) => void;
  /** Called once, before `onComplete`, when the visitor skipped. */
  onSkip?: () => void;
};
type Animation = ReturnType<typeof animate>;

/** Drives the mark: the entrance once (when the pre-paint bootstrap asked for it),
 * then the loop for as long as the mark is on screen.
 *
 * The clock starts at SETTLED, which is what the server rendered: the finished
 * mark. Everything else is progressive enhancement, so a failure anywhere in
 * here leaves a complete, still mark rather than an empty page.
 */
export function useMarkPlayback({ onComplete, onSkip }: MarkCallbacks = {}): { clock: MotionValue<number>; flow: MotionValue<number> } {
  const clock = useMotionValue(SETTLED);
  const flow = useMotionValue(0);
  const callbacks = useRef({ onComplete, onSkip });
  const reported = useRef(false);
  useEffect(() => { callbacks.current = { onComplete, onSkip }; }, [onComplete, onSkip]);

  // Before the first client paint: if the entrance will play, rewind to its first frame.
  useLayoutEffect(() => {
    const boot = window.__kiasaIntro;
    if (!boot?.active) return;
    const root = document.documentElement;
    // Development only: Strict Mode's remount resets <html> to the attributes
    // React rendered, dropping the state the pre-paint script set.
    root.dataset.kiasaIntro ||= "waiting";
    clock.set(0);
    // CSS holds a placeholder (just the small light) while "waiting". Hand over
    // only after Motion has painted the same first frame, so nothing flashes.
    frame.postRender(() => { if (boot.active) root.dataset.kiasaIntro = "playing"; });
  }, [clock]);

  useEffect(() => {
    const boot = window.__kiasaIntro;
    const stillness = matchMedia("(prefers-reduced-motion: reduce)");
    let entrance: Animation | undefined;
    let loop: Animation | undefined;
    let gate: Animation | undefined;

    const rest = () => {
      loop?.stop();
      gate?.stop();
      loop = gate = undefined;
      flow.set(0);
      clock.set(SETTLED);
    };
    const circulate = () => {
      if (loop || stillness.matches) return;
      clock.set(SETTLED);
      loop = animate(clock, SETTLED + RUN_SECONDS, { duration: RUN_SECONDS, ease: "linear", onComplete: () => { loop = undefined; circulate(); } });
      gate = animate(flow, 1, { duration: FLOW_FADE, ease: "easeOut" });
    };
    // However the entrance ends (completion, Skip, a watchdog, reduced motion), the mark settles here.
    const settle = () => {
      entrance?.stop();
      entrance = undefined;
      if (!reported.current) {
        reported.current = true;
        const result = boot?.result ?? { reason: "not-started", elapsedMs: 0 };
        if (result.reason === "skip") callbacks.current.onSkip?.();
        callbacks.current.onComplete?.(result);
      }
      if (stillness.matches) rest(); else circulate();
    };
    const onPreference = () => {
      if (stillness.matches) rest();
      else if (!boot?.active) circulate();
    };

    stillness.addEventListener("change", onPreference);
    window.addEventListener(INTRO_EVENT, settle);
    if (!boot || boot.result) settle();
    else {
      // Resumes from the clock's current value, so a Strict Mode remount neither restarts nor skips.
      const remaining = SETTLED - clock.get();
      entrance = animate(clock, SETTLED, { duration: remaining, ease: "linear", onComplete: () => boot.finish("complete") });
      boot.arm(remaining * 1000 + DEADLINE_GRACE_MS, "expired");
    }
    return () => {
      stillness.removeEventListener("change", onPreference);
      window.removeEventListener(INTRO_EVENT, settle);
      entrance?.stop();
      loop?.stop();
      gate?.stop();
    };
  }, [clock, flow]);

  return { clock, flow };
}
