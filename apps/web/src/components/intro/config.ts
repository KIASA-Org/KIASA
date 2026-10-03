/** Lifecycle settings for the startup mark. Its choreography lives in timing.ts. */

/** How often the entrance (the mark being drawn) plays.
 * - "once-per-session": only the first homepage visit of a browser session draws it;
 *   a reload, or coming back in the same tab, opens the page at once.
 * - "every-visit": every homepage load draws it.
 */
export type IntroFrequency = "every-visit" | "once-per-session";
export const INTRO_FREQUENCY: IntroFrequency = "once-per-session";

/** Versioned: bump it when a redesigned entrance should play again for open sessions. */
export const SESSION_KEY = "kiasa:intro:dew-v3";

/** Longest wait for scripts to arrive and playback to begin before the page is shown instead. */
export const START_BUDGET_MS = 3000;
/** Slack past the scripted end before a stalled entrance is cut short. */
export const DEADLINE_GRACE_MS = 600;
/** How long the mark takes to fade away from the page once the entrance ends.
 * `#kiasa-intro` in globals.css fades for the same time. */
export const LEAVE_MS = 600;

/** Dispatched on `window` once, when the entrance ends for any reason. */
export const INTRO_EVENT = "kiasa:intro-complete";
