import type { DewDrop, Stroke } from "./geometry";

/** How the leaf is drawn, shared by the animated mark and the still one in the
 * site's header: one pale ink, the same line weights, the same glint on each drop. */

/** The drawing is one pale ink. Light green and blue only ever travel across it. */
export const INK = "#ECFFF3";
/** Line weight: the artwork's measured weight, lifted so fine veins stay legible
 * at this size. The borders of the leaves are lifted a little further, so each
 * leaf's outline reads at a glance without the drawing turning heavy. */
export const inkWidth = (stroke: Stroke) => Math.min(6.6, Math.max(3.8, 2.8 + 1.1 * stroke.width)) + (stroke.role === "margin" ? 0.6 : 0);
/** The outline of a dew drop. */
export const RING = 3.6;

/** A short arc in the upper left of a drop, where the artwork's drops catch the light. */
export function glint(drop: DewDrop) {
  const rho = drop.r * 0.58;
  const at = (degrees: number) => `${(drop.x + rho * Math.cos(degrees * Math.PI / 180)).toFixed(1)} ${(drop.y + rho * Math.sin(degrees * Math.PI / 180)).toFixed(1)}`;
  return `M${at(196)}A${rho.toFixed(1)} ${rho.toFixed(1)} 0 0 1 ${at(254)}`;
}
