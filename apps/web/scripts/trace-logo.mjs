// Measures the KIASA leaf in public/brand/kiasa-logo.png and writes
// src/components/intro/geometry.ts: the line drawing the startup animation makes.
// A PNG has no vector paths, so they are recovered from its pixels:
//
//   stems, borders, veins   centrelines of the logo's own pale lines (thinned blue channel)
//   bud                     its pale left edge plus the boundary of its light body
//   dew                     measured circles, the vein each bead rolls along, and
//                           where the line that reaches a drop touches it
//
// It also writes src/app/icon.png, a small favicon cut from the same artwork.
//
// Usage: node scripts/trace-logo.mjs [--debug <dir>]   (--debug writes overlay PNGs)
// Re-run after replacing the logo, then re-check the tables below against the overlays.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "public/brand/kiasa-logo.png");
const OUTPUT = path.join(ROOT, "src/components/intro/geometry.ts");
const ICON = path.join(ROOT, "src/app/icon.png");
const debugDir = process.argv.includes("--debug") ? process.argv[process.argv.indexOf("--debug") + 1] : null;

/** Where the three leaves and the bud meet: the first light appears here. */
const ORIGIN = [640, 746];

/** Dew drops, measured on the artwork: [id, cx, cy, r, lines the bead rolls along]. */
const DROPS = [
  ["crown-a", 603.5, 376.5, 24.5, ["crown-vein-l1a"]],
  ["crown-b", 694.5, 437.5, 16.5, ["crown-vein-r1a"]],
  ["crown-c", 587.5, 524.5, 17, ["crown-vein-l2a"]],
  ["bud", 669, 641, 11.5, []],
  ["left-a", 480.5, 716.5, 32, ["left-vein-u2a"]],
  ["left-b", 358.5, 788.5, 18, ["left-vein-u2a", "left-vein-u2b"]],
  ["right-a", 798, 754.5, 23, ["right-midrib-a"]],
  ["right-b", 877.5, 847.5, 16, ["right-vein-d1"]],
];

/** Named pale lines: [id, leaf, role, approximate start, continues]. Within a
 * leaf and role the listed order is the drawing order (innermost veins first,
 * alternating sides). A line interrupted by a dew drop is listed as parts a, b;
 * `continues` names the earlier part so the two are drawn as one gesture. */
const LINES = [
  ["crown-midrib", "crown", "midrib", [645, 639]],
  ["left-midrib", "left", "midrib", [596, 725]],
  ["right-midrib-a", "right", "midrib", [698, 743]],
  ["right-midrib-b", "right", "midrib", [800, 781], "right-midrib-a"],
  ["bud-edge-l", "bud", "margin", [632, 725]],
  ["crown-margin-l", "crown", "margin", [616, 638]],
  ["crown-margin-r", "crown", "margin", [696, 658]],
  ["left-margin-u", "left", "margin", [616, 701]],
  ["left-margin-d", "left", "margin", [634, 743]],
  ["right-margin-u", "right", "margin", [693, 715]],
  ["right-margin-d", "right", "margin", [648, 759]],
  ["crown-vein-l1a", "crown", "vein", [647, 623]],
  ["crown-vein-l1b", "crown", "vein", [604, 348], "crown-vein-l1a"],
  ["crown-vein-r1a", "crown", "vein", [661, 605]],
  ["crown-vein-r1b", "crown", "vein", [686, 418], "crown-vein-r1a"],
  ["crown-vein-l2a", "crown", "vein", [615, 606]],
  ["crown-vein-l2b", "crown", "vein", [578, 506], "crown-vein-l2a"],
  ["crown-vein-r2", "crown", "vein", [704, 572]],
  ["left-vein-u2a", "left", "vein", [584, 704]],
  ["left-vein-u2b", "left", "vein", [446, 713], "left-vein-u2a"],
  ["left-vein-d1", "left", "vein", [590, 731]],
  ["left-vein-u1", "left", "vein", [550, 668]],
  ["left-vein-d2", "left", "vein", [504, 762]],
  ["left-vein-u3", "left", "vein", [452, 736]],
  ["left-vein-d3", "left", "vein", [575, 754]],
  ["right-vein-d1", "right", "vein", [708, 751]],
  ["right-vein-u2", "right", "vein", [828, 766]],
  ["right-vein-u1a", "right", "vein", [735, 723]],
  ["right-vein-u1b", "right", "vein", [848, 756], "right-vein-u1a"],
  ["right-vein-d2", "right", "vein", [744, 797]],
];

