// Measures the production build and writes artifacts/performance-report.json:
// entrance timing, frame pacing during the entrance and on the homepage after it
// (also with the CPU throttled 4x), layout shifts, long tasks, script weight, and
// whether the homepage looks the same with and without JavaScript.
// Needs a production server: npm run build && npm start -- --port 3001
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.KIASA_URL ?? "http://127.0.0.1:3001";
/** How long the homepage is watched once the entrance is over. */
const PAGE_MS = 6000;

/** p95 of a list of frame intervals in milliseconds. */
const p95 = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? null;

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const runs = [];
for (const [name, viewport, throttle] of [["desktop", { width: 1440, height: 900 }, 1], ["mobile", { width: 390, height: 844 }, 1], ["mobile, CPU 4x slower", { width: 390, height: 844 }, 4]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: viewport.width < 500 ? 3 : 1 });
  if (throttle > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.addInitScript(() => {
    const metrics = window.metrics = { entrance: [], page: [], shifts: [], longTasks: [] };
    for (const type of ["layout-shift", "longtask"]) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (type === "longtask") metrics.longTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
        else if (!entry.hadRecentInput) metrics.shifts.push(entry.value);
      }
    }).observe({ type, buffered: true });
    let previous;
    requestAnimationFrame(function frame(now) {
      const intro = window.__kiasaIntro;
      // Only frames in which the animation is actually running.
      if (previous && document.documentElement.dataset.kiasaIntro === "playing") metrics.entrance.push(now - previous);
      else if (previous && intro?.result) metrics.page.push(now - previous);
      previous = now;
      requestAnimationFrame(frame);
    });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => !!window.__kiasaIntro?.result);
  await page.waitForTimeout(PAGE_MS);
  const metrics = await page.evaluate(() => ({
    ...window.metrics,
    result: window.__kiasaIntro.result,
    resources: performance.getEntriesByType("resource").map(entry => ({ name: new URL(entry.name).pathname, bytes: entry.encodedBodySize })),
  }));
  runs.push({
    run: name,
    result: metrics.result,
    entranceFrames: metrics.entrance.length,
    entranceFrameP95Ms: p95(metrics.entrance),
    pageFrames: metrics.page.length,
    pageFrameP95Ms: p95(metrics.page),
    layoutShift: metrics.shifts.reduce((a, b) => a + b, 0),
    longTasks: metrics.longTasks,
    scriptBytes: metrics.resources.filter(entry => entry.name.endsWith(".js")).reduce((total, entry) => total + entry.bytes, 0),
    // The page draws the leaf itself: it must not download the full logo image.
    logoRequests: metrics.resources.filter(entry => entry.name.includes("kiasa-logo")).length,
    errors,
  });
  await page.close();
}

// The first screen of the homepage, held still, must be the same picture with and without scripts.
const still = async options => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", ...options });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const shot = await sharp(await page.screenshot()).raw().toBuffer();
  await context.close();
  return shot;
};
const withoutScripts = await still({ javaScriptEnabled: false });
const withScripts = await still({});
let changed = 0, largest = 0;
for (let i = 0; i < withoutScripts.length; i++) {
  const difference = Math.abs(withoutScripts[i] - withScripts[i]);
  if (difference) changed++;
  largest = Math.max(largest, difference);
}
await browser.close();

const report = { stillFrames: { compared: "homepage at rest (reduced motion): no JavaScript vs JavaScript", changedChannels: changed, largestDifference: largest, totalChannels: withoutScripts.length }, runs };
await writeFile("artifacts/performance-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
