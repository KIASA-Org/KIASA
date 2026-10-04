import type { ReactNode } from "react";

/** The drawings on the light and dark cards. Each is a small line illustration in
 * the manner of the leaf: one ink, a little green, a drop of dew. They are
 * generated from fixed numbers, so the server and the browser draw the same lines. */

const round = (value: number) => Math.round(value * 10) / 10;
type Point = readonly [number, number];
const line = (points: readonly Point[]) => points.map(([x, y], i) => `${i ? "L" : "M"}${round(x)} ${round(y)}`).join("");
/** A smooth path through the points (Catmull-Rom, written as cubic Béziers). */
function curve(points: readonly Point[], closed = false) {
  const n = points.length;
  const at = (i: number) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const before = at(i - 1), from = at(i), to = at(i + 1), after = at(i + 2);
    d += `C${round(from[0] + (to[0] - before[0]) / 6)} ${round(from[1] + (to[1] - before[1]) / 6)} ${round(to[0] - (after[0] - from[0]) / 6)} ${round(to[1] - (after[1] - from[1]) / 6)} ${round(to[0])} ${round(to[1])}`;
  }
  return closed ? `${d}Z` : d;
}
/** A dew drop as the leaf draws it: a ring with a short arc where it catches the light. */
function Drop({ x, y, r }: { x: number; y: number; r: number }) {
  const rho = r * 0.56;
  const at = (degrees: number) => `${round(x + rho * Math.cos(degrees * Math.PI / 180))} ${round(y + rho * Math.sin(degrees * Math.PI / 180))}`;
  return <g className="plate-drop">
    <circle cx={x} cy={y} r={r} />
    <path d={`M${at(196)}A${rho} ${rho} 0 0 1 ${at(254)}`} />
  </g>;
}