// ---------------------------------------------------------------- raster helpers

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** Zhang–Suen thinning of a 0/1 mask to one-pixel centrelines. */
function thin(mask, W, H) {
  const img = Uint8Array.from(mask);
  for (let changed = true; changed;) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!img[i]) continue;
        const p2 = img[i - W], p3 = img[i - W + 1], p4 = img[i + 1], p5 = img[i + W + 1];
        const p6 = img[i + W], p7 = img[i + W - 1], p8 = img[i - 1], p9 = img[i - W - 1];
        const neighbours = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (neighbours < 2 || neighbours > 6) continue;
        const transitions = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (transitions !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        remove.push(i);
      }
      if (remove.length) { changed = true; for (const i of remove) img[i] = 0; }
    }
  }
  return img;
}

/** Splits a skeleton into pixel chains that each run outward from the plant's heart. */
function traceChains(skeleton, W, minLength) {
  const seen = new Uint8Array(skeleton.length);
  const chains = [];
  for (let seed = 0; seed < skeleton.length; seed++) {
    if (!skeleton[seed] || seen[seed]) continue;
    const pixels = [];
    const stack = [seed];
    seen[seed] = 1;
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      for (const [dx, dy] of N8) { const q = p + dy * W + dx; if (skeleton[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    if (pixels.length < minLength) continue;
    const member = new Set(pixels);
    const degree = p => N8.reduce((n, [dx, dy]) => n + (member.has(p + dy * W + dx) ? 1 : 0), 0);
    const fromOrigin = p => Math.hypot(p % W - ORIGIN[0], Math.floor(p / W) - ORIGIN[1]);
    const ends = pixels.filter(p => degree(p) === 1);
    if (!ends.length) continue;
    const root = ends.reduce((a, b) => (fromOrigin(a) <= fromOrigin(b) ? a : b));
    // Shortest-path tree from the root; every other end becomes a branch tip.
    const distance = new Map([[root, 0]]);
    const parent = new Map();
    const queue = [root];
    while (queue.length) {
      const p = queue.shift();
      for (const [dx, dy] of N8) {
        const q = p + dy * W + dx;
        if (!member.has(q)) continue;
        const d = distance.get(p) + (dx && dy ? Math.SQRT2 : 1);
        if (!distance.has(q) || d < distance.get(q) - 1e-9) { distance.set(q, d); parent.set(q, p); queue.push(q); }
      }
    }
    const covered = new Set();
    for (const tip of ends.filter(e => e !== root).sort((a, b) => distance.get(b) - distance.get(a))) {
      const chain = [];
      let p = tip;
      while (p !== undefined && !covered.has(p)) { chain.push(p); p = parent.get(p); }
      if (p !== undefined) chain.push(p);
      chain.reverse();
      if (distance.get(tip) - distance.get(chain[0]) < minLength) continue;
      chain.forEach(c => covered.add(c));
      // +0.5: pixel centres in the SVG's user space.
      chains.push(chain.map(c => [c % W + 0.5, Math.floor(c / W) + 0.5]));
    }
  }
  return chains;
}

// ---------------------------------------------------------------- polyline helpers

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = a => { const n = Math.hypot(a[0], a[1]) || 1; return [a[0] / n, a[1] / n]; };
const lengthOf = pts => pts.reduce((n, p, i) => (i ? n + gap(p, pts[i - 1]) : 0), 0);
const nearestIndex = (pts, target) => pts.reduce((best, p, i) => (gap(p, target) < gap(pts[best], target) ? i : best), 0);

function smooth(pts, radius, passes) {
  let current = pts;
  const n = pts.length;
  for (let pass = 0; pass < passes; pass++) {
    current = current.map((p, i) => {
      if (i === 0 || i === n - 1) return p;
      let x = 0, y = 0, count = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) { x += current[j][0]; y += current[j][1]; count++; }
      return [x / count, y / count];
    });
  }
  return current;
}

/** Points every `step` along a polyline, always including both ends. */
function resample(pts, step) {
  const out = [pts[0]];
  let carried = 0;
  for (let i = 1; i < pts.length; i++) {
    let from = pts[i - 1];
    let segment = gap(from, pts[i]);
    while (carried + segment >= step) {
      const t = (step - carried) / segment;
      from = [from[0] + (pts[i][0] - from[0]) * t, from[1] + (pts[i][1] - from[1]) * t];
      out.push(from);
      segment = gap(from, pts[i]);
      carried = 0;
    }
    carried += segment;
  }
  const last = pts[pts.length - 1];
  if (gap(out[out.length - 1], last) > step * 0.4) out.push(last); else out[out.length - 1] = last;
  return out;
}

/** Exactly evenly spaced points (about `step` apart), so a fraction of the samples
 * is the same fraction of the path's length. */
function resampleEven(pts, step) {
  const total = lengthOf(pts);
  const count = Math.max(1, Math.round(total / step));
  const out = [pts[0]];
  let walked = 0, i = 1;
  for (let k = 1; k < count; k++) {
    const target = (total * k) / count;
    while (walked + gap(pts[i - 1], pts[i]) < target) { walked += gap(pts[i - 1], pts[i]); i++; }
    const t = (target - walked) / gap(pts[i - 1], pts[i]);
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------------------------------------------------------------- curve fitting
// Schneider, "An Algorithm for Automatically Fitting Digitized Curves" (Graphics Gems).

const bezier = (b, t) => {
  const m = 1 - t;
  return [0, 1].map(k => m * m * m * b[0][k] + 3 * m * m * t * b[1][k] + 3 * m * t * t * b[2][k] + t * t * t * b[3][k]);
};
const bezierD1 = (b, t) => {
  const m = 1 - t;
  return [0, 1].map(k => 3 * m * m * (b[1][k] - b[0][k]) + 6 * m * t * (b[2][k] - b[1][k]) + 3 * t * t * (b[3][k] - b[2][k]));
};
const bezierD2 = (b, t) => [0, 1].map(k => 6 * (1 - t) * (b[2][k] - 2 * b[1][k] + b[0][k]) + 6 * t * (b[3][k] - 2 * b[2][k] + b[1][k]));

function chordParameters(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + gap(pts[i], pts[i - 1]));
  return u.map(v => v / u[u.length - 1]);
}

function leastSquaresBezier(pts, u, tangentIn, tangentOut) {
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], m = 1 - t;
    const b0 = m * m * m, b1 = 3 * m * m * t, b2 = 3 * m * t * t, b3 = t * t * t;
    const a1 = scale(tangentIn, b1), a2 = scale(tangentOut, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const rest = sub(pts[i], add(scale(first, b0 + b1), scale(last, b2 + b3)));
    x0 += dot(a1, rest); x1 += dot(a2, rest);
  }
  const det = c00 * c11 - c01 * c01;
  const alpha1 = det ? (x0 * c11 - x1 * c01) / det : 0;
  const alpha2 = det ? (c00 * x1 - c01 * x0) / det : 0;
  const chord = gap(first, last);
  if (alpha1 < 1e-6 * chord || alpha2 < 1e-6 * chord) {
    return [first, add(first, scale(tangentIn, chord / 3)), add(last, scale(tangentOut, chord / 3)), last];
  }
  return [first, add(first, scale(tangentIn, alpha1)), add(last, scale(tangentOut, alpha2)), last];
}

function worstPoint(pts, b, u) {
  let worst = 0, index = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = sub(bezier(b, u[i]), pts[i]);
    const squared = dot(d, d);
    if (squared >= worst) { worst = squared; index = i; }
  }
  return [worst, index];
}

function fitCubic(pts, tangentIn, tangentOut, tolerance) {
  if (pts.length === 2) {
    const third = gap(pts[0], pts[1]) / 3;
    return [[pts[0], add(pts[0], scale(tangentIn, third)), add(pts[1], scale(tangentOut, third)), pts[1]]];
  }
  let u = chordParameters(pts);
  let curve = leastSquaresBezier(pts, u, tangentIn, tangentOut);
  let [error, split] = worstPoint(pts, curve, u);
  const limit = tolerance * tolerance;
  if (error < limit) return [curve];
  if (error < limit * 16) {
    for (let i = 0; i < 24; i++) {
      // Newton–Raphson: move each parameter towards its point's foot on the curve.
      u = u.map((t, k) => {
        const d = sub(bezier(curve, t), pts[k]), d1 = bezierD1(curve, t), d2 = bezierD2(curve, t);
        const denominator = dot(d1, d1) + dot(d, d2);
        return denominator ? Math.min(1, Math.max(0, t - dot(d, d1) / denominator)) : t;
      });
      curve = leastSquaresBezier(pts, u, tangentIn, tangentOut);
      [error, split] = worstPoint(pts, curve, u);
      if (error < limit) return [curve];
    }
  }
  const centre = unit(sub(pts[Math.max(0, split - 1)], pts[Math.min(pts.length - 1, split + 1)]));
  return [
    ...fitCubic(pts.slice(0, split + 1), tangentIn, centre, tolerance),
    ...fitCubic(pts.slice(split), scale(centre, -1), tangentOut, tolerance),
  ];
}

/** Open polyline → cubic Béziers within `tolerance` px. */
function fit(pts, tolerance) {
  const reach = Math.min(3, pts.length - 1);
  return fitCubic(pts, unit(sub(pts[reach], pts[0])), unit(sub(pts[pts.length - 1 - reach], pts[pts.length - 1])), tolerance);
}

const round = v => String(Math.round(v * 10) / 10);
const toPath = curves =>
  `M${round(curves[0][0][0])} ${round(curves[0][0][1])}` +
  curves.map(c => `C${round(c[1][0])} ${round(c[1][1])} ${round(c[2][0])} ${round(c[2][1])} ${round(c[3][0])} ${round(c[3][1])}`).join("");
/** Dense samples along fitted curves: used for lengths and bead positions. */
const flatten = (curves, perCurve = 24) =>
  curves.flatMap((c, k) => Array.from({ length: perCurve + (k === curves.length - 1 ? 1 : 0) }, (_, i) => bezier(c, i / perCurve)));

// ---------------------------------------------------------------- measure

const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
if (W !== 1200 || H !== 1200) throw new Error(`Expected a 1200 × 1200 logo, found ${W} × ${H}.`);
const alpha = (x, y) => data[(y * W + x) * 4 + 3];
const channel = (x, y, c) => data[(y * W + x) * 4 + c];

// The plant is the largest connected alpha region; the wordmark letters are the others.
const label = new Int32Array(W * H);
const regions = [];
for (let seed = 0; seed < W * H; seed++) {
  if (label[seed] || data[seed * 4 + 3] < 128) continue;
  const id = regions.length + 1;
  const region = { id, area: 0, box: [W, H, 0, 0] };
  const stack = [seed];
  label[seed] = id;
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p - x) / W;
    region.area++;
    region.box = [Math.min(region.box[0], x), Math.min(region.box[1], y), Math.max(region.box[2], x), Math.max(region.box[3], y)];
    for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && !label[q] && data[q * 4 + 3] >= 128) { label[q] = id; stack.push(q); }
  }
  regions.push(region);
}
const plant = regions.reduce((a, b) => (b.area > a.area ? b : a));

