import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
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

// ── One browser, and one page in it, for the server's life: on Vercel the
// serverless Chromium (@sparticuz/chromium); on a computer, its own Chrome or
// Edge. The page is kept and reused, one résumé after another: that Chromium
// runs as a single process, and closing a page there breaks the browser for
// the next one (the second PDF on a server hung until the server gave up).
type Printer = { browser: Promise<Browser>; page: Promise<Page> };
const shared = globalThis as typeof globalThis & { kiasaPdf?: Printer; kiasaPdfTurn?: Promise<unknown> };
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
function printer(): Promise<Page> {
  if (!shared.kiasaPdf) {
    const browser = launch();
    const page = browser.then(started => {
      started.on("disconnected", () => { if (shared.kiasaPdf?.browser === browser) shared.kiasaPdf = undefined; });
      return started.newPage();
    });
    const kept: Printer = { browser, page };
    page.catch(() => { if (shared.kiasaPdf === kept) shared.kiasaPdf = undefined; });
    shared.kiasaPdf = kept;
  }
  return shared.kiasaPdf.page;
}

/** Letter-size margins; the footer (name, "Page X of Y") sits in the bottom one. */
const MARGINS = { top: "0.5in", right: "0.6in", bottom: "0.6in", left: "0.6in" };

/** Waits for `work`, at most `ms`; then fails, saying what took too long. */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000} s`)), ms); }),
  ]);
}

/** Lets the kept browser go (it no longer answers): the next print starts afresh. */
async function dropPrinter() {
  const kept = shared.kiasaPdf;
  shared.kiasaPdf = undefined;
  await within(kept?.browser.then(open => open.close()) ?? Promise.resolve(), 3000, "Closing Chromium").catch(() => {});
}

async function print(profile: Profile): Promise<Uint8Array<ArrayBuffer>> {
  const page = await within(printer(), 25_000, "Starting Chromium");
  await within(page.setContent(renderResumeHtml(profile, { fontCss: fonts() }), { waitUntil: "load" }), 8000, "Laying out the résumé");
  await within(page.evaluate(() => document.fonts.ready.then(() => undefined)), 4000, "Loading its fonts").catch(() => {});
  const printed = await within(page.pdf({
    format: "Letter", printBackground: true, margin: MARGINS,
    displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: renderResumeFooter(profile),
  }), 12_000, "Printing");
  const out = new Uint8Array(printed.byteLength);
  out.set(printed);
  return out;
}

/** A résumé, printed: the Resume Tailor App's one-column template that
 * applicant tracking systems read cleanly (real text, no tables or columns).
 * One at a time on the kept page; no step may hang (each has a time limit),
 * and if the kept browser no longer answers, a fresh one prints it, once. */
export function resumePdf(profile: Profile): Promise<Uint8Array<ArrayBuffer>> {
  const turn = (shared.kiasaPdfTurn ?? Promise.resolve()).then(async () => {
    try {
      return await print(profile);
    } catch (error) {
      console.warn("Résumé PDF: printing again with a fresh browser:", (error as Error).message);
      await dropPrinter();
      return print(profile);
    }
  });
  shared.kiasaPdfTurn = turn.catch(() => {});
  return turn;
}

/** A résumé's file name as a recruiter should see it: "Jane Doe Resume.pdf".
 * Never the company or the job (that reads as made for them); credentials
 * after a comma ("Jane Doe, Ph.D.") left out; nothing a file name cannot hold. */
export function pdfName(name: string | null | undefined): string {
  const person = (name ?? "").split(",")[0].replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${person ? `${person} ` : ""}Resume.pdf`;
}

/** The Content-Disposition header for a file name, any language's letters kept (RFC 6266). */
export function attachmentHeader(name: string, inline = false): string {
  const plain = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
