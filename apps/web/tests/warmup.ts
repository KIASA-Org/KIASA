import { chromium, type FullConfig } from "@playwright/test";

/** Loads each route once before the suite. The development server compiles a
 * route on its first request; without this, that one-off delay would count
 * against the entrance's start budget in whichever test happened to run first.
 */
export default async function warmup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const path of ["/", "/?intro-test=loading", "/dev/intro"]) {
    await page.goto(baseURL + path, { waitUntil: "networkidle" }).catch(() => {});
  }
  await browser.close();
}
