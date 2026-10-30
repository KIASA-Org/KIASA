import "server-only";
import { lookup as lookupEach } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { descriptionFromPage, plainText } from "./links";

/** Addresses inside a network, never fetched: a pasted link must not reach the site's own machines. */
const PRIVATE = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.1[89]\./, /^(22[4-9]|2[3-5]\d)\./, /^::1?$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i, /^::ffff:/i, /^64:ff9b:/i];
const inside = (address: string) => PRIVATE.some(pattern => pattern.test(address));

// The address each connection is really made to, checked too: a name can
// point elsewhere a moment after it was first looked up.
const outward = new Agent({
  connect: {
    lookup: (hostname, options, done) => lookupEach(hostname, options, (error, address, family) => {
      const all = typeof address === "string" ? [address] : (address ?? []).map(entry => entry.address);
      if (!error && all.some(inside)) return done(new Error("A private address"), "", 4);
      (done as (...args: unknown[]) => void)(error, address, family);
    }),
  },
});

async function reachable(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan|home)$/.test(host)) return false;
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map(entry => entry.address);
  return addresses.length > 0 && !addresses.some(inside);
}

/** A job's page (the whole of it: what a page tells search engines is often
 * low down): within six seconds, at most 800 KB, through at most three
 * redirects, each checked. Used by the jobs bot (titles) and the tailored
 * résumés (descriptions). */
export function readPage(link: string): Promise<string | null> {
  return fetchText(link, "text/html,application/xhtml+xml", /html/i);
}

async function fetchText(link: string, accept: string, kind: RegExp): Promise<string | null> {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  for (let hop = 0; hop < 4; hop++) {
    if (!(await reachable(url))) return null;
    const response = await undiciFetch(url, {
      dispatcher: outward, redirect: "manual", signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; KIASA-Jobs/1.0)", accept, "accept-language": "en" },
    }).catch(() => null);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      url = new URL(next, url);
      continue;
    }
    if (!response.ok || !kind.test(response.headers.get("content-type") ?? "") || !response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < 800_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    return html;
  }
  return null;
}

/** A Greenhouse job a link points at: its board and number. Greenhouse's own
 * pages (job-boards. and boards.greenhouse.io/<board>/jobs/<number>, and the
 * embed), or a company's careers page with ?gh_jid=<number>, whose board is
 * then most likely the company's name. */
function greenhouseJob(link: string): { boards: string[]; id: string } | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const path = url.pathname.match(/^\/([\w-]+)\/jobs\/(\d+)/);
    if (path) return { boards: [path[1]], id: path[2] };
    const board = url.searchParams.get("for"), id = url.searchParams.get("token");
    if (board && id && /^\d+$/.test(id)) return { boards: [board], id };
    return null;
  }
  const id = url.searchParams.get("gh_jid");
  if (!id || !/^\d+$/.test(id)) return null;
  const parts = host.replace(/^www\./, "").split(".");
  const name = parts[parts.length - (parts.length > 2 && parts[parts.length - 2].length <= 3 ? 3 : 2)] ?? "";
  return name ? { boards: [name, name.replace(/-/g, "")], id } : null;
}

/** A job's description, for the tailored résumés: what its page tells search
 * engines (most hiring sites: Ashby, Lever, Workday, …), or, from Greenhouse,
 * whose pages do not, its public job board. None when neither says. */
