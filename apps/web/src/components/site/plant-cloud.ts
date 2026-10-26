import { DEW, ORIGIN, STROKES, type Leaf } from "@/components/intro/geometry";

/** The KIASA leaf as a plant of points in three dimensions, for the hero. The
 * logo draws the plant as seen from straight above: three leaves spreading from
 * a bud at its heart. So the drawing is laid flat, its two directions become the
 * ground's, and the only thing added is height. Each leaf rises from the heart,
 * arches and dips toward its tip, its borders lifted a little either side of
 * the midrib and turned a little toward the tip; the bud stands up from the
 * heart as a sprout, brighter than the leaves; a low mound of soil lies
 * beneath. Seen from straight above, the cloud is the drawing itself, and from
 * wherever the camera looks down on it, it is the leaves' upper faces that
 * show: the drawing has no back to turn to.
 *
 * The leaves are filled with green from a deep emerald along the midrib to a
 * luminous jade toward the borders, with here and there a wide, faint point:
 * the light they give off. Each dew drop sits still on top of its leaf, where
 * the logo has it, as a bead of water: flat where it rests, a little fuller
 * downhill. The shader lights it as clear water that gives back only the sun,
 * and lets nothing behind it show through.
 *
 * Every point comes from the drawing: points run along each of its lines, lie
 * scattered over each leaf between its two borders, and gather on the surface
 * of each drop. */

type Point = readonly [number, number];
type Look = readonly [light: number, size: number];
/** A place in the plant: logo pixels from the ground under its heart, x to the right, y up, z toward the viewer. */
export type Vec = readonly [number, number, number];

/** Floats per point: where it is (a Vec), then its light (0–1), its size (a
 * multiple of the base dot), its tone and the phase of its twinkle (0–1), then
 * for the points of a dew drop's surface the way that part of the surface
 * faces (a unit vector) and 1, so the shader can light it as water; zero elsewhere. */
export const STRIDE = 11;
/** A point's colour: the drawing's pale ink, a leaf's green (1 to 1.98: deep
 * emerald to luminous jade), the blue of the dew, or the fresh green of the sprout. */
export const TONE = { ink: 0, leaf: 1, dew: 2, sprout: 3 } as const;

/** Logo pixels between points along a line. */
const STEP = 3.2;
/** The side of the square of leaf that each scattered point stands for. */
const SCATTER = 4;
/** Square logo pixels of a dew drop's surface for each of its points. */
const BEAD = 15;
/** A dew drop's radius, as a share of the ring that stands for it in the
 * drawing: on leaves this size, dew is smaller than the logo draws it. */
const DEW_SIZE = 0.68;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How brightly each kind of point is lit, and how large it is, before depth and twinkle. */
const LOOK = {
  margin: [0.88, 1],
  midrib: [0.85, 1],
  vein: [0.6, 0.9],
  blade: [0.95, 0.9],
  aura: [0.13, 4.4],
  sprout: [1, 1.2],
  shoot: [0.95, 1],
  halo: [0.26, 3.6],
  dew: [1, 1.25],
  soil: [0.36, 0.8],
} as const satisfies Record<string, Look>;

/** How high the heart stands above the ground, in logo pixels. */
const HEART = 60;
/** A leaf's arch: running from the heart to its tip, it rises by `RISE` and
 * falls by `DROOP` times its length, so it peaks a little before halfway and
 * its tip dips back toward the ground. */
const RISE = 1, DROOP = 1.1;
/** How far the borders lift either side of the midrib, per square logo pixel from it. */
const FOLD = 0.003;
/** How far a leaf turns about its midrib by its tip: height per logo pixel across it. */
const TWIST = 0.25;
/** Where the bud leaves the heart and where its tip is, how steeply it stands
 * (height for each logo pixel it reaches), and how far its sides curl up about
 * its middle, like a young leaf still unrolling (height per square logo pixel). */
const BUD_FOOT: Point = [633, 735], BUD_TIP: Point = [691.5, 588.5], STAND = 1.15, CURL = 0.09;
/** A drop's shape, as shares of its radius: how much fuller its downhill side
 * is, and how far below its middle it is cut flat where it sits on a leaf. */
