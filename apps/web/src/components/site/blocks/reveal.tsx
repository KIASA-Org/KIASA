"use client";

import { useEffect, useRef } from "react";

/** How the photograph arrives: first as a field of dew drops, then as itself.
 *
 * The photograph is read once, cell by cell. Each cell becomes a drop sized by
 * how much light the photograph has there: a speck in the shadows, a ring in the
 * mid-tones, a full drop with its glint where it is brightest. A few of the
 * brightest drops catch green and one catches the dew's blue.
 *
 * Then the night lifts like mist burning off: as one soft surface, never as
 * tiles. Its timing is a smooth field (the photograph's light, blurred, and a
 * slow wave across the frame), so neighbouring drops clear together and the
 * clearing flows across the picture, the brightest places first. The night is
 * drawn at one value per cell and stretched with smoothing, so every edge is a
 * gradient. The photograph settles from a slight zoom as it comes through.
 *
 * A night cover is part of the page from the first paint, so the photograph
 * never shows before its drops. Without script it fades by itself (CSS), and for
 * reduced motion there is no cover and no reveal at all.
 */

type RGB = readonly [number, number, number];
const INK: RGB = [236, 255, 243];
const LEAF: RGB = [184, 236, 147];
const DEW: RGB = [69, 200, 255];
const TINTS = [INK, LEAF, DEW] as const;
const NIGHT: RGB = [3, 8, 7];

/** Seconds a drop takes to come in, and the night over a cell takes to lift. */
const APPEAR = 0.6, CLEAR = 0.85;
/** The clearing front starts here and has passed over the whole picture this many seconds later. */
const CLEAR_FROM = 0.75, CLEAR_SPAN = 1.75;
/** Drops are drawn in batches by tint and strength: one stroke per batch keeps every frame light. */
const LEVELS = 10;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** A deterministic scatter in [0, 1) for a cell, so the pattern is the same on every visit. */
const hash = (x: number, y: number, seed: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

type Field = { cols: number; rows: number; light: Float32Array; appear: Float32Array; clear: Float32Array; tint: Uint8Array; glint: Uint8Array; size: Float32Array };

function percent(value: string, fallback: number) {
  const n = parseFloat(value);
  return value.trim().endsWith("%") && Number.isFinite(n) ? n / 100 : fallback;
}

/** A box blur, twice, so the timing field has no hard steps. */
function blur(values: Float32Array, cols: number, rows: number, radius: number) {
  let from = values;
  for (let pass = 0; pass < 2; pass++) {
    const to = new Float32Array(values.length);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let sum = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        sum += from[yy * cols + xx]; n++;
      }
      to[y * cols + x] = sum / n;
    }
    from = to;
  }
  return from;
}

