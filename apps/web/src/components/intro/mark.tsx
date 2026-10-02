"use client";

import { useMarkPlayback, type MarkCallbacks } from "./playback";
import { MarkScene } from "./scene";

/** The animated KIASA mark as page content: drawn once, then flowing for as long
 * as it is on screen. This is the landing page today. To put it in front of a
 * page that needs time to load, use `StartupBoundary` instead.
 */
export function StartupMark(callbacks: MarkCallbacks) {
  const { clock, flow } = useMarkPlayback(callbacks);
  return <MarkScene clock={clock} flow={flow} />;
}