export async function descriptionFor(link: string): Promise<string | null> {
  const greenhouse = greenhouseJob(link);
  for (const board of greenhouse?.boards ?? []) {
    const json = await fetchText(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${greenhouse!.id}`, "application/json", /json/i);
    let content = "";
    try { content = String((JSON.parse(json ?? "{}") as { content?: unknown }).content ?? ""); } catch { content = ""; }
    const text = content ? plainText(content) : "";
    if (text.length >= 80) return text.slice(0, 30000);
  }
  // Lever: its public postings API (its pages can be slow to answer).
  const lever = link.match(/^https:\/\/jobs\.(?:eu\.)?lever\.co\/([\w.-]+)\/([0-9a-f-]{36})/i);
  if (lever) {
    const json = await fetchText(`https://api.lever.co/v0/postings/${lever[1]}/${lever[2]}`, "application/json", /json/i);
    try {
      const job = JSON.parse(json ?? "{}") as { descriptionPlain?: string; lists?: { text?: string; content?: string }[]; additionalPlain?: string };
      const text = [job.descriptionPlain ?? "", ...(job.lists ?? []).map(list => `${list.text ?? ""}\n${plainText(list.content ?? "").replace(/^/gm, "• ")}`), job.additionalPlain ?? ""]
        .map(part => part.trim()).filter(Boolean).join("\n\n");
      if (text.length >= 80) return text.slice(0, 30000);
    } catch { /* the page, then */ }
  }
  // Hiring sites whose pages are written in the browser (so KIASA's reading
  // sees nothing) or may leave the description out: their public job feeds.
  for (const feed of [workable, smartRecruiters, workday, ashby]) {
    const text = await feed(link).catch(() => null);
    if (text && text.length >= 80) return text.slice(0, 30000);
  }
  const html = await readPage(link);
  return html ? descriptionFromPage(html) : null;
}

const json = async (link: string) => {
  const text = await fetchText(link, "application/json", /json/i);
  try { return text ? JSON.parse(text) as Record<string, unknown> : null; } catch { return null; }
};
const joined = (parts: unknown[]) => parts.map(part => typeof part === "string" ? plainText(part).trim() : "").filter(Boolean).join("\n\n");
const linkOf = (link: string) => { try { return new URL(link); } catch { return null; } };

/** Workable: apply.workable.com/<account>/j/<code>, or <account>.workable.com/j/<code>. */
async function workable(link: string) {
  const url = linkOf(link);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const path = host === "apply.workable.com" ? url.pathname.match(/^\/([\w-]+)\/j\/([0-9A-F]{6,})/i)
    : /^[\w-]+\.workable\.com$/.test(host) && host !== "jobs.workable.com" ? [null, host.split(".")[0], url.pathname.match(/\/j\/([0-9A-F]{6,})/i)?.[1]] : null;
  if (!path?.[1] || !path[2]) return null;
  const job = await json(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(path[1])}/jobs/${encodeURIComponent(path[2])}`);
  return job ? joined([job.description, job.requirements && `<h3>Requirements</h3>${job.requirements}`, job.benefits && `<h3>Benefits</h3>${job.benefits}`]) : null;
}

/** SmartRecruiters: jobs.smartrecruiters.com/<company>/<number>-<title>. */
async function smartRecruiters(link: string) {
  const path = linkOf(link)?.pathname.match(/^\/([\w-]+)\/(\d{6,})/);
  if (!path || !/^(jobs|careers)\.smartrecruiters\.com$/i.test(linkOf(link)!.hostname)) return null;
  const job = await json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(path[1])}/postings/${path[2]}`);
  const sections = ((job?.jobAd as { sections?: Record<string, { title?: string; text?: string }> } | undefined)?.sections) ?? {};
  return joined(["jobDescription", "qualifications", "additionalInformation", "companyDescription"].map(key => sections[key]?.text && `<h3>${sections[key].title ?? ""}</h3>${sections[key].text}`));
}

/** Workday: <tenant>.wd<n>.myworkdayjobs.com/[<language>/]<site>/job/<…>. */
async function workday(link: string) {
  const url = linkOf(link);
  if (!url || !/^[\w-]+\.wd\d+\.myworkdayjobs\.com$/i.test(url.hostname)) return null;
  const path = url.pathname.match(/^(?:\/[a-z]{2}-[A-Z]{2})?\/([\w-]+)(\/job\/.+?)(?:\/apply.*)?$/);
  if (!path) return null;
  const job = await json(`https://${url.hostname}/wday/cxs/${url.hostname.split(".")[0]}/${path[1]}${path[2]}`);
  return joined([(job?.jobPostingInfo as { jobDescription?: string } | undefined)?.jobDescription]);
}

/** Ashby: jobs.ashbyhq.com/<company>/<id>, from the company's whole board. */
async function ashby(link: string) {
  const path = link.match(/^https:\/\/jobs\.ashbyhq\.com\/([\w.%-]+)\/([0-9a-f-]{36})/i);
  if (!path) return null;
  const board = await json(`https://api.ashbyhq.com/posting-api/job-board/${path[1]}`);
  const job = ((board?.jobs ?? []) as { id?: string; descriptionHtml?: string; descriptionPlain?: string }[]).find(entry => entry.id === path[2]);
  return job ? (job.descriptionPlain?.trim() || joined([job.descriptionHtml])) : null;
}