// --- pale lines. Veins are near-white on green, so the blue channel isolates them.
const PALE = 84;
const pale = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (label[i] === plant.id && data[i * 4 + 2] > PALE) pale[i] = 1;
for (const [, cx, cy, r] of DROPS) {
  for (let y = Math.floor(cy - r - 3); y <= cy + r + 3; y++) for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + 2) pale[y * W + x] = 0;
  }
}
/** Paleness at a fractional position (bilinear), 0–1. */
const paleness = (x, y) => {
  const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const at = (px, py) => (label[py * W + px] === plant.id ? channel(px, py, 2) / 255 : 0);
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
};
/** Optical thickness of a line: its brightness integrated across the centreline. */
function opticalWidth(chain) {
  const widths = [];
  for (let i = 5; i < chain.length - 5; i += 3) {
    const tangent = unit(sub(chain[i + 4], chain[i - 4]));
    let area = 0;
    for (let s = -5; s <= 5; s += 0.5) area += paleness(chain[i][0] - tangent[1] * s, chain[i][1] + tangent[0] * s) * 0.5;
    widths.push(area);
  }
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)] ?? 2;
}

let chains = traceChains(thin(pale, W, H), W, 12);
// Rejoin chains split by a pixel-sized break.
for (let merged = true; merged;) {
  merged = false;
  outer: for (const a of chains) for (const b of chains) {
    if (a !== b && gap(a[a.length - 1], b[0]) <= 9) { a.push(...b); chains = chains.filter(c => c !== b); merged = true; break outer; }
  }
}
const chainNear = (id, near) => {
  const chain = chains.reduce((best, c) => (gap(c[0], near) < gap(best[0], near) ? c : best));
  if (gap(chain[0], near) > 14) throw new Error(`No traced line starts near ${near} for "${id}".`);
  return chain;
};

