import { test, expect, type Page } from "@playwright/test";
import type { IntroResult } from "../src/components/intro/bootstrap";
import { DEADLINE_GRACE_MS, START_BUDGET_MS } from "../src/components/intro/config";
import { DEW, STROKES } from "../src/components/intro/geometry";
import { LOOP_RIPPLES, PERIOD, SETTLED } from "../src/components/intro/timing";

declare global {
  interface Window {
    __qa?: { results: IntroResult[]; shifts: number[] };
    __tool?: { execute: (input: unknown) => object };
  }
}

const SETTLED_MS = SETTLED * 1000;
const SCRIPTS = "**/_next/static/**/*.js";
const BOOTSTRAP = /<script id="kiasa-intro-bootstrap">[\s\S]*?<\/script>/;
const INK = "#ECFFF3";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const qa = { results: [] as IntroResult[], shifts: [] as number[] };
    window.__qa = qa;
    window.addEventListener("kiasa:intro-complete", event => qa.results.push((event as CustomEvent).detail));
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) qa.shifts.push(shift.value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
});

/** Waits for the entrance to end and returns how it ended. Polls on a timer so it also works when frames are frozen. */
async function ended(page: Page) {
  await page.waitForFunction(() => !!window.__kiasaIntro?.result, undefined, { polling: 50 });
  return page.evaluate(() => window.__kiasaIntro!.result!);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

/** Serves the homepage with its inline bootstrap rewritten (or removed). */
async function rewriteBootstrap(page: Page, rewrite: (script: string) => string) {
  await page.route("/", async route => {
    const response = await route.fetch();
    const html = await response.text();
    expect(html).toMatch(BOOTSTRAP);
    // The body changes length and is no longer compressed or chunked: drop the headers that say otherwise,
    // or the document never finishes loading and React never hydrates.
    const headers = Object.fromEntries(Object.entries(response.headers()).filter(([name]) => !["content-length", "content-encoding", "transfer-encoding"].includes(name)));
    await route.fulfill({ status: response.status(), headers, body: html.replace(BOOTSTRAP, rewrite) });
  });
}

/** What the drawing looks like right now, read from the live DOM. */
function drawing(page: Page) {
  return page.evaluate(() => {
    const opacity = (node: Element) => Number(getComputedStyle(node).opacity);
    // Lines are the paths Motion draws with a normalised dash; the drops' glints are plain arcs.
    const lines = [...document.querySelectorAll(".mark-lines > path[pathLength]")];
    const lit = (selector: string) => [...document.querySelectorAll(selector)].filter(node => opacity(node) > 0.05).length;
    // The bar's fill slides in from the left: how much of the track it covers, 0–1.
    const track = document.querySelector(".mark-bar")!.getBoundingClientRect();
    const fill = document.querySelector(".mark-bar-fill")!.getBoundingClientRect();
    return {
      bar: Math.max(0, Math.min(1, Math.round(((fill.right - track.left) / track.width) * 1000) / 1000)),
      // A line is fully drawn when its dash covers the whole path and it is opaque.
      complete: lines.length > 0 && lines.every(line => line.getAttribute("stroke-dasharray")?.startsWith("1 ") && opacity(line) === 1),
      shown: opacity(document.querySelector(".mark-lines")!),
      seed: opacity(document.querySelector(".mark-seed")!),
      // Each travelling light is a group of stacked stretches that fades as one.
      green: lit(".mark-flow > g"),
      blue: lit(".mark-water > g"),
    };
  });
}

/** True once light is travelling: the loop is running. */
const flowing = (page: Page) => expect.poll(async () => (await drawing(page)).green, { timeout: 6000 }).toBeGreaterThan(0);

test.describe("landing page", () => {
  test("draws the leaf once from a small light, then keeps a green line flowing", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/");
    const mark = page.locator("svg.mark");
    await expect(mark).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-kiasa-intro", "playing");
    const before = await mark.boundingBox();
    const early = (await drawing(page)).bar;
    // The first stem is drawn live, then completes; the loading bar fills along with the drawing.
    await expect(mark.locator(".mark-lines > path").first()).toHaveAttribute("stroke-dasharray", "1 1");
    expect(await page.evaluate(() => window.__kiasaIntro!.active)).toBe(true);
    const later = (await drawing(page)).bar;
    expect(early).toBeLessThan(later);
    expect(later).toBeLessThan(1);
    const result = await ended(page);
    expect(result.reason).toBe("complete");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(SETTLED_MS);
    expect(result.elapsedMs).toBeLessThan(SETTLED_MS + START_BUDGET_MS);
    await expect(page.locator("html")).not.toHaveAttribute("data-kiasa-intro");
    expect(await mark.boundingBox()).toEqual(before);
    // The bar is full exactly when the drawing is.
    expect(await drawing(page)).toMatchObject({ complete: true, bar: 1 });
    // The landing page does not move on: the same page keeps animating.
    await flowing(page);
    // While the leaf keeps flowing, the bar stays full and still.
    const fill = page.locator(".mark-bar-fill");
    await expect(fill).toHaveCSS("transform", "none");
    await page.waitForTimeout(700);
    await expect(fill).toHaveCSS("transform", "none");
    expect((await drawing(page)).bar).toBe(1);
    await expect(page).toHaveURL(/\/$/);
    const qa = await page.evaluate(() => window.__qa!);
    expect(qa.results).toHaveLength(1);
    expect(qa.shifts.reduce((a, b) => a + b, 0)).toBe(0);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach("runtime-metrics", { body: JSON.stringify({ result, qa }), contentType: "application/json" });
  });

  test("shows the whole leaf and nothing else: no wordmark, no colour artwork, the brand named once", async ({ page }) => {
    await page.goto("/");
    await ended(page);
    const lines = page.locator(".mark-lines");
    // Every measured line of the leaf, each dew drop's ring and its glint.
    await expect(lines.locator("> path")).toHaveCount(STROKES.length + DEW.length);
    await expect(lines.locator("> circle")).toHaveCount(DEW.length);
    for (const stroke of [STROKES[0], STROKES[STROKES.length - 1]]) await expect(lines.locator(`> path[d="${stroke.d}"]`)).toHaveCount(1);
    await expect(page.locator("svg.mark text, main img")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "KIASA" })).toHaveCount(1);
    await expect(page.getByRole("heading")).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveCount(0);
    // Nothing else is on the page: no links, buttons or copy, in development or production.
    await expect(page.locator("main a, main button, main p")).toHaveCount(0);
    await expect(page.locator("svg.mark")).toHaveAttribute("aria-hidden", "true");
    // About half the earlier size, and never too small for the veins.
    const box = (await page.locator("svg.mark").boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(200);
    expect(box.width).toBeLessThanOrEqual(240);
    expect(box.width).toBe(box.height);
    // One small, clean loading bar under the leaf: a pill with a single solid fill and nothing else in it.
    await expect(page.locator(".mark-bar")).toHaveCount(1);
    // The bar and its label are hidden from assistive technology together (checked below).
    await expect(page.locator(".mark-loader > .mark-bar")).toHaveCount(1);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.locator(".mark-bar > *")).toHaveCount(1);
    await expect(page.locator(".mark-bar-fill")).toHaveCSS("background-color", "rgb(184, 236, 147)");
    await expect(page.locator(".mark-bar-fill")).toHaveCSS("background-image", "none");
    await expect(page.locator(".mark-bar")).toHaveCSS("border-radius", "1.5px");
    const bar = (await page.locator(".mark-bar").boundingBox())!;
    // Thin, and a whole-pixel size so its edges are sharp.
    expect(bar.height).toBe(3);
    expect(Number.isInteger(bar.width)).toBe(true);
    expect(bar.width).toBeLessThan(box.width / 2);
    expect(bar.y).toBeGreaterThan(box.y + box.height);
    expect(Math.abs(bar.x + bar.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(0.5);
    // A small "Loading..." label under the bar, centred on the word, decorative like the bar.
    const label = page.locator(".mark-label");
    await expect(label).toHaveText("Loading...");
    await expect(page.locator(".mark-loader")).toHaveAttribute("aria-hidden", "true");
    const word = (await label.boundingBox())!;
    expect(word.y).toBeGreaterThan(bar.y + bar.height);
    expect(word.height).toBeLessThanOrEqual(16);
    expect(Math.abs(word.x + word.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(2);
  });

  test("before scripts arrive only the small light shows; if they never arrive the finished leaf does", async ({ page }) => {
    await page.route(SCRIPTS, route => route.abort());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-kiasa-intro", "waiting");
    const waiting = await drawing(page);
    expect(waiting).toMatchObject({ shown: 0, seed: 1, bar: 0 });
    const result = await ended(page);
    expect(result.reason).toBe("initialization-error");
    expect(result.elapsedMs).toBeLessThan(START_BUDGET_MS + 500);
    await expect.poll(async () => (await drawing(page)).shown).toBe(1);
    expect(await drawing(page)).toMatchObject({ complete: true, seed: 0, bar: 1 });
  });

  test("without JavaScript the finished leaf is the page", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.locator("svg.mark")).toBeVisible();
    await expect(page.locator(".mark-lines > path").first()).toHaveAttribute("stroke-dasharray", "1 1");
    await expect(page.locator(".mark-lines > path").first()).toHaveCSS("opacity", "1");
    await expect(page.locator(".mark-lines")).toHaveCSS("opacity", "1");
    await expect(page.locator(".mark-seed")).toHaveCSS("opacity", "0");
    await expect(page.locator(".mark-bar-fill")).toHaveCSS("transform", "none");
    await expect(page.getByRole("heading", { name: "KIASA" })).toHaveCount(1);
    await context.close();
  });

  test("a blocked inline script still shows the leaf, and it still flows", async ({ page }) => {
    await rewriteBootstrap(page, () => "");
    await page.goto("/");
    expect(await page.evaluate(() => window.__kiasaIntro)).toBeUndefined();
    expect((await drawing(page)).complete).toBe(true);
    await flowing(page);
  });

  test("Escape ends the entrance at once and the leaf is complete", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-kiasa-intro", "playing");
    await page.keyboard.press("Escape");
    const result = await ended(page);
    expect(result.reason).toBe("skip");
    expect(result.elapsedMs).toBeLessThan(SETTLED_MS);
    await expect.poll(async () => (await drawing(page)).complete).toBe(true);
    await flowing(page);
    expect(await page.evaluate(() => window.__qa!.results.length)).toBe(1);
  });

  test("reduced motion shows the finished leaf from first paint and keeps it still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect((await ended(page)).reason).toBe("reduced-motion");
    await expect(page.locator("html")).not.toHaveAttribute("data-kiasa-intro");
    await page.waitForTimeout(1200);
    const still = await drawing(page);
    expect(still).toMatchObject({ complete: true, shown: 1, seed: 0, green: 0, blue: 0, bar: 1 });
  });

  test("switching to reduced motion stops the entrance, and later the loop; switching back resumes", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-kiasa-intro", "playing");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect((await ended(page)).reason).toBe("reduced-motion");
    await expect.poll(async () => (await drawing(page)).complete).toBe(true);
    await page.waitForTimeout(800);
    expect(await drawing(page)).toMatchObject({ green: 0, blue: 0 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await flowing(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(async () => (await drawing(page)).green).toBe(0);
    expect((await drawing(page)).complete).toBe(true);
  });

  test("every homepage load draws the leaf again, with or without session storage", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Blocked"); } }));
    await page.goto("/");
    expect((await ended(page)).reason).toBe("complete");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-kiasa-intro", /waiting|playing/);
    expect(await page.evaluate(() => window.__kiasaIntro!.active)).toBe(true);
  });

  test("an entrance overdue in a background tab settles the moment the visitor returns", async ({ page }) => {
    // A background tab: no animation frames, and the watchdog's timer throttled far into the future.
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
      const original = window.setTimeout;
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...rest: unknown[]) =>
        original(handler, timeout && timeout >= 2000 ? 600000 : timeout, ...rest)) as typeof setTimeout;
    });
    await page.goto("/");
    await page.waitForTimeout(START_BUDGET_MS + SETTLED_MS + DEADLINE_GRACE_MS + 200);
    expect(await page.evaluate(() => window.__kiasaIntro!.result)).toBeUndefined();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect((await ended(page)).reason).toBe("expired");
    await expect(page.locator("html")).not.toHaveAttribute("data-kiasa-intro");
  });

  test("dashboard deep links never opt in to the entrance", async ({ page }) => {
    await page.goto("/dashboard");
    expect(await page.evaluate(() => window.__kiasaIntro)).toBeUndefined();
    await expect(page.locator("html")).not.toHaveAttribute("data-kiasa-intro");
  });
});

