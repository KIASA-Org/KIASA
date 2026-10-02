/** Lifecycle settings for the startup mark. Its choreography lives in timing.ts. */

/** How often the entrance (the mark being drawn) plays.
 * - "every-visit": the landing page *is* the animation, so every homepage load draws it.
 * - "once-per-session": only the first homepage visit of a browser session draws it;
 *   later visits start with the finished mark. Switch to this once a full site
 *   sits behind the entrance.
 */
export type IntroFrequency = "every-visit" | "once-per-session";
export const INTRO_FREQUENCY: IntroFrequency = "every-visit";

/** Versioned: bump it when a redesigned entrance should play again for open sessions. */
export const SESSION_KEY = "kiasa:intro:dew-v3";

/** Longest wait for scripts to arrive and playback to begin before the finished mark is shown instead. */
export const START_BUDGET_MS = 3000;
/** Slack past the scripted end before a stalled entrance is cut short. */
export const DEADLINE_GRACE_MS = 600;

/** Dispatched on `window` once, when the entrance ends for any reason. */
export const INTRO_EVENT = "kiasa:intro-complete";
