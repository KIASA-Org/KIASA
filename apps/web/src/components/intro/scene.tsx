"use client";

import { useId } from "react";
import { LazyMotion, domMin, m, useTransform, type MotionValue } from "motion/react";
import { INK, RING, glint, inkWidth } from "./drawing";
import { DEW, ORIGIN, STROKES, VIEW, type DewDrop, type Stroke } from "./geometry";
import {
  DEW_SPANS, LOOP_PULSES, LOOP_RIPPLES, PHASE, SETTLED, STROKE_SPANS,
  along, clamp01, easeInOut, easeOut, progress, runTo, sinceBeat,
} from "./timing";

type Clock = MotionValue<number>;
type SceneProps = {
  /** Scene time in seconds: see timing.ts. */
  clock: Clock;
  /** 0–1 strength of the looping colour. 0 leaves the drawing at rest. */
  flow: MotionValue<number>;
};

/** Light on the leaf: one soft green, the loading bar's, from a faint tail to a bright tip. */
const LEAF = { tip: "#B8EC93", body: "#B8EC93", tail: "#B8EC93" } as const;
/** The same light once it reaches water. */
const WATER = { tip: "#E4F8FF", body: "#45C8FF" } as const;
/** Travelling light is a comet, not a bar: stacked stretches that all end at the
 * head, each shorter than the last, so it brightens smoothly from a long faint
 * tail to its tip. All of it is one colour; only its strength changes, and the
 * stretches are many and each faint, so where one ends and the next begins no
 * step of brightness can be seen. [share of the line, where on the ramp (0 tail,
 * 1 tip), opacity, extra width] */
const RAMP: readonly (readonly [length: number, at: number, opacity: number, extra: number])[] = [
  [0.56, 0, 0.3, 2.6],
  [0.46, 0.15, 0.2, 2.6],
  [0.37, 0.3, 0.2, 2.6],
  [0.29, 0.45, 0.2, 2.5],
  [0.22, 0.6, 0.22, 2.4],
  [0.15, 0.75, 0.24, 2.2],
  [0.09, 0.88, 0.28, 1.8],
  [0.045, 1, 0.4, 0.8],
];
/** A spark at the very tip: a dash so short that, with round caps, it is a dot a little wider than the line. */
const SPARK = { length: 0.004, extra: 3.2, opacity: 0.7 } as const;
const TAIL = RAMP[0][0];
/** How strongly each kind of line carries light, so the three read as one hierarchy. */
const PRESENCE: Record<Stroke["role"], number> = { margin: 1, midrib: 0.88, vein: 0.66 };
/** Where a hidden light is parked, so its attributes stop changing while it is out. */
const PARKED = -9;

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** Blends two hex colours; at either end it returns the exact colour. */
function blend(from: string, to: string, amount: number) {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  const a = channels(from), b = channels(to);
  return `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * amount)).join(", ")})`;
}
/** The comet's colour at `at` along its ramp: tail to body over the first two thirds, body to tip over the last. */
const ramp = (at: number) => (at < 0.66 ? blend(LEAF.tail, LEAF.body, at / 0.66) : blend(LEAF.body, LEAF.tip, (at - 0.66) / 0.34));
const COMET = RAMP.map(([length, at, opacity, extra]) => [length, ramp(at), opacity, extra] as const);

/** Position at fraction `f` along evenly spaced x,y samples. */
function pointAt(points: readonly number[], f: number): [number, number] {
  const segments = points.length / 2 - 1;
  const position = clamp01(f) * segments;
  const i = Math.min(segments - 1, Math.floor(position));
  const t = position - i;
  return [points[2 * i] + (points[2 * i + 2] - points[2 * i]) * t, points[2 * i + 1] + (points[2 * i + 3] - points[2 * i + 1]) * t];
}

/** A small bead of light with a soft, local glow. */
function Bead({ x, y, r, opacity, halo }: { x: MotionValue<number>; y: MotionValue<number>; r: number; opacity: MotionValue<number>; halo: string }) {
  return <m.g stroke="none" style={{ opacity }}>
    <m.circle cx={x} cy={y} r={r * 5.4} fill={halo} />
    <m.circle cx={x} cy={y} r={r} fill={INK} />
  </m.g>;
}

/** The first small light. Its fade-in is CSS so it shows before hydration; the clock only retires it. */
function Seed({ clock, halo }: { clock: Clock; halo: string }) {
  const opacity = useTransform(clock, t => 1 - progress(t, PHASE.margin, PHASE.vein, easeInOut));
  return <m.g className="mark-seed" stroke="none" style={{ opacity }}>
    <circle className="mark-seed-halo" cx={ORIGIN.x} cy={ORIGIN.y} r={96} fill={halo} />
    <circle className="mark-seed-core" cx={ORIGIN.x} cy={ORIGIN.y} r={7} fill={INK} />
  </m.g>;
}

