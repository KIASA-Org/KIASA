"use client";

import { useEffect, useRef } from "react";

/** The hero's background: the inside of a leaf far larger than the page. Its
 * parallel veins sweep from a base below the hero to a tip beyond the top right
 * corner; a few carry a small green light, and where a light passes a dew drop
 * the drop turns blue for a moment. The same language as the loading mark, drawn
 * as plain SVG. The lights are moved by CSS; the veins ripple gently out of their
 * shape, as a leaf does in a light wind, by a few lines of script that stop for
 * reduced motion, pause with the hero's button and sleep while the hero is off screen.
 */

type Point = readonly [number, number];
/** A point on a vein and the unit normal to the vein there. */
type Frame = { x: number; y: number; nx: number; ny: number };

const WIDTH = 1600, HEIGHT = 900;
// The blade's midrib: a single curve from its base, bending low and right, to its tip.
const BASE: Point = [240, 1260], BEND: Point = [1270, 770], TIP: Point = [1930, -330];
/** Half the blade's width at its widest. */
const HALF = 590;
const VEINS = 27;
const SAMPLES = 16;
/** The stretch of each vein that can be seen, with a little to spare at both ends. */
const FROM = 0.1, TO = 0.93;
/** How far past its end a light's head travels, so its tail leaves too. */
const OVERRUN = 0.25;

/** The wind: two slow waves running along the veins, each sweeping across the
 * blade at its own angle, so no two veins bend alike. [height in viewBox units,
 * waves along a vein, seconds per cycle, phase across the blade] A positive
 * period runs the wave toward the tip, a negative one back toward the base. */
const WAVES: readonly (readonly [height: number, along: number, period: number, across: number])[] = [
  [10, 1.15, 7.5, 0.9],
  [5, 0.55, -12, -1.4],
];

const round = (value: number) => Math.round(value * 10) / 10;
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A point on vein `u` (−1 and 1 are the blade's two edges, 0 its midrib) at `t` along it, and the vein's normal there. */
function veinFrame(u: number, t: number): Frame {
  const centre = lerp(lerp(BASE, BEND, t), lerp(BEND, TIP, t), t);
  const dx = 2 * ((1 - t) * (BEND[0] - BASE[0]) + t * (TIP[0] - BEND[0]));
  const dy = 2 * ((1 - t) * (BEND[1] - BASE[1]) + t * (TIP[1] - BEND[1]));
  const length = Math.hypot(dx, dy);
  const nx = -dy / length, ny = dx / length;
  // A lens: no width at base and tip, full width between.
  const reach = u * HALF * Math.sin(Math.PI * t) ** 0.9;
  return { x: centre[0] + nx * reach, y: centre[1] + ny * reach, nx, ny };
}
const veinPoint = (u: number, t: number): Point => { const f = veinFrame(u, t); return [f.x, f.y]; };

/** How far the wind lifts vein `u` off its line at `t`, `time` seconds in. The
 * ends of the visible stretch stay put, so the base and the tip never move. */
function lift(u: number, t: number, time: number) {
  const hold = Math.sin((Math.PI * (t - FROM)) / (TO - FROM));
  let sum = 0;
  for (const [height, along, period, across] of WAVES) sum += height * Math.sin(2 * Math.PI * (along * t - time / period) + across * u);
  return hold * sum;
}

/** A smooth path through the points (Catmull-Rom, written as cubic Béziers). */
function smooth(points: readonly Point[]) {
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const before = points[Math.max(0, i - 1)], from = points[i], to = points[i + 1], after = points[Math.min(points.length - 1, i + 2)];
    d += `C${round(from[0] + (to[0] - before[0]) / 6)} ${round(from[1] + (to[1] - before[1]) / 6)} ${round(to[0] - (after[0] - from[0]) / 6)} ${round(to[1] - (after[1] - from[1]) / 6)} ${round(to[0])} ${round(to[1])}`;
  }
  return d;
}

const STEPS = Array.from({ length: SAMPLES + 1 }, (_, step) => FROM + ((TO - FROM) * step) / SAMPLES);

const veins = Array.from({ length: VEINS }, (_, index) => {
  const u = (index / (VEINS - 1)) * 2 - 1;
  const frames = STEPS.map(t => veinFrame(u, t));
  const points = frames.map((frame): Point => [frame.x, frame.y]);
  const role = index === 0 || index === VEINS - 1 ? "edge" : index === (VEINS - 1) / 2 ? "midrib" : "vein";
  return { u, frames, d: smooth(points), role };
});

/** The vein's path with the wind on it at `time`. */
function windswept(vein: (typeof veins)[number], time: number) {
  return smooth(vein.frames.map((frame, step): Point => {
    const away = lift(vein.u, STEPS[step], time);
    return [frame.x + frame.nx * away, frame.y + frame.ny * away];
  }));
}

/** How far along a vein's visible stretch (0–1, by length) the point at `t` lies. */
function lengthFraction(u: number, t: number) {
  const steps = 120;
  let total = 0, upTo = 0, previous = veinPoint(u, FROM);
  for (let step = 1; step <= steps; step++) {
    const at = FROM + ((TO - FROM) * step) / steps;
    const point = veinPoint(u, at);
    total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    if (at <= t) upTo = total;
    previous = point;
  }
  return upTo / total;
}

