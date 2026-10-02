/** Choreography of the startup drawing, as plain data.
 *
 * Times are seconds on the scene clock, which starts when playback starts (not
 * at page load). The clock has two parts:
 *
 *   0 … SETTLED     the entrance, played once: a small light, then the leaf is
 *                   drawn line by line in one pale ink, and dew rolls along the
 *                   veins to rest as drops
 *   SETTLED … ∞     the loop, repeating every PERIOD: a light-green line runs
 *                   around the leaf borders; as it enters each leaf, light runs
 *                   up that leaf's stem and dew-bearing veins, and turns blue
 *                   where it touches a drop
 *
 * The loading bar under the leaf follows the same clock: it fills over the
 * entrance, is full at SETTLED, and then stays full.
 *
 * At SETTLED the drawing is complete and at rest: that frame is also what is
 * shown without JavaScript and to visitors who prefer reduced motion.
 */
import { DEW, STROKES, type Leaf, type StrokeRole } from "./geometry";

/** Scales the entrance. 1 is the natural pace. */
export const TEMPO = 1;
const scaled = (seconds: number) => seconds * TEMPO;

export type Span = { start: number; end: number };

// --- easing ------------------------------------------------------------------

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const linear = (t: number) => t;
export const easeInOut = (t: number) => t * t * (3 - 2 * t);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** 0 before `start`, 1 after `end`, eased in between. */
export function progress(time: number, start: number, end: number, easing = linear) {
  return easing(clamp01((time - start) / (end - start)));
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// --- entrance: the leaf lines -------------------------------------------------

/** When each beat of the entrance begins. */
export const PHASE = {
  bud: scaled(0.25),
  midrib: scaled(0.35),
  margin: scaled(0.7),
  vein: scaled(1.05),
  dew: scaled(1.6),
} as const;

/** The crown leads; the lower leaves follow so the plant unfolds, not pops. */
const LEAF_DELAY: Record<Leaf, number> = { bud: 0, crown: 0, left: 0.12, right: 0.24 };
/** Drawing speed in logo pixels per second: stems lead, fine veins follow calmly. */
const SPEED: Record<StrokeRole, number> = { midrib: 600, margin: 700, vein: 460 };
/** The bud is the first thing drawn: it unfurls slowly. */
const BUD_SECONDS = 0.5;
const VEIN_STAGGER = 0.09;
/** Pause while a line passes beneath a dew drop. */
const DROP_CROSSING = 0.05;

function strokeSpans() {
  const spans = new Map<string, Span>();
  const veins: Record<Leaf, number> = { bud: 0, crown: 0, left: 0, right: 0 };
  for (const stroke of STROKES) {
    const previous = stroke.after ? spans.get(stroke.after) : undefined;
    const start = previous ? previous.end + scaled(DROP_CROSSING)
      : stroke.leaf === "bud" ? PHASE.bud
      : stroke.role === "vein" ? PHASE.vein + scaled(LEAF_DELAY[stroke.leaf] + veins[stroke.leaf]++ * VEIN_STAGGER)
      : PHASE[stroke.role] + scaled(LEAF_DELAY[stroke.leaf]);
    const seconds = stroke.leaf === "bud" ? BUD_SECONDS : clamp(stroke.length / SPEED[stroke.role], 0.22, 0.95);
    spans.set(stroke.id, { start, end: start + scaled(seconds) });
  }
  return spans;
}
export const STROKE_SPANS: ReadonlyMap<string, Span> = strokeSpans();

// --- entrance: dew -------------------------------------------------------------

/** Long journeys leave first so every bead settles within the same breath. */
const DEW_ORDER = ["left-b", "crown-a", "right-b", "crown-b", "bud", "left-a", "right-a", "crown-c"];
const DEW_STAGGER = 0.06;
const DEW_SPEED = 330;

export type DewSpan = { start: number; arrive: number; settled: number };
export const DEW_SPANS: ReadonlyMap<string, DewSpan> = new Map(DEW.map(drop => {
  const start = PHASE.dew + scaled(Math.max(0, DEW_ORDER.indexOf(drop.id)) * DEW_STAGGER);
  const arrive = start + scaled(clamp(drop.length / DEW_SPEED, 0.45, 0.95));
  return [drop.id, { start, arrive, settled: arrive + scaled(0.3) }];
}));

/** The drawing is complete and at rest. */
export const SETTLED = Math.max(...[...DEW_SPANS.values()].map(span => span.settled)) + scaled(0.15);

// --- loop ----------------------------------------------------------------------

/** A stretch of light travelling along a line. Its head enters at `offset`
 * seconds into each period and crosses the line in `duration`; the stretch
 * behind it follows. `reverse` runs it from the line's tip back to its base. */
export type Pulse = { offset: number; duration: number; reverse?: boolean };
/** Light wrapping a dew drop: it wraps, holds, then fades. */
export type Ripple = { offset: number; wrap: number; hold: number; fade: number };

/** The running line's route: out along one border of a leaf and back along the
 * other, leaf after leaf, clockwise around the plant. */
const CIRCUIT: readonly (readonly [stroke: string, leaf: Leaf, reverse: boolean])[] = [
  ["crown-margin-l", "crown", false], ["crown-margin-r", "crown", true],
  ["right-margin-u", "right", false], ["right-margin-d", "right", true],
  ["left-margin-d", "left", false], ["left-margin-u", "left", true],
];
const CIRCUIT_SPEED = 520;
const STEM_SPEED = 480;
const VEIN_SPEED = 380;
/** Blue arrives quickly and lingers: a short wrap, a held glow, a long fade. */
const RIPPLE = { wrap: 0.36, hold: 0.3, fade: 0.85 };
/** Light takes a moment to round a drop before running on down the line beyond it. */
const ROUND_DROP = 0.14;

/** Light on a stem or vein gathers speed over the first GATHER of its run, then
 * travels steadily: `along(run)` is how far along the line its head is. */
const GATHER = 0.3;
const CRUISE = 1 / (1 - GATHER / 2);
export const along = (run: number) => (run < GATHER ? (CRUISE * run * run) / (2 * GATHER) : CRUISE * (run - GATHER / 2));
/** The inverse: how much of its run the head needs to reach `position` (0–1 and beyond). */
export const runTo = (position: number) => (position < along(GATHER) ? Math.sqrt((2 * GATHER * position) / CRUISE) : position / CRUISE + GATHER / 2);

function loop() {
  const pulses = new Map<string, Pulse>();
  const ripples = new Map<string, Ripple>();
  const length = (id: string) => STROKES.find(stroke => stroke.id === id)!.length;
  // Borders: one leg after another, so the legs read as a single running line.
  const enters: Partial<Record<Leaf, number>> = {};
  let clock = 0;
  for (const [id, leaf, reverse] of CIRCUIT) {
    const duration = length(id) / CIRCUIT_SPEED;
    pulses.set(id, { offset: clock, duration, reverse });
    enters[leaf] ??= clock;
    clock += duration;
  }
  const period = clock;
  // Stems and dew-bearing veins: light leaves the heart as the running line enters their leaf.
  const veins: Record<Leaf, number> = { bud: 0, crown: 0, left: 0, right: 0 };
  const touched = (id: string) => DEW.filter(drop => drop.vein === id);
  for (const stroke of STROKES) {
    if (stroke.role === "margin") continue;
    const carriesDew = touched(stroke.id).length > 0;
    // A line beyond a drop lights up once the light has rounded that drop.
    const dropBefore = stroke.after ? touched(stroke.after)[0] : undefined;
    const before = dropBefore ? ripples.get(dropBefore.id) : undefined;
    // Veins that neither reach a drop nor continue past one stay quiet.
    if (stroke.role === "vein" && !carriesDew && !before) continue;
    const offset = before ? before.offset + ROUND_DROP
      : enters[stroke.leaf]! + (stroke.role === "vein" ? 0.18 + veins[stroke.leaf]++ * 0.12 : 0);
    const duration = stroke.role === "midrib" ? clamp(stroke.length / STEM_SPEED, 0.3, 1) : clamp(stroke.length / VEIN_SPEED, 0.3, 0.75);
    pulses.set(stroke.id, { offset, duration });
    // The drop answers at the moment the head has covered `at` of the line.
    for (const drop of touched(stroke.id)) ripples.set(drop.id, { offset: offset + duration * runTo(drop.at), ...RIPPLE });
  }
  // The bud's own drop answers as the line sets off around the crown.
  for (const drop of DEW) if (!drop.vein) ripples.set(drop.id, { offset: 0.12, ...RIPPLE });
  return { pulses, ripples, period };
}
const LOOP = loop();
export const LOOP_PULSES: ReadonlyMap<string, Pulse> = LOOP.pulses;
export const LOOP_RIPPLES: ReadonlyMap<string, Ripple> = LOOP.ripples;
/** One circuit of all three leaves. */
export const PERIOD = LOOP.period;
/** How long the flowing colour takes to appear once the loop begins. */
export const FLOW_FADE = 0.6;

/** Seconds since the beat at `offset` last began, or -1 if it has not begun yet.
 * The loop clock runs on past SETTLED without wrapping, so a beat near the end
 * of a period carries over into the next one, but never appears before its
 * first turn. */
export function sinceBeat(time: number, offset: number) {
  const elapsed = time - SETTLED - offset;
  return elapsed < 0 ? -1 : elapsed % PERIOD;
}