const WIDTH = 400, HEIGHT = 330;
function Frame({ name, children }: { name: string; children: ReactNode }) {
  return <svg className="plate" data-plate={name} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMax slice"
    fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

/** Layers of ground, each with its own texture, and a seedling whose roots run down through them. */
function Strata() {
  const layers = [
    { base: 122, rise: 9, pace: 0.0125, shift: 0.4, texture: "plate-ground" },
    { base: 166, rise: 12, pace: 0.0102, shift: 2.1, texture: "url(#plate-rules)" },
    { base: 212, rise: 9, pace: 0.0138, shift: 4.0, texture: "plate-leaf" },
    { base: 254, rise: 11, pace: 0.0112, shift: 1.2, texture: "url(#plate-dots)" },
    { base: 296, rise: 8, pace: 0.013, shift: 3.3, texture: "url(#plate-slant)" },
  ];
  const surface = (layer: (typeof layers)[number]): Point[] => Array.from({ length: 23 }, (_, i) => {
    const x = -20 + i * 20;
    return [x, layer.base + layer.rise * Math.sin(x * layer.pace + layer.shift) + layer.rise * 0.35 * Math.sin(x * layer.pace * 2.3 + layer.shift * 1.7)];
  });
  const top = surface(layers[0]);
  const ground = top[11][1]; // where the seedling stands, at x = 200
  return <Frame name="strata">
    {layers.map(layer => {
      const points = surface(layer);
      const paint = layer.texture.startsWith("url") ? { fill: layer.texture } : { className: layer.texture };
      return <g key={layer.base}>
        <path d={`${curve(points)}L${WIDTH + 20} ${HEIGHT + 10}L-20 ${HEIGHT + 10}Z`} className="plate-ground" />
        <path d={`${curve(points)}L${WIDTH + 20} ${HEIGHT + 10}L-20 ${HEIGHT + 10}Z`} {...paint} />
        <path d={curve(points)} className="plate-ink" />
      </g>;
    })}
    {/* Roots first, so they read as running behind nothing: they are the subject. */}
    <g className="plate-ink">
      <path d={`M200 ${ground}C198 ${ground + 34} 206 ${ground + 62} 201 ${ground + 96}S196 ${ground + 150} 203 ${ground + 186}`} />
      <path d={`M200.5 ${ground + 30}C186 ${ground + 44} 170 ${ground + 46} 152 ${ground + 62}S128 ${ground + 92} 104 ${ground + 98}`} />
      <path d={`M202 ${ground + 54}C220 ${ground + 66} 238 ${ground + 70} 254 ${ground + 88}S282 ${ground + 118} 306 ${ground + 122}`} />
      <path d={`M201 ${ground + 104}C188 ${ground + 118} 178 ${ground + 132} 160 ${ground + 142}S134 ${ground + 160} 122 ${ground + 176}`} />
      <path d={`M201.5 ${ground + 132}C214 ${ground + 144} 228 ${ground + 152} 240 ${ground + 168}`} />
      <path d={`M152 ${ground + 62}C146 ${ground + 76} 148 ${ground + 88} 140 ${ground + 100}`} />
      <path d={`M254 ${ground + 88}C262 ${ground + 100} 260 ${ground + 114} 268 ${ground + 126}`} />
    </g>
    {/* The seedling: a short stem and two leaves. */}
    <path d={`M200 ${ground}C200 ${ground - 16} 199 ${ground - 30} 200 ${ground - 46}`} className="plate-ink" />
    <path d={`M200 ${ground - 30}C186 ${ground - 34} 174 ${ground - 46} 170 ${ground - 62}C186 ${ground - 60} 198 ${ground - 48} 200 ${ground - 30}Z`} className="plate-leaf plate-ink" />
    <path d={`M200 ${ground - 44}C212 ${ground - 52} 220 ${ground - 66} 220 ${ground - 82}C206 ${ground - 76} 198 ${ground - 62} 200 ${ground - 44}Z`} className="plate-leaf plate-ink" />
    <Drop x={302} y={58} r={15} />
  </Frame>;
}

/** The rings of a tree, seen from one corner: a year for each line. */
function Rings() {
  const centre: Point = [318, 286];
  const rings = Array.from({ length: 17 }, (_, i) => {
    const radius = 16 + i * 19.5 + (i % 3) * 2.4;
    const points: Point[] = Array.from({ length: 26 }, (_, step) => {
      const angle = (step / 26) * Math.PI * 2;
      const wobble = 1 + 0.028 * Math.sin(3 * angle + i * 0.7) + 0.016 * Math.sin(5 * angle + i * 1.9);
      return [centre[0] + radius * wobble * Math.cos(angle), centre[1] + radius * wobble * Math.sin(angle) * 0.94];
    });
    return { i, d: curve(points, true) };
  });
  const along = (radius: number, degrees: number): Point => [centre[0] + radius * Math.cos(degrees * Math.PI / 180), centre[1] + radius * 0.94 * Math.sin(degrees * Math.PI / 180)];
  const drop = along(206, 208);
  return <Frame name="rings">
    {rings.map(ring => <path key={ring.i} d={ring.d} className={ring.i === 6 ? "plate-ring" : "plate-ink"} />)}
    <circle cx={centre[0]} cy={centre[1]} r="3.5" className="plate-solid" />
    {/* Two checks in the wood, running out from the heart. */}
    <path d={line([along(46, 196), along(118, 201)])} className="plate-ink" />
    <path d={line([along(150, 247), along(232, 243)])} className="plate-ink" />
    <Drop x={drop[0]} y={drop[1]} r={13} />
  </Frame>;
}

/** A field of readings: most are small, and a pattern rises out of them. */
function Matrix() {
  const columns = 13, rows = 9, step = 29;
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const wave = 0.5 + 0.5 * Math.sin(0.56 * column + 0.78 * row - 1.3);
    return { column, row, x: 26 + column * step, y: 62 + row * step, r: round(1.6 + 9.2 * wave ** 2.2), wave };
  });
  // The strongest readings stand out: the first holds a drop of dew, the next three are green.
  const peaks: typeof cells = [];
  for (const cell of [...cells].sort((first, second) => second.wave - first.wave)) {
    if (peaks.length < 4 && peaks.every(peak => Math.hypot(peak.column - cell.column, peak.row - cell.row) > 3.5)) peaks.push(cell);
  }
  return <Frame name="matrix">
    {cells.map(cell => {
      const key = `${cell.column}-${cell.row}`;
      const rank = peaks.indexOf(cell);
      if (rank === 0) return <Drop key={key} x={cell.x} y={cell.y} r={cell.r} />;
      return <circle key={key} cx={cell.x} cy={cell.y} r={cell.r}
        className={rank > 0 ? "plate-leaf plate-ink" : cell.r < 3 ? "plate-solid" : "plate-ink"} />;
    })}
  </Frame>;
}