const SAG = 0.12, FLAT = 0.45;
/** The soil: a mound under the heart, its rim `radius` out, `peak` high at its
 * middle, `spread` the width of its swell, and one point to each square `cell`
 * wide before it thins toward the rim. */
const SOIL = { radius: 620, peak: 40, spread: 220, cell: 10 };

/** Each leaf: the two borders that enclose it and the midrib it folds along. */
const LEAVES: Record<Leaf, { borders: readonly [string, string]; midribs: readonly string[] }> = {
  crown: { borders: ["crown-margin-l", "crown-margin-r"], midribs: ["crown-midrib"] },
  left: { borders: ["left-margin-u", "left-margin-d"], midribs: ["left-midrib"] },
  right: { borders: ["right-margin-u", "right-margin-d"], midribs: ["right-midrib-a", "right-midrib-b"] },
  bud: { borders: ["bud-edge-l", "bud-edge-r"], midribs: [] },
};

/** A small, fast generator, seeded so the plant is the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The points of a path written as `M x y` and cubic `C` segments, `per` to a segment. */
function flatten(d: string, per = 24): Point[] {
  const numbers = d.match(/-?\d*\.?\d+/g)!.map(Number);
  const points: Point[] = [[numbers[0], numbers[1]]];
  for (let i = 2; i + 6 <= numbers.length; i += 6) {
    const [x0, y0] = points[points.length - 1];
    const [x1, y1, x2, y2, x3, y3] = numbers.slice(i, i + 6);
    for (let step = 1; step <= per; step++) {
      const t = step / per, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      points.push([a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3]);
    }
  }
  return points;
}

/** Calls `visit` every `spacing` along a polyline, with the point there and the line's direction. */
function along(points: readonly Point[], spacing: number, visit: (x: number, y: number, tx: number, ty: number) => void) {
  let ahead = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (!length) continue;
    const tx = (x1 - x0) / length, ty = (y1 - y0) / length;
    for (; ahead < length; ahead += spacing) visit(x0 + tx * ahead, y0 + ty * ahead, tx, ty);
    ahead -= length;
  }
}

/** A midrib to measure against: its points, and how far along it each one lies. */
type Spine = { points: readonly Point[]; lengths: readonly number[] };

function spine(points: readonly Point[]): Spine {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, lengths };
}

/** Where (x, y) lies from a leaf's midrib: how far to one side of it (negative
 * on the other side), and how far along it (0 at the stem, 1 at its end). */
function across({ points, lengths }: Spine, x: number, y: number) {
  let nearest = Infinity, side = 1, reach = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const dx = points[i][0] - x0, dy = points[i][1] - y0, span = lengths[i] - lengths[i - 1];
    const t = span ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (span * span))) : 0;
    const ex = x - x0 - dx * t, ey = y - y0 - dy * t, gap = ex * ex + ey * ey;
    if (gap < nearest) {
      nearest = gap;
      side = dx * (y - y0) - dy * (x - x0) < 0 ? -1 : 1;
      reach = lengths[i - 1] + t * span;
    }
  }
  return { offset: side * Math.sqrt(nearest), along: reach / lengths[lengths.length - 1] };
}

/** Whether (x, y) lies inside a closed outline. */
function inside(outline: readonly Point[], x: number, y: number) {
  let crossings = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i], [xj, yj] = outline[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) crossings++;
  }
  return crossings % 2 === 1;
}

/** Each line of the drawing finely, to set points along, and coarsely, to measure against. */
const lines = new Map(STROKES.map(stroke => [stroke.id, flatten(stroke.d)]));
const line = (id: string) => lines.get(id)!;
const coarse = (id: string) => flatten(STROKES.find(stroke => stroke.id === id)!.d, 6);

/** Each leaf's outline: out along one border and back along the other. */
const outlines = Object.fromEntries((Object.keys(LEAVES) as Leaf[]).map(leaf => {
  const [first, second] = LEAVES[leaf].borders;
  return [leaf, [...coarse(first), ...coarse(second).reverse()]];
})) as Record<Leaf, Point[]>;

