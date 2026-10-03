import { test, expect, type Page } from "@playwright/test";
import { SESSION_KEY } from "../src/components/intro/config";
import { plannedPages, searchPages } from "../src/content/pages";
import { careers, footer, hero, navigation, news, popularSearches, recognition, regions, spotlight, stories } from "../src/content/site";

const HEADLINE = hero.headline.join(" ");

/** Opens a page as a returning visitor, so the entrance does not stand in front
 * of it, and waits until its controls have been hydrated and will answer. */
async function open(page: Page, path = "/") {
  await page.addInitScript(key => { try { sessionStorage.setItem(key, "seen"); } catch { /* storage blocked */ } }, SESSION_KEY);
  const response = await page.goto(path);
  // React marks the elements it has taken over; before that a click does nothing.
  await page.waitForFunction(() => {
    const header = document.querySelector(".masthead");
    return !!header && Object.keys(header).some(key => key.startsWith("__reactFiber"));
  });
  return response;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

/** Walks down the page as a visitor would, so images load and scroll effects run. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 600) {
    await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(60);
  }
}

test.describe("homepage", () => {
  test("has the planned sections in order, with their content, and nothing overflows or fails", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeAttached();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
    // The model's order: hero, featured cards, client spotlight, recognition, careers, news.
    expect(await page.locator("main h2").allTextContents()).toEqual([hero.kicker, "Featured", spotlight.heading, recognition.heading, careers.heading, news.heading]);

    await expect(page.locator(".story")).toHaveCount(stories.length);
    for (const story of stories) await expect(page.getByRole("heading", { level: 3, name: story.title, exact: true })).toBeAttached();
    await expect(page.getByRole("blockquote")).toHaveCount(1);
    await expect(page.locator(".spotlight-item")).toHaveCount(spotlight.stories.length);
    await expect(page.locator(".recog-card")).toHaveCount(recognition.items.length);
    await expect(page.locator(".news-item")).toHaveCount(news.items.length);
    // The footer: the lockup, then the standing links, and the notice that this is sample content.
    await expect(page.getByRole("contentinfo").getByRole("link")).toHaveCount(footer.links.length + 1);
    await expect(page.getByRole("contentinfo")).toContainText(footer.sampleNotice);

    await scrollThrough(page);
    // Every image is described, or marked as decoration, and none of them failed to load.
    // (A card still off to the side of a phone's screen has not asked for its picture yet.)
    await expect(page.locator("img:not([alt])")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(await page.locator("main img").evaluateAll(images => images.filter(image => (image as HTMLImageElement).complete && !(image as HTMLImageElement).naturalWidth).length)).toBe(0);
    expect(await page.locator("main img").evaluateAll(images => images.filter(image => (image as HTMLImageElement).naturalWidth > 0).length)).toBeGreaterThanOrEqual(4);
    // Every control says what it is.
    expect(await page.locator("a, button, summary").evaluateAll(controls => controls.filter(control => !(control.getAttribute("aria-label") ?? control.textContent ?? "").trim()).length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("a card opens its summary in a dialog; Escape closes it and focus returns to the card", async ({ page }) => {
    await open(page);
    const story = stories[1];
    const card = page.getByRole("button", { name: `Expand: ${story.title}` });
    await card.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: story.title })).toBeVisible();
    await expect(dialog).toContainText(story.summary);
    await expect(dialog.getByRole("link", { name: story.cta })).toHaveAttribute("href", story.href);
    // The page behind does not scroll while the dialog is open.
    await expect(page.locator("html")).toHaveCSS("overflow-y", "hidden");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(card).toBeFocused();
    // The Close button works as well.
    await card.click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  test("the news row can be paused and stepped with its arrows", async ({ page }) => {
    await open(page);
    const track = page.locator(".news-track");
    await track.scrollIntoViewIfNeeded();
    const position = () => track.evaluate(node => Math.round(node.scrollLeft));
    const pause = page.getByRole("button", { name: "Pause the news" });
    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    expect(await position()).toBe(0);
    await page.getByRole("button", { name: "Next headline" }).click();
    await expect.poll(position).toBeGreaterThan(100);
    await page.getByRole("button", { name: "Previous headline" }).click();
    await expect.poll(position).toBe(0);
    // Back from the first headline goes round to the last.
    await page.getByRole("button", { name: "Previous headline" }).click();
    await expect.poll(position).toBeGreaterThan(100);
  });

  test("the hero's swaying leaf and its lights can be paused", async ({ page }) => {
    await open(page);
    const light = page.locator(".hero-lights path").first();
    const sway = page.locator(".hero-sway");
    await expect(light).toHaveCSS("animation-play-state", "running");
    await expect(sway).toHaveCSS("animation-play-state", "running");
    const toggle = page.getByRole("button", { name: "Pause background motion" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(light).toHaveCSS("animation-play-state", "paused");
    await expect(sway).toHaveCSS("animation-play-state", "paused");
    await toggle.click();
    await expect(light).toHaveCSS("animation-play-state", "running");
    await expect(sway).toHaveCSS("animation-play-state", "running");
  });

  test("with reduced motion nothing moves by itself, and the controls for it are gone", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    for (const lights of await page.locator(".hero-lights").all()) await expect(lights).toBeHidden();
    await expect(page.locator(".hero-sway")).toHaveCSS("animation-name", "none");
    await expect(page.getByRole("button", { name: "Pause background motion" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Pause the news" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("on a wide screen the recognition heading holds the middle while its cards pass", async ({ page, isMobile }) => {
    test.skip(isMobile, "On a phone the heading scrolls with its cards");
    await open(page);
    const title = page.getByRole("heading", { name: recognition.heading });
    await expect(title).toHaveCSS("position", "sticky");
    const middle = async () => {
      const box = (await title.boundingBox())!;
      return Math.round(box.y + box.height / 2);
    };
    const viewport = page.viewportSize()!;
    for (const depth of [400, 900]) {
      await page.evaluate(offset => {
        const section = document.querySelector(".recog")!;
        window.scrollTo({ top: section.getBoundingClientRect().top + scrollY + offset, behavior: "instant" });
      }, depth);
      await expect.poll(middle).toBeGreaterThan(viewport.height / 2 - 40);
      expect(await middle()).toBeLessThan(viewport.height / 2 + 40);
    }
  });
});

test.describe("header", () => {
  test("a navigation item opens its panel of links; one panel at a time; Escape and a click outside close it", async ({ page, isMobile }) => {
    test.skip(isMobile, "The wide header");
    await open(page);
    const item = navigation[0];
    const trigger = page.getByRole("button", { name: item.label });
    const panel = page.locator(`#panel-${item.id}`);
    await expect(panel).toBeHidden();
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    for (const group of item.groups!) await expect(panel.getByRole("heading", { name: group.label })).toBeVisible();
    // The panel's own title, then every link of every group.
    await expect(panel.getByRole("link")).toHaveCount(1 + item.groups!.flatMap(group => group.links).length);

    const other = navigation.find(entry => entry.groups && entry.id !== item.id)!;
    await page.getByRole("button", { name: other.label }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator(`#panel-${other.id}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(`#panel-${other.id}`)).toBeHidden();
    await expect(page.getByRole("button", { name: other.label })).toBeFocused();

    await trigger.click();
    await expect(panel).toBeVisible();
    await page.mouse.click(700, 780);
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("search lists matching pages as the visitor types", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const field = page.getByRole("searchbox", { name: "Search KIASA" });
    await expect(field).toBeFocused();
    await field.fill("cloud");
    const results = page.locator(".search-result");
    const expected = searchPages("cloud");
    await expect(results).toHaveCount(expected.length);
    await expect(results.first()).toContainText(expected[0].title);
    await expect(results.first()).toHaveAttribute("href", expected[0].href);
    await field.fill("zzzz");
    await expect(results).toHaveCount(0);
    await expect(page.getByText("Nothing found for “zzzz”")).toBeVisible();
    // A popular search fills the field and finds something.
    await field.fill("");
    await page.getByRole("button", { name: popularSearches[1], exact: true }).click();
    await expect(field).toHaveValue(popularSearches[1]);
    await expect(results.first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#panel-search")).toBeHidden();
  });

  test("the region menu lists the regional sites and marks the current one", async ({ page, isMobile }) => {
    test.skip(isMobile, "The wide header");
    await open(page);
    await page.getByRole("button", { name: /^Region and language/ }).click();
    const panel = page.locator("#panel-region");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button")).toHaveCount(regions.length);
    await expect(panel.locator("[aria-current]")).toHaveCount(1);
    await expect(panel.locator("[aria-current]")).toContainText(regions.find(region => region.current)!.region);
    await panel.getByRole("button").nth(1).click();
    await expect(panel).toBeHidden();
  });

  test("on a phone the navigation is one sheet, with one section open at a time", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The menu sheet replaces the navigation on small screens only");
    await open(page);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.locator("#panel-menu");
    await expect(sheet).toBeVisible();
    // The page behind the sheet does not scroll.
    await expect(page.locator("html")).toHaveCSS("overflow-y", "hidden");
    const first = navigation[0], last = navigation[navigation.length - 1];
    const link = sheet.getByRole("link", { name: first.groups![0].links[0].label, exact: true });
    await expect(link).toBeHidden();
    await sheet.locator("summary", { hasText: first.label }).click();
    await expect(link).toBeVisible();
    await sheet.locator("summary", { hasText: last.label }).click();
    await expect(link).toBeHidden();
    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("html")).not.toHaveCSS("overflow-y", "hidden");
  });
});

test.describe("pages still to be designed", () => {
  test("every link on the homepage has a page behind it", async ({ page, request }, info) => {
    await open(page);
    const hrefs = await page.locator("a[href^='/']").evaluateAll(links => [...new Set(links.map(link => link.getAttribute("href")!))]);
    const planned = new Set(["/", ...plannedPages.map(planned => planned.href)]);
    expect(hrefs.length).toBeGreaterThan(60);
    expect(hrefs.filter(href => !planned.has(href))).toEqual([]);
    // The built site answers for every one of them. The development server renders
    // each page on demand, which is slow in bulk, so there one page in eight is asked for.
    const asked = info.config.metadata.production ? hrefs : hrefs.filter((_, index) => index % 8 === 0);
    const answers = await Promise.all(asked.map(async href => ({ href, status: (await request.get(href)).status() })));
    expect(answers.filter(answer => answer.status !== 200)).toEqual([]);
  });

  test("a section's page lists what is in it, and a page inside it names where it belongs", async ({ page }) => {
    const section = navigation[0];
    await open(page, section.href);
    await expect(page.getByRole("heading", { level: 1, name: section.label })).toBeVisible();
    await expect(page.getByRole("heading", { name: "This page is still growing" })).toBeVisible();
    for (const group of section.groups!) {
      await expect(page.getByRole("navigation", { name: group.label }).getByRole("link")).toHaveCount(group.links.length);
    }
    const target = section.groups![0].links[3];
    await page.getByRole("navigation", { name: section.groups![0].label }).getByRole("link", { name: target.label }).click();
    await expect(page).toHaveURL(new RegExp(`${target.href}$`));
    await expect(page.getByRole("heading", { level: 1, name: target.label })).toBeVisible();
    await expect(page.locator(".planned-kind")).toHaveText(section.groups![0].label);
    await expect(page).toHaveTitle(`${target.label} | KIASA`);
    await page.getByRole("link", { name: "Back to the homepage" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  });

  test("an address that is not in the plan is a 404 with a way home", async ({ page }) => {
    const response = await open(page, "/nothing/here");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Nothing has taken root here" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the homepage" })).toHaveAttribute("href", "/");
  });
});