/** A signal on a dark ground: green where it starts, blue where it ends. */
function Pulse() {
  const count = 15;
  const waves = Array.from({ length: count }, (_, i) => {
    const offset = i - (count - 1) / 2;
    const points: Point[] = Array.from({ length: 29 }, (_, step) => {
      const x = -10 + step * 15;
      // Quiet at both edges, loud in the middle.
      const swell = Math.sin(Math.PI * Math.min(1, Math.max(0, (x + 10) / 420))) ** 1.6;
      return [x, 186 + offset * 6.2 + (58 - Math.abs(offset) * 4.6) * swell * Math.sin(x * 0.0345 + i * 0.33 + 0.8)];
    });
    return { i, d: curve(points), strength: round(1 - Math.abs(offset) / (count / 2 + 1.5)) };
  });
  return <Frame name="pulse">
    <g stroke="url(#plate-light)" filter="url(#plate-glow)" opacity="0.55">
      {waves.filter(wave => wave.i % 3 === 1).map(wave => <path key={wave.i} d={wave.d} strokeWidth="3" strokeOpacity={wave.strength} />)}
    </g>
    <g stroke="url(#plate-light)">
      {waves.map(wave => <path key={wave.i} d={wave.d} strokeWidth="1.3" strokeOpacity={wave.strength} />)}
    </g>
  </Frame>;
}

/** Veins, tone on tone, for the solid green card. */
function Veins() {
  const base: Point = [-24, HEIGHT + 30];
  const veins = Array.from({ length: 9 }, (_, i) => {
    const spread = i / 8;
    const tip: Point = [WIDTH + 40, HEIGHT - 20 - spread * 300];
    const bend: Point = [150 + spread * 40, HEIGHT - 30 - spread * 250];
    return `M${base[0]} ${base[1]}Q${round(bend[0])} ${round(bend[1])} ${tip[0]} ${round(tip[1])}`;
  });
  return <Frame name="veins">
    {veins.map(d => <path key={d} d={d} className="plate-ink" />)}
    <Drop x={286} y={196} r={12} />
  </Frame>;
}

/** A map of a hill: contour lines around two summits, one line traced in green. */
function Contours() {
  const hills = [
    { centre: [262, 128] as Point, loops: 13, step: 17, stretch: 1.25, seed: 0.4 },
    { centre: [86, 262] as Point, loops: 6, step: 15, stretch: 0.9, seed: 2.2 },
  ];
  const loops = hills.flatMap((hill, h) => Array.from({ length: hill.loops }, (_, i) => {
    const radius = 10 + i * hill.step;
    const points: Point[] = Array.from({ length: 30 }, (_, step) => {
      const angle = (step / 30) * Math.PI * 2;
      const wobble = 1 + 0.07 * Math.sin(3 * angle + hill.seed + i * 0.35) + 0.04 * Math.sin(5 * angle + hill.seed * 2 + i * 0.2);
      return [hill.centre[0] + radius * hill.stretch * wobble * Math.cos(angle), hill.centre[1] + radius * wobble * Math.sin(angle) * 0.82];
    });
    return { key: `${h}-${i}`, d: curve(points, true), lit: h === 0 && i === 7 };
  }));
  return <Frame name="contours">
    {loops.map(loop => <path key={loop.key} d={loop.d} className={loop.lit ? "plate-ring" : "plate-ink"} />)}
    <path d="M262 128l-4 7h8z" className="plate-solid" />
    <Drop x={318} y={92} r={11} />
  </Frame>;
}

/** A tree, branching the way a decision does: each fork a choice, a few tips in leaf. */
function Branches() {
  const lines: { d: string; depth: number }[] = [];
  const tips: Point[] = [];
  const grow = (from: Point, angle: number, length: number, depth: number, seed: number) => {
    const to: Point = [from[0] + length * Math.cos(angle), from[1] + length * Math.sin(angle)];
    const bend: Point = [(from[0] + to[0]) / 2 + 6 * Math.sin(seed * 3.1), (from[1] + to[1]) / 2 + 4 * Math.cos(seed * 2.3)];
    lines.push({ d: curve([from, bend, to]), depth });
    if (depth === 6) { tips.push(to); return; }
    const spread = 0.34 + 0.05 * Math.sin(seed * 5.7);
    grow(to, angle - spread, length * 0.76, depth + 1, seed * 1.7 + 0.3);
    grow(to, angle + spread * 0.92, length * 0.72, depth + 1, seed * 1.3 + 0.9);
  };
  grow([200, HEIGHT + 6], -Math.PI / 2, 82, 0, 0.7);
  const leafed = tips.filter((_, i) => i % 9 === 4);
  const dew = tips[Math.floor(tips.length * 0.7)];
  return <Frame name="branches">
    {lines.map(line => <path key={line.d} d={line.d} className="plate-ink" strokeWidth={round(2.6 - line.depth * 0.3)} />)}
    {leafed.map(([x, y]) => <path key={`${x}-${y}`} d={`M${round(x)} ${round(y)}c-9 -3 -14 -12 -14 -22c10 2 16 10 14 22z`} className="plate-leaf plate-ink" />)}
    <Drop x={round(dew[0] + 14)} y={round(dew[1] - 4)} r={10} />
  </Frame>;
}