/** Each leaf's midrib as one line from the stem out (the right one is broken by
 * a dew drop); the bud, which has none drawn, runs straight from its foot to its tip. */
const spines = Object.fromEntries((Object.keys(LEAVES) as Leaf[]).map(leaf =>
  [leaf, spine(leaf === "bud" ? [BUD_FOOT, BUD_TIP] : LEAVES[leaf].midribs.flatMap(coarse))])) as Record<Leaf, Spine>;

/** How high above the ground the point of `leaf` at (x, y) on the drawing stands. */
function height(leaf: Leaf, x: number, y: number) {
  if (leaf === "bud") {
    const { offset, along } = across(spines.bud, x, y);
    return HEART + STAND * along * spines.bud.lengths[1] + CURL * offset * offset;
  }
  const midrib = spines[leaf];
  const { offset, along } = across(midrib, x, y);
  const arch = midrib.lengths[midrib.lengths.length - 1] * along * (RISE - DROOP * along);
  return HEART + arch + FOLD * offset * offset + TWIST * offset * along;
}

/** How high the soil stands, `out` logo pixels from under the heart. */
const ground = (out: number) => SOIL.peak * Math.exp(-((out / SOIL.spread) ** 2));

/** The way down the leaf from (x, y), in the world: a unit vector (x, height, z) that falls with the slope. */
function downhill(leaf: Leaf, x: number, y: number): Vec {
  const gx = (height(leaf, x + 2, y) - height(leaf, x - 2, y)) / 4;
  const gy = (height(leaf, x, y + 2) - height(leaf, x, y - 2)) / 4;
  const slope = Math.hypot(gx, gy) || 1e-6, fall = Math.hypot(1, slope);
  return [-gx / slope / fall, -slope / fall, -gy / slope / fall];
}

/** The highest the leaf stands under a drop of radius `r` at (x, y), so the drop sits on it rather than in it. */
function seat(leaf: Leaf, x: number, y: number, r: number) {
  let highest = height(leaf, x, y);
  for (let k = 0; k < 12; k++) {
    for (const reach of [0.45, 0.85]) {
      const px = x + Math.cos((k * Math.PI) / 6) * r * reach, py = y + Math.sin((k * Math.PI) / 6) * r * reach;
      if (inside(outlines[leaf], px, py)) highest = Math.max(highest, height(leaf, px, py));
    }
  }
  return highest;
}

/** A point that is not water. */
const DRY = [0, 0, 0, 0] as const;

/** The plant's points (see STRIDE); how many of them, from the first, are the
 * plant rather than its soil; and which of them are the dew's surfaces. */
