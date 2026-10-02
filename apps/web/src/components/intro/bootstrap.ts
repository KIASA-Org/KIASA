import { INTRO_EVENT, INTRO_FREQUENCY, SESSION_KEY, START_BUDGET_MS, type IntroFrequency } from "./config";

export type IntroReason =
  /** The entrance played to its end. */
  | "complete"
  | "skip"
  | "reduced-motion"
  /** once-per-session only: already seen, or the session could not be recorded. */
  | "returning-visit" | "storage-unavailable"
  /** Scripts did not start playback in time. */
  | "initialization-error"
  /** The deadline passed, typically while the tab was in the background. */
  | "expired"
  /** No entrance was set up for this page view (client-side navigation, or the inline script was blocked). */
  | "not-started";

export type IntroResult = { reason: IntroReason; elapsedMs: number };
export type IntroBoot = {
  /** True while the entrance is pending or playing. */
  active: boolean;
  startedAt: number;
  result?: IntroResult;
  /** Ends the entrance. Only the first call has any effect. */
  finish: (reason: IntroReason) => void;
  /** Restarts the watchdog: the entrance ends with `reason` unless something finishes it within `ms`. */
  arm: (ms: number, reason: IntroReason) => void;
};

declare global {
  interface Window { __kiasaIntro?: IntroBoot }
}

/** Runs inline in <head>, before first paint and before React downloads, so it
 * must stay self-contained. It decides whether the entrance plays, owns Skip and
 * focus, and guarantees an end: whatever happens to scripts or timers, the
 * watchdog releases the page. Without this script CSS shows the finished mark.
 *
 * <html data-kiasa-intro> is "waiting" until React starts the animation, then
 * "playing", and is removed when the entrance ends.
 */
function bootstrap(key: string, frequency: IntroFrequency, startBudgetMs: number, eventName: string) {
  if (location.pathname !== "/" || window.__kiasaIntro) return;
  const root = document.documentElement;
  const startedAt = performance.now();
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let deadline = Infinity;
  let deadlineReason: IntroReason = "expired";
  let timer: ReturnType<typeof setTimeout> | undefined;
  // <body> does not exist yet: the observer makes a covered page inert as soon as it is parsed.
  const observer = new MutationObserver(lock);
  const boot: IntroBoot = {
    active: false,
    startedAt,
    arm(ms, reason) {
      if (boot.result) return;
      clearTimeout(timer);
      deadline = performance.now() + ms;
      deadlineReason = reason;
      timer = setTimeout(() => boot.finish(reason), ms);
    },
    finish(reason) {
      if (boot.result) return;
      boot.active = false;
      boot.result = { reason, elapsedMs: performance.now() - startedAt };
      clearTimeout(timer);
      observer.disconnect();
      delete root.dataset.kiasaIntro;
      const shell = document.getElementById("site-content");
      if (shell) { shell.inert = false; shell.removeAttribute("aria-hidden"); }
      // Skip is about to disappear: keyboard users continue from the page itself.
      if (document.activeElement?.closest("#kiasa-intro")) document.getElementById("main-content")?.focus({ preventScroll: true });
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onReturn);
      media.removeEventListener("change", onMotion);
      window.dispatchEvent(new CustomEvent(eventName, { detail: boot.result }));
    },
  };
  window.__kiasaIntro = boot;
  function onClick(event: MouseEvent) {
    if ((event.target as Element).closest("[data-skip-intro]")) {
      event.preventDefault();
      boot.finish("skip");
    }
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") { boot.finish("skip"); return; }
    // Where the entrance covers a page, that page is inert and Skip is the only control: keep focus on it.
    const skip = document.querySelector<HTMLElement>("[data-skip-intro]");
    if (event.key === "Tab" && skip) {
      event.preventDefault();
      skip.focus();
    }
  }
  // Background tabs throttle timers; settle an overdue entrance the moment the visitor returns.
  function onReturn() { if (performance.now() >= deadline) boot.finish(deadlineReason); }
  function onMotion() { if (media.matches) boot.finish("reduced-motion"); }
  function lock() {
    const shell = document.getElementById("site-content");
    if (!shell) return;
    shell.inert = true;
    shell.setAttribute("aria-hidden", "true");
    observer.disconnect();
  }

  const remember = () => {
    if (frequency !== "once-per-session") return true;
    try { sessionStorage.setItem(key, "seen"); return true; } catch { return false; }
  };
  if (media.matches) { remember(); boot.finish("reduced-motion"); return; }
  if (frequency === "once-per-session") {
    let seen: string | null = null;
    try { seen = sessionStorage.getItem(key); } catch { boot.finish("storage-unavailable"); return; }
    if (seen) { boot.finish("returning-visit"); return; }
    // Recorded on entry, so a skipped or interrupted entrance never replays on Back.
    if (!remember()) { boot.finish("storage-unavailable"); return; }
  }

  boot.active = true;
  root.dataset.kiasaIntro = "waiting";
  observer.observe(root, { childList: true, subtree: true });
  lock();
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("pageshow", onReturn);
  media.addEventListener("change", onMotion);
  boot.arm(startBudgetMs, "initialization-error");
}

/** The inline script for a given replay policy. Nothing user-supplied is interpolated. */
export function bootstrapScript(frequency: IntroFrequency = INTRO_FREQUENCY) {
  return `(${bootstrap.toString()})(${[SESSION_KEY, frequency, START_BUDGET_MS, INTRO_EVENT].map(value => JSON.stringify(value)).join(",")})`;
}