/** Reads the photograph, as the page shows it (object-fit: cover), and lays out the drops and their timing. */
function read(img: HTMLImageElement, width: number, height: number, cell: number): Field {
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const [px, py] = getComputedStyle(img).objectPosition.split(/\s+/);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  const ox = (width - dw) * percent(px ?? "", 0.5), oy = (height - dh) * percent(py ?? "", 0.5);
  const probe = document.createElement("canvas");
  probe.width = cols; probe.height = rows;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, ox / cell, oy / cell, dw / cell, dh / cell);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const count = cols * rows;
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) raw[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  // Stretch this photograph's own range, so its shapes read in the drops whether it is bright or dim.
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const low = sorted[Math.floor(count * 0.04)], high = sorted[Math.floor(count * 0.97)];
  const light = raw.map(value => clamp01((value - low) / Math.max(0.05, high - low)) ** 1.15);
  const soft = blur(light, cols, rows, 3);

  const appear = new Float32Array(count), clear = new Float32Array(count), size = new Float32Array(count);
  const tint = new Uint8Array(count), glint = new Uint8Array(count);
  let dew = -1;
  for (let i = 0; i < count; i++) if (i % cols > cols / 2 && (dew < 0 || light[i] > light[dew])) dew = i;
  // When each cell clears: the light burns the dew off first, a slow drift carries
  // the front across the frame, and a touch of scatter keeps its edge alive.
  const wave = (u: number, v: number) => 0.5 + 0.25 * Math.sin(u * 5.1 + v * 2.3 + 0.6) + 0.25 * Math.sin(u * 2.2 - v * 4.4 + 2.1);
  const order = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols), u = col / cols, v = row / rows;
    order[i] = 0.46 * (1 - soft[i]) + 0.3 * (0.7 * u + 0.3 * (1 - v)) + 0.18 * wave(u, v) + 0.06 * hash(col, row, 2);
  }
  // By rank, not by value: the front then moves at an even pace from the first cell to the last.
  const ranked = Array.from(order.keys()).sort((a, b) => order[a] - order[b]);
  ranked.forEach((cellIndex, place) => { clear[cellIndex] = CLEAR_FROM + CLEAR_SPAN * (place / Math.max(1, count - 1)); });
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const u = col / cols, v = row / rows;
    // Drops come in from the left in a slow drift, not at random.
    appear[i] = 0.42 * (0.7 * u + 0.22 * wave(u, v) + 0.08 * hash(col, row, 1));
    // A drop never clears before it has fully come in.
    clear[i] = Math.max(clear[i], appear[i] + APPEAR * 0.8);
    tint[i] = i === dew ? 2 : light[i] > 0.62 && hash(col, row, 3) < 0.07 ? 1 : 0;
    glint[i] = light[i] > 0.58 ? 1 : 0;
    size[i] = (0.05 + 0.36 * light[i]) * (i === dew ? 1.6 : 1);
  }
  return { cols, rows, light, appear, clear, tint, glint, size };
}

/** One frame: the night, lifted smoothly where it has cleared, then the drops over it. */
function paint(ctx: CanvasRenderingContext2D, mask: CanvasRenderingContext2D, maskData: ImageData, field: Field, cell: number, time: number, clearTop: number) {
  const { cols, rows, light, appear, clear, tint, glint, size } = field;
  const { width, height } = ctx.canvas;
  const pixels = maskData.data;
  // Batches of drops: [tint][strength] → one path of rings and one of specks.
  const rings: Path2D[][] = TINTS.map(() => Array.from({ length: LEVELS }, () => new Path2D()));
  const specks: Path2D[][] = TINTS.map(() => Array.from({ length: LEVELS }, () => new Path2D()));
  for (let i = 0; i < cols * rows; i++) {
    const cleared = easeInOut(clamp01((time - clear[i]) / CLEAR));
    pixels[i * 4 + 3] = Math.round(255 * (1 - cleared));
    if (cleared >= 1) continue;
    const shown = easeOut(clamp01((time - appear[i]) / APPEAR));
    const col = i % cols, row = Math.floor(i / cols);
    if (shown <= 0 || row * cell < clearTop) continue;
    const strength = shown * (1 - cleared) * (0.16 + 0.8 * light[i]);
    const level = Math.min(LEVELS - 1, Math.round(strength * (LEVELS - 1)));
    if (level <= 0) continue;
    const cx = col * cell + cell / 2, cy = row * cell + cell / 2;
    // A drop swells as it comes in, and a little more as it clears.
    const r = cell * size[i] * (0.55 + 0.45 * shown) * (1 + 0.45 * cleared);
    if (light[i] < 0.16) {
      const dot = Math.max(0.8, r * 0.6);
      specks[tint[i]][level].moveTo(cx + dot, cy);
      specks[tint[i]][level].arc(cx, cy, dot, 0, Math.PI * 2);
      continue;
    }
    const path = rings[tint[i]][level];
    path.moveTo(cx + r, cy);
    path.arc(cx, cy, r, 0, Math.PI * 2);
    if (glint[i]) {
      // The short arc where a drop catches the light, as on the leaf.
      const g = r * 0.56, a0 = (196 * Math.PI) / 180, a1 = (254 * Math.PI) / 180;
      path.moveTo(cx + g * Math.cos(a0), cy + g * Math.sin(a0));
      path.arc(cx, cy, g, a0, a1);
    }
  }
  mask.putImageData(maskData, 0, 0);
  ctx.clearRect(0, 0, width, height);
  // One value per cell, stretched with smoothing: the night's edges are gradients, never squares.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mask.canvas, 0, 0, cols, rows, 0, 0, cols * cell, rows * cell);
  ctx.lineWidth = Math.max(1, cell * 0.06);
  TINTS.forEach(([r, g, b], t) => {
    ctx.strokeStyle = ctx.fillStyle = `rgb(${r} ${g} ${b})`;
    for (let level = 1; level < LEVELS; level++) {
      ctx.globalAlpha = level / (LEVELS - 1);
      ctx.stroke(rings[t][level]);
      ctx.fill(specks[t][level]);
    }
  });
  ctx.globalAlpha = 1;
}