export function plantCloud() {
  const random = seeded(2012);
  const gauss = () => (random() + random() + random() - 1.5) * 2;
  const data: number[] = [];
  /** A point at (x, y) on the drawing, `rise` above the ground. */
  const put = (x: number, y: number, rise: number, [light, size]: Look, tone: number, water: readonly number[] = DRY) =>
    data.push(x - ORIGIN.x, rise, y - ORIGIN.y, light * (0.55 + 0.45 * random()), size * (0.75 + 0.5 * random()), tone, random(), ...water);

  // The drawing's lines, every border, midrib and vein of it, in points; the
  // sprout's own borders brighter, closer set and in its fresh green.
  for (const stroke of STROKES) {
    const sprout = stroke.leaf === "bud";
    const spread = 0.7 + 0.35 * stroke.width;
    along(line(stroke.id), sprout ? STEP * 0.7 : STEP, (x, y, tx, ty) => {
      const off = gauss() * spread, px = x - ty * off, py = y + tx * off;
      put(px, py, height(stroke.leaf, px, py) + gauss() * 1.5, sprout ? LOOK.sprout : LOOK[stroke.role], sprout ? TONE.sprout : TONE.ink);
    });
  }

  // The leaves themselves: a scatter between each leaf's two borders, nearly
  // all of it green, deep along the midrib and glowing toward the borders; the
  // sprout filled closer, in its own green.
  for (const leaf of Object.keys(LEAVES) as Leaf[]) {
    const sprout = leaf === "bud", cell = sprout ? SCATTER * 0.6 : SCATTER, outline = outlines[leaf];
    const xs = outline.map(([x]) => x), ys = outline.map(([, y]) => y);
    for (let gx = Math.min(...xs); gx < Math.max(...xs); gx += cell) {
      for (let gy = Math.min(...ys); gy < Math.max(...ys); gy += cell) {
        const x = gx + random() * cell, y = gy + random() * cell;
        if (!inside(outline, x, y)) continue;
        if (sprout) {
          put(x, y, height(leaf, x, y) + gauss() * 2, LOOK.shoot, TONE.sprout);
          continue;
        }
        const glow = Math.min(1, Math.abs(across(spines[leaf], x, y).offset) / 70) * 0.75 + random() * 0.25, rise = height(leaf, x, y);
        put(x, y, rise + gauss() * 3, LOOK.blade, random() < 0.9 ? TONE.leaf + 0.98 * glow : TONE.ink);
        // Here and there a wide, faint point: together they are the light the leaf gives off.
        if (random() < 0.3) put(x, y, rise + gauss() * 5, LOOK.aura, TONE.leaf + 0.98 * glow);
      }
    }
  }

  // A soft glow about the sprout, so the eye finds it at the heart of the plant.
  for (let k = 0; k < 140; k++) {
    const t = random(), x = BUD_FOOT[0] + (BUD_TIP[0] - BUD_FOOT[0]) * t + gauss() * 14, y = BUD_FOOT[1] + (BUD_TIP[1] - BUD_FOOT[1]) * t + gauss() * 14;
    put(x, y, height("bud", x, y) + gauss() * 14, LOOK.halo, TONE.sprout);
  }

  // The dew, all together so the shader can let each drop hide what lies
  // behind it. Each drop sits still on the highest part of the leaf under it,
  // flat where it rests and a little fuller downhill: water held on a slope.
  // Each of its points carries the way the drop's surface faces there.
  const first = data.length / STRIDE;
  for (const drop of DEW) {
    const leaf = STROKES.find(stroke => stroke.id === drop.vein)?.leaf ?? "bud";
    const [fx, fy, fz] = downhill(leaf, drop.x, drop.y);
    const radius = drop.r * DEW_SIZE, centre = seat(leaf, drop.x, drop.y, radius) + radius * FLAT;
    const count = Math.round((4 * Math.PI * radius * radius) / BEAD);
    for (let k = 0; k < count; k++) {
      const ny = 1 - (2 * (k + 0.5)) / count, ring = Math.sqrt(1 - ny * ny);
      const nx = Math.cos(k * GOLDEN) * ring, nz = Math.sin(k * GOLDEN) * ring;
      const dy = Math.max(ny, -FLAT), front = Math.max(0, nx * fx + dy * fy + nz * fz) * SAG;
      // A little unevenness, always the same, so the points read as water rather than as a net.
      const [jx, jy, jz] = [(k * 0.5698403) % 1, (k * 0.381966) % 1, (k * 0.236068) % 1].map(value => (value - 0.5) * 0.1);
      put(drop.x + (nx + fx * front + jx) * radius, drop.y + (nz + fz * front + jz) * radius, centre + (dy + fy * front + (dy === -FLAT ? 0 : jy)) * radius, LOOK.dew, TONE.dew, [nx, ny, nz, 1]);
    }
  }
  const water = { first, count: data.length / STRIDE - first };
  const plant = data.length / STRIDE;

  // The soil: a low mound under the heart, thinning and dimming toward its rim.
  const { radius, cell } = SOIL;
  for (let gx = -radius; gx < radius; gx += cell) {
    for (let gz = -radius; gz < radius; gz += cell) {
      const x = gx + random() * cell, z = gz + random() * cell, out = Math.hypot(x, z);
      if (out > radius || random() < smoothstep(0.45 * radius, radius, out)) continue;
      put(ORIGIN.x + x, ORIGIN.y + z, ground(out) + gauss() * 3, [LOOK.soil[0] * (1 - 0.5 * out / radius), LOOK.soil[1]], TONE.ink);
    }
  }

  return { points: Float32Array.from(data), plant, water };
}