// --- bud. Its left edge is one of the pale lines; its right edge is a dark
// boundary, found by scanning each pixel row rightward from the left edge until
// the light body ends. The dew drop sitting on the bud is bridged.
const budLeft = chainNear("bud-edge-l", LINES.find(([id]) => id === "bud-edge-l")[3]);
const budDrop = DROPS.find(([id]) => id === "bud");
const inBud = (x, y) => Math.hypot(x + 0.5 - budDrop[1], y + 0.5 - budDrop[2]) <= budDrop[3] + 2 || (alpha(x, y) >= 128 && channel(x, y, 0) > 125);
const budSeed = new Map(budLeft.map(([x, y]) => [Math.floor(y), Math.floor(x)]));
const budRows = [...budSeed.keys()].sort((a, b) => a - b);
const budRight = [];
// Below the traced edge the body narrows to its base: follow it down row by row.
let budBase = budLeft[0];
for (let row = budRows[budRows.length - 1] + 1, seed = budSeed.get(row - 1); ; row++) {
  const hit = [0, 1, -1, 2, -2, 3, -3, 4, -4].map(dx => seed + dx).find(x => inBud(x, row));
  if (hit === undefined) break;
  let left = hit, right = hit;
  while (inBud(left - 1, row)) left--;
  while (inBud(right + 1, row)) right++;
  budRight.unshift([right + 1, row + 0.5]);
  budBase = [(left + right + 1) / 2, row + 1];
  seed = Math.round((left + right) / 2);
}
for (const row of budRows.slice().reverse()) {
  let right = budSeed.get(row);
  while (inBud(right + 1, row)) right++;
  budRight.push([right + 1, row + 0.5]);
}
budRight.unshift(budBase);
budRight.push(budLeft[budLeft.length - 1]);