/** The field of drops over a photo hero. Mount it as a sibling of the hero's photograph. */
export function DewReveal() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.parentElement;
    const cover = hero?.querySelector<HTMLElement>(".b-hero-cover");
    const img = hero?.querySelector<HTMLImageElement>("img.b-hero-photo");
    if (!canvas || !hero || !cover || !img) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0, cancelled = false;
    const mounted = performance.now();

    const start = () => {
      if (cancelled) return;
      // Too late: the cover has begun to fade by itself, so let it, and show the photograph.
      if (parseFloat(getComputedStyle(cover).opacity) < 0.98 || img.naturalWidth === 0) return;
      const { width, height } = hero.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cell = Math.round((width < 700 ? 15 : 22) * dpr);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      let field: Field;
      try { field = read(img, canvas.width, canvas.height, cell); } catch { return; }
      const ctx = canvas.getContext("2d");
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = field.cols; maskCanvas.height = field.rows;
      const mask = maskCanvas.getContext("2d");
      if (!ctx || !mask) return;
      const maskData = mask.createImageData(field.cols, field.rows);
      for (let i = 0; i < field.cols * field.rows; i++) {
        maskData.data[i * 4] = NIGHT[0]; maskData.data[i * 4 + 1] = NIGHT[1]; maskData.data[i * 4 + 2] = NIGHT[2];
      }
      let end = 0;
      for (const at of field.clear) end = Math.max(end, at);
      end += CLEAR;
      const clearTop = (parseFloat(getComputedStyle(hero).paddingTop) || 0) * dpr;
      paint(ctx, mask, maskData, field, cell, 0, clearTop);
      canvas.dataset.state = "playing";
      // The canvas now holds the night: the cover can go.
      cover.style.display = "none";
      // The photograph settles from a slight zoom while the night lifts.
      img.style.transform = "scale(1.07)";
      img.getBoundingClientRect();
      img.style.transition = `transform ${(end + 0.6).toFixed(2)}s cubic-bezier(0.16, 1, 0.3, 1)`;
      img.style.transform = "scale(1)";
      const began = performance.now();
      const tick = () => {
        const time = (performance.now() - began) / 1000;
        paint(ctx, mask, maskData, field, cell, time, clearTop);
        if (time < end) { frame = requestAnimationFrame(tick); return; }
        canvas.dataset.state = "done";
      };
      frame = requestAnimationFrame(tick);
    };

    if (img.complete && img.naturalWidth > 0) start();
    else {
      const onLoad = () => { if (performance.now() - mounted < 1300) start(); };
      img.addEventListener("load", onLoad, { once: true });
      return () => { cancelled = true; img.removeEventListener("load", onLoad); cancelAnimationFrame(frame); };
    }
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, []);

  return <canvas ref={canvasRef} className="b-hero-reveal" aria-hidden="true" />;
}
