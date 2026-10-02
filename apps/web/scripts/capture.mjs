// Writes inspection screenshots to artifacts/: named frames of the entrance and
// the loop from the development inspector, plus the live homepage at rest.
// Needs the development server: npm run dev   (then: node scripts/capture.mjs)
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.KIASA_DEV_URL ?? "http://127.0.0.1:3000";
// The inspector's named frames: the entrance, the finished drawing, then light in each leaf.
const FRAMES = ["Light", "Stems", "Veins", "Dew", "At rest", "Crown", "Right leaf", "Left leaf"];
const hideTools = ".preview-panel,.preview-caption{visibility:hidden!important}";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const [name, viewport, deviceScaleFactor] of [["desktop", { width: 1440, height: 900 }, 1], ["mobile", { width: 390, height: 844 }, 3]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${BASE}/dev/intro`, { waitUntil: "networkidle" });
  for (const frame of FRAMES) {
    // Each button sets the scene clock; the scene is a pure function of it.
    await page.getByRole("button", { name: frame, exact: true }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `artifacts/${name}-${frame.toLowerCase().replace(" ", "-")}.png`, style: hideTools });
  }
  // The real homepage, once the entrance has finished and the loop is running.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__kiasaIntro?.result);
  const result = await page.evaluate(() => window.__kiasaIntro.result);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `artifacts/${name}-homepage.png`, style: hideTools });
  const mark = await page.locator("svg.mark").boundingBox();
  report.push({ viewport: name, result, mark, errors });
  await page.close();
}
await browser.close();
await writeFile("artifacts/visual-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