const strokes = LINES.map(([id, leaf, role, near, after]) => {
  // Both bud edges grow from the same base point.
  const chain = id === "bud-edge-l" ? [budBase, ...budLeft] : chainNear(id, near);
  const curves = fit(resample(smooth(chain, 3, 2), 3), 0.6);
  const points = flatten(curves);
  return { id, leaf, role, after, d: toPath(curves), length: lengthOf(points), width: opticalWidth(chain), points };
});
{
  // Row-by-row scanning is noisy at the pixel level: smooth it into one clean edge.
  const curves = fit(resample(smooth(budRight, 10, 4), 3), 1);
  const points = flatten(curves);
  strokes.splice(strokes.findIndex(s => s.id === "bud-edge-l") + 1, 0,
    { id: "bud-edge-r", leaf: "bud", role: "margin", d: toPath(curves), length: lengthOf(points), width: 2.4, points });
}
const stroke = id => strokes.find(s => s.id === id);

// --- dew. Each bead rolls along its vein(s) and stops on the drop; the drop's
// ring starts where the last of those lines touches it, so light can wrap from there.
const drops = DROPS.map(([id, x, y, r, via]) => {
  const centre = [x, y];
  let route = via.flatMap(lineId => stroke(lineId).points);
  if (!route.length) route = [budBase];
  // Stop where the route comes closest to the drop, then step onto its centre.
  route = [...route.slice(0, nearestIndex(route, centre) + 1), centre];
  const points = resampleEven(smooth(resample(route, 4), 2, 2), 16);
  // The touching line, and how far along it the touch happens (1 = at its end).
  const vein = via.length ? stroke(via[via.length - 1]) : null;
  const touchIndex = vein ? nearestIndex(vein.points, centre) : 0;
  const touch = vein ? vein.points[touchIndex] : [x, y + r];
  const at = vein ? lengthOf(vein.points.slice(0, touchIndex + 1)) / vein.length : 0;
  const angle = Math.atan2(touch[1] - y, touch[0] - x);
  const on = a => `${round(x + r * Math.cos(a))} ${round(y + r * Math.sin(a))}`;
  const d = `M${on(angle)}A${r} ${r} 0 1 1 ${on(angle + Math.PI)}A${r} ${r} 0 1 1 ${on(angle)}Z`;
  return { id, x, y, r, points, length: lengthOf(points), d, vein: vein?.id, at: Math.min(1, at) };
});

// --- view: a square around the leaf (not the wordmark) with a little air.
const side = Math.ceil(Math.max(plant.box[2] - plant.box[0], plant.box[3] - plant.box[1]) * 1.06);
const view = { x: Math.round((plant.box[0] + plant.box[2] - side) / 2), y: Math.round((plant.box[1] + plant.box[3] - side) / 2), size: side };

// ---------------------------------------------------------------- emit