/** One pale line of the artwork, drawn from the plant's heart outward. */
function Line({ stroke, clock }: { stroke: Stroke; clock: Clock }) {
  const span = STROKE_SPANS.get(stroke.id)!;
  const pathLength = useTransform(clock, t => progress(t, span.start, span.end, easeInOut));
  // A zero-length dash with round caps is a dot: keep the line hidden until it starts.
  const opacity = useTransform(clock, t => progress(t, span.start, span.start + 0.08));
  return <m.path d={stroke.d} strokeWidth={inkWidth(stroke)} style={{ pathLength, opacity }} />;
}

/** The bead that leads a stem as it is drawn. A stem interrupted by a dew drop has several parts. */
function StemBead({ parts, clock, halo }: { parts: readonly Stroke[]; clock: Clock; halo: string }) {
  const spans = parts.map(part => STROKE_SPANS.get(part.id)!);
  const first = spans[0], last = spans[spans.length - 1];
  const at = (t: number): [number, number] => {
    let i = 0;
    while (i < parts.length - 1 && t > spans[i].end && t >= spans[i + 1].start) i++;
    if (t > spans[i].end && i < parts.length - 1) {
      // Crossing the gap a dew drop leaves in the line.
      const from = pointAt(parts[i].points!, 1), to = pointAt(parts[i + 1].points!, 0);
      const f = progress(t, spans[i].end, spans[i + 1].start);
      return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
    }
    return pointAt(parts[i].points!, progress(t, spans[i].start, spans[i].end, easeInOut));
  };
  const x = useTransform(clock, t => at(t)[0]);
  const y = useTransform(clock, t => at(t)[1]);
  const opacity = useTransform(clock, t => progress(t, first.start, first.start + 0.12) * (1 - progress(t, last.end - 0.18, last.end + 0.06)));
  return <Bead x={x} y={y} r={8} opacity={opacity} halo={halo} />;
}

/** A dew bead rolls along its vein, then swells into the drop the artwork shows there. */
function Dew({ drop, clock, halo }: { drop: DewDrop; clock: Clock; halo: string }) {
  const span = DEW_SPANS.get(drop.id)!;
  const x = useTransform(clock, t => pointAt(drop.points, progress(t, span.start, span.arrive, easeInOut))[0]);
  const y = useTransform(clock, t => pointAt(drop.points, progress(t, span.start, span.arrive, easeInOut))[1]);
  const bead = useTransform(clock, t => progress(t, span.start, span.start + 0.16) * (1 - progress(t, span.arrive - 0.04, span.arrive + 0.2)));
  const radius = useTransform(clock, t => 8 + (drop.r - 8) * progress(t, span.arrive - 0.06, span.settled, easeOut));
  const outline = useTransform(clock, t => progress(t, span.arrive - 0.06, span.arrive + 0.12));
  const highlight = useTransform(clock, t => progress(t, span.arrive + 0.08, span.settled));
  return <>
    <m.circle cx={drop.x} cy={drop.y} r={radius} strokeWidth={RING} style={{ opacity: outline }} />
    <m.path d={glint(drop)} strokeWidth={RING - 0.3} style={{ opacity: highlight }} />
    <Bead x={x} y={y} r={8.5} opacity={bead} halo={halo} />
  </>;
}

/** Light travelling along a line of the finished drawing. */
function LineLight({ stroke, clock, flow }: { stroke: Stroke } & SceneProps) {
  const pulse = LOOP_PULSES.get(stroke.id)!;
  // The border legs join into one running line, so they keep a steady speed; stems and veins gather speed.
  const steady = stroke.role === "margin";
  // The head enters at one end and the tail leaves past the other, so the light outlives its crossing.
  const lifetime = pulse.duration * (steady ? 1 + TAIL : runTo(1 + TAIL));
  // Where the head is along the line (0–1, and beyond 1 while the tail leaves), or PARKED.
  const head = useTransform(clock, t => {
    const since = sinceBeat(t, pulse.offset);
    if (since < 0 || since > lifetime) return PARKED;
    const run = since / pulse.duration;
    return steady ? run : along(run);
  });
  // The running line leads; stems answer it; fine veins glow more quietly, as they are drawn more finely.
  const presence = PRESENCE[stroke.role];
  const opacity = useTransform([clock, flow], ([t, strength]: number[]) => {
    const since = sinceBeat(t, pulse.offset);
    // Ease the light in as it leaves the heart and out as its tail slips off the end.
    return since < 0 || since > lifetime ? 0 : presence * strength * progress(since, 0, 0.14, easeOut) * (1 - progress(since, lifetime - 0.22, lifetime, easeInOut));
  });
  const width = inkWidth(stroke);
  return <m.g style={{ opacity }}>
    {COMET.map(([length, colour, strength, extra]) =>
      <Stretch key={length} d={stroke.d} head={head} length={length} reverse={pulse.reverse} stroke={colour} strokeOpacity={strength} strokeWidth={width + extra * presence} />)}
    <Stretch d={stroke.d} head={head} length={SPARK.length} reverse={pulse.reverse} stroke={LEAF.tip} strokeOpacity={SPARK.opacity} strokeWidth={width + SPARK.extra * presence} />
  </m.g>;
}

