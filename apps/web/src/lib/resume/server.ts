import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { renderResumeFooter, renderResumeHtml } from "./resume-html";
import type { Profile } from "./schema";

/** The prompts, as the Resume Tailor App keeps them: the init and tailoring
 * prompts are never edited (prompts/CHECKSUMS.json); the import prompt is the
 * app's own. Read once, from this folder (next.config.ts sends it along). */
const PROMPTS = { init: "AUTO_GENERAGE_PROMPT_init.md", tailor: "AUTO_UPDATE_PROMPT_COMPREHENSIVE.md", import: "IMPORT_PROMPT.md" } as const;
export type PromptName = keyof typeof PROMPTS;
const read = new Map<PromptName, string>();
export function prompt(name: PromptName): string {
  if (!read.has(name)) read.set(name, readFileSync(join(process.cwd(), "src", "lib", "resume", "prompts", PROMPTS[name]), "utf8"));
  return read.get(name)!;
}

// ── The résumé font (Source Sans 3, SIL Open Font License), inlined so every PDF looks the same.
const FAMILY = "Resume Sans";
const SUBSETS = [
  { name: "latin-ext", range: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  { name: "latin", range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
] as const;
const FACES = [{ weight: 400, style: "normal" }, { weight: 400, style: "italic" }, { weight: 600, style: "normal" }, { weight: 700, style: "normal" }] as const;
let fontCss: string | undefined;
function fonts(): string {
  if (fontCss !== undefined) return fontCss;
  try {
    fontCss = SUBSETS.flatMap(subset => FACES.map(face => {
      const data = readFileSync(join(process.cwd(), "src", "lib", "resume", "fonts", `source-sans-3-${subset.name}-${face.weight}-${face.style}.woff2`)).toString("base64");
      return `@font-face{font-family:"${FAMILY}";font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${subset.range};}`;
    })).join("\n");
  } catch {
    fontCss = ""; // system fonts, then
  }
  return fontCss;
}

// ── One browser for the server's life: on Vercel the serverless Chromium
// (@sparticuz/chromium); on a computer, its own Chrome or Edge.
const shared = globalThis as typeof globalThis & { kiasaPdfBrowser?: Promise<Browser> };
async function launch(): Promise<Browser> {
  const { chromium: playwright } = await import("playwright-core");
  if (process.env.VERCEL) {
    const { default: serverless } = await import("@sparticuz/chromium");
    serverless.setGraphicsMode = false;
    return playwright.launch({ args: serverless.args, executablePath: await serverless.executablePath(), headless: true });
  }
  if (process.env.PDF_EXECUTABLE_PATH) return playwright.launch({ executablePath: process.env.PDF_EXECUTABLE_PATH, headless: true });
  let last: unknown = null;
  for (const channel of ["chrome", "msedge"]) {
    try { return await playwright.launch({ channel, headless: true }); } catch (error) { last = error; }
  }
  throw new Error(`No Chrome or Edge here to print PDFs with (${String((last as Error)?.message ?? last).split("\n")[0]})`);
}
function browser(): Promise<Browser> {
  shared.kiasaPdfBrowser ??= launch().then(
    started => { started.on("disconnected", () => { shared.kiasaPdfBrowser = undefined; }); return started; },
    (error: unknown) => { shared.kiasaPdfBrowser = undefined; throw error; },
  );
  return shared.kiasaPdfBrowser;
}

/** Letter-size margins; the footer (name, "Page X of Y") sits in the bottom one. */
const MARGINS = { top: "0.5in", right: "0.6in", bottom: "0.6in", left: "0.6in" };

/** A résumé, printed: the Resume Tailor App's one-column template that
 * applicant tracking systems read cleanly (real text, no tables or columns). */
export async function resumePdf(profile: Profile): Promise<Uint8Array<ArrayBuffer>> {
  const page = await (await browser()).newPage();
  try {
    await page.setContent(renderResumeHtml(profile, { fontCss: fonts() }), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const printed = await page.pdf({
      format: "Letter", printBackground: true, margin: MARGINS,
      displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: renderResumeFooter(profile),
    });
    const out = new Uint8Array(printed.byteLength);
    out.set(printed);
    return out;
  } finally {
    await page.close();
  }
}

/** "Jane_Doe_Acme_Data_Engineer.pdf". */
export function pdfName(...parts: (string | null | undefined)[]): string {
  const name = parts.filter(Boolean).join(" ").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return `${name || "resume"}.pdf`;
}