/** Parallel waves, like a signal or the sea: one runs in green, a drop rides its crest. */
function Waves() {
  const count = 12;
  const waves = Array.from({ length: count }, (_, i) => {
    const points: Point[] = Array.from({ length: 25 }, (_, step) => {
      const x = -20 + step * 18;
      return [x, 52 + i * 22 + 13 * Math.sin(x * 0.024 + i * 0.42) + 5 * Math.sin(x * 0.061 + i * 0.9)];
    });
    return { i, d: curve(points) };
  });
  return <Frame name="waves">
    {waves.map(wave => <path key={wave.i} d={wave.d} className={wave.i === 5 ? "plate-ring" : "plate-ink"} />)}
    <Drop x={248} y={142} r={12} />
  </Frame>;
}

/** Things kept in motion: arcs around a centre, each carrying a small body. */
function Orbit() {
  const centre: Point = [200, 184];
  const arcs = Array.from({ length: 7 }, (_, i) => {
    const rx = 38 + i * 30, ry = rx * 0.52;
    const body = (i * 1.3 + 0.6) % (Math.PI * 2);
    return { i, rx, ry, body: [centre[0] + rx * Math.cos(body), centre[1] + ry * Math.sin(body)] as Point };
  });
  return <Frame name="orbit">
    <g transform={`rotate(-14 ${centre[0]} ${centre[1]})`}>
      {arcs.map(arc => <ellipse key={arc.i} cx={centre[0]} cy={centre[1]} rx={arc.rx} ry={arc.ry} className={arc.i === 3 ? "plate-ring" : "plate-ink"} />)}
      {arcs.filter(arc => arc.i !== 4).map(arc => <circle key={arc.i} cx={round(arc.body[0])} cy={round(arc.body[1])} r={arc.i % 2 ? 4 : 6} className={arc.i === 2 ? "plate-leaf plate-ink" : "plate-solid"} />)}
      <Drop x={round(arcs[4].body[0])} y={round(arcs[4].body[1])} r={11} />
    </g>
    <circle cx={centre[0]} cy={centre[1]} r="14" className="plate-leaf plate-ink" />
  </Frame>;
}

const PLATES = { strata: Strata, rings: Rings, matrix: Matrix, pulse: Pulse, veins: Veins, contours: Contours, branches: Branches, waves: Waves, orbit: Orbit };
export type PlateName = keyof typeof PLATES;
export const isPlate = (name: string): name is PlateName => name in PLATES;

export function Plate({ name }: { name: PlateName }) {
  const Drawing = PLATES[name];
  return <Drawing />;
}

/** The textures and the light the drawings share. Rendered once per page, so a
 * drawing can appear twice (on its card and in the open dialog) without repeating an id. */
export function PlateDefs() {
  return <svg className="plate-defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <pattern id="plate-rules" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M3.5 0v7" className="plate-fine" /></pattern>
      <pattern id="plate-dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1" className="plate-solid" /><circle cx="7.5" cy="7.5" r="1" className="plate-solid" /></pattern>
      <pattern id="plate-slant" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><path d="M0 4h8" className="plate-fine" /></pattern>
      <linearGradient id="plate-light" x1="0" x2={WIDTH} gradientUnits="userSpaceOnUse">
        <stop stopColor="#98ff4d" /><stop offset="0.55" stopColor="#7fe8b0" /><stop offset="1" stopColor="#45c8ff" />
      </linearGradient>
      <filter id="plate-glow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="5" /></filter>
    </defs>
  </svg>;
}