/** One stretch of a comet: the `length` of the line that ends at the head. */
function Stretch({ d, head, length, reverse, ...paint }: {
  d: string; head: MotionValue<number>; length: number; reverse?: boolean; stroke: string; strokeOpacity?: number; strokeWidth: number;
}) {
  // Forward the stretch is [head − length, head]. Running tip-to-base, the head is measured from the far end.
  const pathOffset = useTransform(head, at => (at === PARKED ? PARKED : reverse ? 1 - at : at - length));
  return <m.path d={d} {...paint} style={{ pathLength: length, pathSpacing: 20, pathOffset }} />;
}

/** Where green light touches a drop it turns blue and wraps around the water.
 * The ring's path starts at the touch and the dash is centred on that start
 * (period 1), so the light spreads both ways around the drop. It arrives still
 * green and turns blue as it wraps, so the change of colour is seen, not cut. */
function RingLight({ drop, clock, flow }: { drop: DewDrop } & SceneProps) {
  const ripple = LOOP_RIPPLES.get(drop.id)!;
  const lifetime = ripple.wrap + ripple.hold + ripple.fade;
  const pathLength = useTransform(clock, t => {
    const since = sinceBeat(t, ripple.offset);
    return since < 0 || since > lifetime ? 0 : progress(since, 0, ripple.wrap, easeOut);
  });
  const pathSpacing = useTransform(pathLength, wrapped => 1 - wrapped);
  const pathOffset = useTransform(pathLength, wrapped => -wrapped / 2);
  const stroke = useTransform(pathLength, wrapped => blend(LEAF.body, WATER.body, wrapped / 0.7));
  const opacity = useTransform([clock, flow], ([t, strength]: number[]) => {
    const since = sinceBeat(t, ripple.offset);
    return since < 0 || since > lifetime ? 0 : strength * (1 - progress(since, ripple.wrap + ripple.hold, lifetime, easeInOut));
  });
  // The small arc inside the drop catches the light once the ring has closed.
  const glintOpacity = useTransform(pathLength, wrapped => progress(wrapped, 0.6, 1));
  return <m.g style={{ opacity }}>
    <m.path d={drop.d} strokeWidth={RING + 2.6} style={{ pathLength, pathSpacing, pathOffset, stroke }} />
    {/* A bright core inside the colour, as on the leaf's lines. */}
    <m.path d={drop.d} stroke={WATER.tip} strokeWidth={RING - 1.4} strokeOpacity="0.6" style={{ pathLength, pathSpacing, pathOffset }} />
    <m.path d={glint(drop)} stroke={WATER.tip} strokeWidth={RING + 0.6} style={{ opacity: glintOpacity }} />
  </m.g>;
}

/** The loading bar under the leaf: one solid colour that fills from the left
 * exactly as the leaf is drawn, then stays full and still. It shows the
 * drawing's progress, not an invented percentage. The fill is a full-length
 * pill that slides in, so its leading end stays round at every width. */
function Bar({ clock }: { clock: Clock }) {
  const x = useTransform(clock, t => `${(progress(t, 0, SETTLED) - 1) * 100}%`);
  return <div className="mark-loader" aria-hidden="true">
    <div className="mark-bar">
      <m.div className="mark-bar-fill" style={{ x }} />
    </div>
    {/* Decorative like the bar: the dots are a CSS animation, so they move before
        hydration and stop for reduced motion. Real loading is announced elsewhere. */}
    <span className="mark-label">Loading<span className="mark-dots"><span>.</span><span>.</span><span>.</span></span></span>
  </div>;
}

/** The whole animation as a pure function of its clock: no per-frame React state,
 * and any frame can be reproduced by setting the clock. Rendered at SETTLED with
 * no flow it is the finished, still drawing over a full bar. */
export function MarkScene({ clock, flow }: SceneProps) {
  const halo = `halo-${useId().replaceAll(":", "")}`;
  const stems = (["crown", "left", "right"] as const).map(leaf => STROKES.filter(stroke => stroke.leaf === leaf && stroke.role === "midrib"));
  return <LazyMotion features={domMin} strict><div className="mark-group">
    <svg className="mark" viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}`} fill="none" stroke={INK}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-scene>
      <defs>
        <radialGradient id={halo}>
          <stop stopColor={INK} stopOpacity="0.62" />
          <stop offset="0.3" stopColor={INK} stopOpacity="0.2" />
          <stop offset="1" stopColor={INK} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="mark-lines">
        {STROKES.map(stroke => <Line key={stroke.id} stroke={stroke} clock={clock} />)}
        {DEW.map(drop => <Dew key={drop.id} drop={drop} clock={clock} halo={`url(#${halo})`} />)}
        {stems.map(parts => <StemBead key={parts[0].id} parts={parts} clock={clock} halo={`url(#${halo})`} />)}
        <g className="mark-flow">
          {STROKES.filter(stroke => LOOP_PULSES.has(stroke.id)).map(stroke => <LineLight key={stroke.id} stroke={stroke} clock={clock} flow={flow} />)}
        </g>
        <g className="mark-water">
          {DEW.map(drop => <RingLight key={drop.id} drop={drop} clock={clock} flow={flow} />)}
        </g>
      </g>
      <Seed clock={clock} halo={`url(#${halo})`} />
    </svg>
    <Bar clock={clock} />
  </div></LazyMotion>;
}