test.describe("once-per-session policy", () => {
  // The same inline script the site ships, with only its policy argument switched.
  test.beforeEach(async ({ page }) => {
    await rewriteBootstrap(page, script => {
      expect(script).toContain('"every-visit"');
      return script.replace('"every-visit"', '"once-per-session"');
    });
  });

  test("a returning session starts with the finished leaf, even before hydration", async ({ page }) => {
    await page.goto("/");
    expect((await ended(page)).reason).toBe("complete");
    await page.route(SCRIPTS, route => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await ended(page)).reason).toBe("returning-visit");
    await expect(page.locator("html")).not.toHaveAttribute("data-kiasa-intro");
    expect(await drawing(page)).toMatchObject({ complete: true, shown: 1, seed: 0 });
  });

  test("a returning session with scripts goes straight to the flowing leaf", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Escape");
    await ended(page);
    await page.reload();
    expect((await ended(page)).reason).toBe("returning-visit");
    expect((await drawing(page)).complete).toBe(true);
    await flowing(page);
  });

  test("unavailable session storage fails open to the finished leaf", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Blocked"); } }));
    await page.goto("/");
    expect((await ended(page)).reason).toBe("storage-unavailable");
    expect((await drawing(page)).complete).toBe(true);
  });
});

test.describe("choreography (development inspector)", () => {
  test.beforeEach(({}, info) => { test.skip(!!info.config.metadata.production, "Uses the development inspector"); });

  const frame = async (page: Page, time: number) => {
    await page.goto(`/dev/intro?t=${time}`);
    return page.evaluate(() => {
      const opacity = (node: Element) => Number(getComputedStyle(node).opacity);
      const visible = (selector: string) => [...document.querySelectorAll(selector)].filter(node => opacity(node) > 0.05);
      // A light is a group of stacked stretches; report the colours of the ones that are lit.
      const colours = (selector: string) => visible(selector).flatMap(light => [...light.querySelectorAll("path")].map(node => getComputedStyle(node).stroke));
      return {
        ink: [...new Set(visible(".mark-lines > path, .mark-lines > circle").map(node => getComputedStyle(node).stroke))],
        green: colours(".mark-flow > g"),
        blue: colours(".mark-water > g"),
      };
    });
  };
  const channels = (colour: string) => colour.match(/\d+/g)!.map(Number);
  /** From deep green to the almost white tip: green is the strongest channel. */
  const greenish = (colour: string) => { const [r, g, b] = channels(colour); return g >= r && g > b; };
  const bluish = (colour: string) => { const [r, g, b] = channels(colour); return b > r && b > g; };

  test("the leaf is drawn in one ink; colour appears only afterwards, green on lines and blue on dew", async ({ page }) => {
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    // Mid-drawing and at rest: pale ink only, no colour anywhere.
    for (const time of [SETTLED * 0.5, SETTLED]) {
      const drawn = await frame(page, time);
      expect(drawn.ink).toEqual([rgb(INK)]);
      expect(drawn.green).toEqual([]);
      expect(drawn.blue).toEqual([]);
    }
    // Early in the loop green light is travelling over the unchanged white drawing.
    const running = await frame(page, SETTLED + 0.45);
    expect(running.ink).toEqual([rgb(INK)]);
    expect(running.green.length).toBeGreaterThan(0);
    expect(running.green.filter(colour => !greenish(colour))).toEqual([]);
    // The light reaches a drop still green, and has turned blue by the time it has wrapped it.
    const ripple = LOOP_RIPPLES.get("crown-a")!;
    const touching = await frame(page, SETTLED + ripple.offset + 0.03);
    expect(touching.blue.some(greenish)).toBe(true);
    const wrapped = await frame(page, SETTLED + ripple.offset + ripple.wrap);
    expect(wrapped.blue.length).toBeGreaterThan(0);
    expect(wrapped.blue.filter(colour => !bluish(colour))).toEqual([]);
  });

  test("the loop repeats: a frame one period later is the same frame", async ({ page }) => {
    const at = async (time: number) => {
      await page.goto(`/dev/intro?t=${time}`);
      // Every light: where it is and how strong. Lights that are out are all alike.
      return page.evaluate(() => [...document.querySelectorAll(".mark-flow > g, .mark-water > g")].map(light => {
        const opacity = Number(getComputedStyle(light).opacity);
        if (opacity < 0.002) return "out";
        const stretch = light.querySelector("path")!;
        return [opacity.toFixed(3), Number(stretch.getAttribute("stroke-dashoffset") ?? 0).toFixed(3), stretch.getAttribute("stroke-dasharray")?.split(" ").map(part => Number(part).toFixed(3)).join(" ")].join("|");
      }));
    };
    const first = await at(SETTLED + 1.3);
    expect(await at(SETTLED + PERIOD + 1.3)).toEqual(first);
    // And the line really is somewhere else a moment later.
    expect(await at(SETTLED + 1.8)).not.toEqual(first);
  });
});