/** The veins that carry a light: [vein, seconds for one run, seconds into its run at first paint]. */
const LIGHTS: readonly (readonly [vein: number, seconds: number, elapsed: number])[] = [
  [3, 15, 4.4], [7, 12, 9.8], [10, 17, 1.2], [13, 13, 6.6], [16, 16, 12.5], [19, 12.5, 3.1], [22, 18, 9.2], [25, 14, 0.4],
];
/** Dew drops resting on lit veins: [vein, where along it, radius]. */
const DROPS: readonly (readonly [vein: number, t: number, r: number])[] = [
  [7, 0.44, 9], [10, 0.71, 6.5], [13, 0.56, 11], [16, 0.38, 7], [19, 0.66, 8.5], [22, 0.52, 6], [25, 0.6, 7.5],
];
/** A light: stacked stretches that end at the same head, each shorter and brighter. [share of the vein, class] */
const COMET = [[0.17, "tail"], [0.085, "body"], [0.02, "tip"]] as const;

const drops = DROPS.map(([vein, t, r]) => {
  const frame = veinFrame(veins[vein].u, t);
  const light = LIGHTS.find(([lit]) => lit === vein)!;
  // The moment in its run that the vein's light reaches this drop.
  const reach = (lengthFraction(veins[vein].u, t) / (1 + OVERRUN)) * light[1];
  const rho = r * 0.56;
  const at = (degrees: number) => `${round(frame.x + rho * Math.cos(degrees * Math.PI / 180))} ${round(frame.y + rho * Math.sin(degrees * Math.PI / 180))}`;
  return { vein, t, frame, x: round(frame.x), y: round(frame.y), r, seconds: light[1], delay: round(reach - light[2]), glint: `M${at(196)}A${rho} ${rho} 0 0 1 ${at(254)}` };
});

/** Bends the veins with the wind, frame by frame, while there is anything to see. */
function useWind(ref: React.RefObject<SVGSVGElement | null>) {
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const hero = svg.closest(".hero");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Every path drawn along a vein: its line and the stretches of its light.
    const paths = veins.map((_, index) => Array.from(svg.querySelectorAll<SVGPathElement>(`[data-vein="${index}"]`)));
    const rings = Array.from(svg.querySelectorAll<SVGGElement>("[data-drop]"));
    let frame = 0, seen = true;
    const running = () => seen && !reduce.matches && !hero?.hasAttribute("data-paused");
    const draw = (now: number) => {
      frame = 0;
      if (!running()) return;
      const time = now / 1000;
      veins.forEach((vein, index) => {
        const d = windswept(vein, time);
        for (const path of paths[index]) path.setAttribute("d", d);
      });
      rings.forEach((ring, index) => {
        const { vein, t, frame: at } = drops[index];
        const away = lift(veins[vein].u, t, time);
        ring.setAttribute("transform", `translate(${round(at.nx * away)} ${round(at.ny * away)})`);
      });
      frame = requestAnimationFrame(draw);
    };
    const settle = () => {
      if (frame || !running()) {
        // With motion reduced the drawing returns to its still shape; paused, it holds where it is.
        if (reduce.matches) {
          veins.forEach((vein, index) => { for (const path of paths[index]) path.setAttribute("d", vein.d); });
          for (const ring of rings) ring.removeAttribute("transform");
        }
        return;
      }
      frame = requestAnimationFrame(draw);
    };
    const watcher = new IntersectionObserver(([entry]) => { seen = entry.isIntersecting; settle(); });
    watcher.observe(svg);
    const pauses = new MutationObserver(settle);
    if (hero) pauses.observe(hero, { attributes: true, attributeFilter: ["data-paused"] });
    reduce.addEventListener("change", settle);
    settle();
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      pauses.disconnect();
      reduce.removeEventListener("change", settle);
    };
  }, [ref]);
}

export function HeroField() {
  const svg = useRef<SVGSVGElement>(null);
  useWind(svg);
  return <div className="hero-field" aria-hidden="true">
    <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMaxYMin slice" fill="none" focusable="false">
      <g className="hero-veins">
        {veins.map((vein, index) => <path key={vein.u} d={vein.d} data-role={vein.role} data-vein={index} />)}
      </g>
      <g className="hero-lights" strokeLinecap="round">
        {LIGHTS.map(([vein, seconds, elapsed]) => <g key={vein} style={{ "--run": `${seconds}s`, "--from": `${-elapsed}s` } as React.CSSProperties}>
          {COMET.map(([share, part]) => <path key={part} d={veins[vein].d} pathLength={1} data-part={part} data-vein={vein} style={{ "--share": share } as React.CSSProperties} />)}
        </g>)}
      </g>
      <g className="hero-drops">
        {drops.map(drop => <g key={`${drop.x}-${drop.y}`} data-drop style={{ "--run": `${drop.seconds}s`, "--from": `${drop.delay}s` } as React.CSSProperties}>
          <circle cx={drop.x} cy={drop.y} r={drop.r} />
          <path d={drop.glint} />
        </g>)}
      </g>
    </svg>
  </div>;
}
