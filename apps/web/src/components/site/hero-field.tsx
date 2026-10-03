/** The hero's background: the inside of a leaf far larger than the page. Its
 * parallel veins sweep from a base below the hero to a tip beyond the top right
 * corner; a few carry a small green light, and where a light passes a dew drop
 * the drop turns blue for a moment. The same language as the loading mark, drawn
 * as plain SVG and moved by CSS, so it costs no script and stops for reduced motion.
 */

type Point = readonly [number, number];

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

const round = (value: number) => Math.round(value * 10) / 10;
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A point on vein `u` (−1 and 1 are the blade's two edges, 0 its midrib) at `t` along it. */
function veinPoint(u: number, t: number): Point {
  const centre = lerp(lerp(BASE, BEND, t), lerp(BEND, TIP, t), t);
  const dx = 2 * ((1 - t) * (BEND[0] - BASE[0]) + t * (TIP[0] - BEND[0]));
  const dy = 2 * ((1 - t) * (BEND[1] - BASE[1]) + t * (TIP[1] - BEND[1]));
  const length = Math.hypot(dx, dy);
  // A lens: no width at base and tip, full width between.
  const reach = u * HALF * Math.sin(Math.PI * t) ** 0.9;
  return [centre[0] - (dy / length) * reach, centre[1] + (dx / length) * reach];
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

const veins = Array.from({ length: VEINS }, (_, index) => {
  const u = (index / (VEINS - 1)) * 2 - 1;
  const points = Array.from({ length: SAMPLES + 1 }, (_, step) => veinPoint(u, FROM + ((TO - FROM) * step) / SAMPLES));
  const role = index === 0 || index === VEINS - 1 ? "edge" : index === (VEINS - 1) / 2 ? "midrib" : "vein";
  return { u, points, d: smooth(points), role };
});

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
  const [x, y] = veinPoint(veins[vein].u, t);
  const light = LIGHTS.find(([lit]) => lit === vein)!;
  // The moment in its run that the vein's light reaches this drop.
  const reach = (lengthFraction(veins[vein].u, t) / (1 + OVERRUN)) * light[1];
  const rho = r * 0.56;
  const at = (degrees: number) => `${round(x + rho * Math.cos(degrees * Math.PI / 180))} ${round(y + rho * Math.sin(degrees * Math.PI / 180))}`;
  return { x: round(x), y: round(y), r, seconds: light[1], delay: round(reach - light[2]), glint: `M${at(196)}A${rho} ${rho} 0 0 1 ${at(254)}` };
});

export function HeroField() {
  return <div className="hero-field" aria-hidden="true">
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMaxYMin slice" fill="none" focusable="false">
      <g className="hero-veins">
        {veins.map(vein => <path key={vein.u} d={vein.d} data-role={vein.role} />)}
      </g>
      <g className="hero-lights" strokeLinecap="round">
        {LIGHTS.map(([vein, seconds, elapsed]) => <g key={vein} style={{ "--run": `${seconds}s`, "--from": `${-elapsed}s` } as React.CSSProperties}>
          {COMET.map(([share, part]) => <path key={part} d={veins[vein].d} pathLength={1} data-part={part} style={{ "--share": share } as React.CSSProperties} />)}
        </g>)}
      </g>
      <g className="hero-drops">
        {drops.map(drop => <g key={`${drop.x}-${drop.y}`} style={{ "--run": `${drop.seconds}s`, "--from": `${drop.delay}s` } as React.CSSProperties}>
          <circle cx={drop.x} cy={drop.y} r={drop.r} />
          <path d={drop.glint} />
        </g>)}
      </g>
    </svg>
  </div>;
}