const n1 = v => Math.round(v * 10) / 10;
const n3 = v => Math.round(v * 1000) / 1000;
const flat = pts => pts.map(p => `${n1(p[0])},${n1(p[1])}`).join(",");
const source = `// AUTO-GENERATED by scripts/trace-logo.mjs from public/brand/kiasa-logo.png.
// Do not edit by hand: change the tables in that script and re-run it.
// Coordinates are the logo's own 1200 × 1200 pixels; VIEW crops them to the leaf.

export type Leaf = "crown" | "left" | "right" | "bud";
export type StrokeRole = "midrib" | "margin" | "vein";

/** A pale line of the artwork, running from the plant's heart outward. */
export type Stroke = {
  id: string;
  leaf: Leaf;
  role: StrokeRole;
  d: string;
  /** Path length in logo pixels; sets how long the line takes to draw. */
  length: number;
  /** Measured thickness of the line in the artwork. */
  width: number;
  /** A line interrupted by a dew drop continues from this earlier part. */
  after?: string;
  /** Flattened x,y samples for the bead that leads a midrib. */
  points?: readonly number[];
};

export type DewDrop = {
  id: string;
  x: number;
  y: number;
  r: number;
  /** Flattened x,y samples of the vein the bead rolls along, ending on the drop. */
  points: readonly number[];
  length: number;
  /** The drop's ring as a closed path that starts where \`vein\` touches it. */
  d: string;
  /** The line that reaches this drop, and how far along it (0–1) the touch is. */
  vein?: string;
  at: number;
};

export const VIEW = { x: ${view.x}, y: ${view.y}, size: ${view.size} } as const;
export const ORIGIN = { x: ${ORIGIN[0]}, y: ${ORIGIN[1]} } as const;

export const STROKES: readonly Stroke[] = [
${strokes.map(s => `  { id: "${s.id}", leaf: "${s.leaf}", role: "${s.role}", length: ${Math.round(s.length)}, width: ${n1(s.width)},${s.after ? ` after: "${s.after}",` : ""}\n    d: "${s.d}"${s.role === "midrib" ? `,\n    points: [${flat(resampleEven(s.points, 16))}]` : ""} },`).join("\n")}
];

export const DEW: readonly DewDrop[] = [
${drops.map(d => `  { id: "${d.id}", x: ${d.x}, y: ${d.y}, r: ${d.r}, length: ${Math.round(d.length)},${d.vein ? ` vein: "${d.vein}",` : ""} at: ${n3(d.at)},\n    d: "${d.d}",\n    points: [${flat(d.points)}] },`).join("\n")}
];
`;
await writeFile(OUTPUT, source);
console.log(`geometry.ts: ${strokes.length} strokes, ${drops.length} dew drops, view ${JSON.stringify(view)}, ${(source.length / 1024).toFixed(1)} KB`);
for (const s of strokes) console.log(`  ${s.id.padEnd(16)} length ${String(Math.round(s.length)).padStart(4)}  width ${n1(s.width)}`);
for (const d of drops) console.log(`  drop ${d.id.padEnd(8)} via ${String(d.vein).padEnd(16)} at ${n3(d.at)}`);

// A small favicon cut from the same artwork: the page itself does not load the full PNG.
await sharp(SOURCE).extract({ left: view.x, top: view.y, width: view.size, height: view.size }).resize(96, 96, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile(ICON);

// ---------------------------------------------------------------- debug overlays

if (debugDir) {
  await mkdir(debugDir, { recursive: true });
  // Alignment: red centrelines and rings over the real artwork, dew routes in cyan.
  const check = strokes.map(s => `<path d="${s.d}" fill="none" stroke="#ff2d55" stroke-width="1.2"/>`).join("") +
    drops.map(d => `<path d="${d.d}" fill="none" stroke="#ff2d55" stroke-width="1.2"/><polyline points="${d.points.map(p => p.join(",")).join(" ")}" fill="none" stroke="#00e5ff" stroke-width="1.2" stroke-dasharray="4 3"/>`).join("") +
    `<circle cx="${ORIGIN[0]}" cy="${ORIGIN[1]}" r="5" fill="#ffd600"/>`;
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${check}</svg>`);
  const artwork = await sharp(SOURCE).flatten({ background: "#030807" }).toBuffer();
  // sharp extracts before it composites, so overlay first, then crop.
  const aligned = await sharp(artwork).composite([{ input: overlay }]).png().toBuffer();
  await sharp(aligned).extract({ left: view.x, top: view.y, width: view.size, height: view.size }).toFile(path.join(debugDir, "alignment.png"));
  console.log(`debug overlays written to ${debugDir}`);
}