test.describe("StartupBoundary (development fixture)", () => {
  test.beforeEach(({}, info) => { test.skip(!!info.config.metadata.production, "Development-only request fixture"); });

  for (const action of ["complete", "skip"] as const) test(`a pending request keeps the mark up, truthfully, after ${action}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/dev/intro/resource", async route => { await gate; await route.fulfill({ json: { ready: true } }); });
    await page.goto("/?intro-test=loading");
    const stage = page.locator("#kiasa-intro");
    await expect(stage).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    if (action === "skip") await page.getByRole("link", { name: "Skip intro" }).click();
    expect((await ended(page)).reason).toBe(action);
    // Callbacks fire once each, including under development Strict Mode.
    await expect(page.locator("[data-completions]")).toHaveAttribute("data-completions", "1");
    await expect(page.locator("[data-skips]")).toHaveAttribute("data-skips", action === "skip" ? "1" : "0");
    // Still genuinely loading: the mark stays, says so to assistive technology, and offers nothing to skip.
    await expect(stage).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Loading…");
    await expect(page.getByRole("link", { name: "Skip intro" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "The request finished" })).toHaveCount(0);
    release();
    await expect(page.getByRole("heading", { name: "The request finished" })).toBeVisible();
    await expect(stage).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.locator("#site-content")).not.toHaveAttribute("inert", "");
  });

  test("a ready page is covered only for the entrance; Skip is keyboard reachable and focus moves into the page", async ({ page }) => {
    await page.route("**/dev/intro/resource", route => route.fulfill({ json: { ready: true } }));
    await page.goto("/?intro-test=loading");
    await expect(page.locator("#kiasa-intro")).toBeVisible();
    await expect(page.locator("#site-content")).toHaveAttribute("inert", "");
    for (const key of ["Tab", "Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      await expect(page.getByRole("link", { name: "Skip intro" })).toBeFocused();
    }
    await page.keyboard.press("Enter");
    expect((await ended(page)).reason).toBe("skip");
    await expect(page.locator("#kiasa-intro")).toHaveCount(0);
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(page.locator("#site-content")).not.toHaveAttribute("inert", "");
  });

  test("the optional WebMCP Skip shares the UI action and rejects invalid input", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "modelContext", { value: {
        registerTool(tool: { execute: (input: unknown) => object }, { signal }: { signal: AbortSignal }) {
          window.__tool = tool;
          signal.addEventListener("abort", () => { if (window.__tool === tool) delete window.__tool; });
        },
      } });
    });
    await page.goto("/?intro-test=loading");
    await page.waitForFunction(() => !!window.__tool);
    expect(await page.evaluate(() => {
      try { window.__tool!.execute({ unexpected: true }); return false; } catch { return true; }
    })).toBe(true);
    expect(await page.evaluate(() => window.__tool!.execute({}))).toEqual({ dismissed: true });
    expect((await ended(page)).reason).toBe("skip");
  });
});

test("production hides the inspector and the request fixture", async ({ page }, info) => {
  test.skip(!info.config.metadata.production, "Production guard");
  const response = await page.goto("/dev/intro");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("slider")).toHaveCount(0);
  expect((await page.request.get("/dev/intro/resource")).status()).toBe(404);
  await page.goto("/?intro-test=loading");
  await expect(page.locator("#kiasa-intro, .dev-site")).toHaveCount(0);
  await expect(page.locator("svg.mark")).toBeVisible();
});
