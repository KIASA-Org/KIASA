"use client";

import { useEffect, useRef } from "react";

/** How the photograph arrives: first as a field of dew drops, then as itself.
 *
 * The photograph is read once, cell by cell. Each cell becomes a drop sized by
 * how much light the photograph has there: a speck in the shadows, a ring in the
 * mid-tones, a full drop with its glint where it is brightest. A few of the
 * brightest drops catch green and one catches the dew's blue. Then the drops
 * swell and clear, the brightest first, and the photograph is there.
 *
 * A night cover is part of the page from the first paint, so the photograph
 * never shows before its drops. Without script it fades by itself (CSS), and for
 * reduced motion there is no cover and no reveal at all.
 */

const INK = [236, 255, 243] as const;
const LEAF = [184, 236, 147] as const;
const DEW = [69, 200, 255] as const;
const NIGHT = "rgb(3 8 7)";

/** Seconds: drops come in across the frame, then clear, each over these spans. */
const APPEAR = 0.24, CLEAR = 0.38;
/** A deterministic scatter in [0, 1) for a cell, so the pattern is the same on every visit. */
const hash = (x: number, y: number, seed: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
};
const ease = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

type Cell = { x: number; y: number; light: number; appear: number; clear: number; tint: readonly number[]; glint: boolean; boost: number };

function percent(value: string, fallback: number) {
  const n = parseFloat(value);
  return value.trim().endsWith("%") && Number.isFinite(n) ? n / 100 : fallback;
}

/** Reads the photograph, as the page shows it (object-fit: cover), into one light value per cell. */
function sample(img: HTMLImageElement, width: number, height: number, cell: number) {
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
  const raw: number[] = [];
  for (let i = 0; i < cols * rows; i++) raw.push((0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255);
  // Stretch this photograph's own range, so its shapes read in the drops whether it is bright or dim.
  const sorted = [...raw].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.04)], high = sorted[Math.floor(sorted.length * 0.97)];
  const light = raw.map(value => clamp01((value - low) / Math.max(0.05, high - low)) ** 1.15);
  return { cols, rows, light };
}

function cells(width: number, height: number, cell: number, img: HTMLImageElement): Cell[] {
  const { cols, rows, light } = sample(img, width, height, cell);
  // The brightest cell in the right half is the one drop that turns blue.
  let dew = -1;
  for (let i = 0; i < light.length; i++) if (i % cols > cols / 2 && (dew < 0 || light[i] > light[dew])) dew = i;
  return light.map((value, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const scatter = hash(col, row, 1);
    return {
      x: col * cell, y: row * cell, light: value,
      // In from the left in a loose wave; out with the light first, as if the sun burns the dew off.
      appear: 0.42 * (0.62 * (col / cols) + 0.38 * scatter),
      clear: 1.05 + 1.0 * (0.62 * (1 - value) + 0.38 * hash(col, row, 2)),
      tint: i === dew ? DEW : value > 0.62 && hash(col, row, 3) < 0.07 ? LEAF : INK,
      glint: value > 0.58,
      boost: i === dew ? 1.6 : 1,
    };
  });
}

/** `clearTop`: the strip under a transparent site header, where drops would crowd the menu; it stays plain night. */
function draw(ctx: CanvasRenderingContext2D, list: Cell[], cell: number, time: number, clearTop: number) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  for (const c of list) {
    const shown = ease(clamp01((time - c.appear) / APPEAR));
    const cleared = ease(clamp01((time - c.clear) / CLEAR));
    if (cleared >= 1) continue;
    // The night behind this cell lifts as its drop clears.
    ctx.globalAlpha = 1 - cleared;
    ctx.fillStyle = NIGHT;
    ctx.fillRect(c.x, c.y, cell, cell);
    if (shown <= 0 || c.y < clearTop) continue;
    const cx = c.x + cell / 2, cy = c.y + cell / 2;
    // A drop swells a little as it clears, then is gone.
    const r = (cell * (0.05 + 0.36 * c.light) * c.boost) * (1 + 0.5 * cleared) * (0.6 + 0.4 * shown);
    const alpha = shown * (1 - cleared) * (0.16 + 0.8 * c.light);
    const [cr, cg, cb] = c.tint;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ctx.fillStyle = `rgb(${cr} ${cg} ${cb})`;
    if (c.light < 0.16) {
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.8, r * 0.6), 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (c.glint) {
      // The short arc where a drop catches the light, as on the leaf.
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.56, (196 * Math.PI) / 180, (254 * Math.PI) / 180); ctx.stroke();
    }
  }
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
      let list: Cell[];
      try { list = cells(canvas.width, canvas.height, cell, img); } catch { return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const end = Math.max(...list.map(c => c.clear)) + CLEAR;
      const clearTop = (parseFloat(getComputedStyle(hero).paddingTop) || 0) * dpr;
      const began = performance.now();
      draw(ctx, list, cell, 0, clearTop);
      canvas.dataset.state = "playing";
      // The canvas now holds the night: the cover can go.
      cover.style.display = "none";
      const tick = (now: number) => {
        const time = (now - began) / 1000;
        draw(ctx, list, cell, time, clearTop);
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
