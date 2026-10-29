/** Job links as admins paste them: cleaned, read line by line, and the company
 * told from the address where the common hiring sites put it there. Used in the
 * browser (posting) and on the server (finding titles). */

/** Parts of a link that only track who clicked it; taken away so a job is posted once. */
const TRACKING = /^(utm_|trk|refid$|trackingid$|fbclid$|gclid$|mc_cid$|mc_eid$|ebp$|lipi$|_hs|src$|source$)/i;

/** The link as it is kept: http(s) only, without its #part or tracking. A
 * LinkedIn or Indeed job keeps only its own address, however it was reached
 * (a search, a feed, a link with the title in it), so it is posted once. */
export function cleanLink(link: string): string | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  const host = url.hostname.toLowerCase();
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = url.searchParams.get("currentJobId") ?? url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1];
    if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
  }
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) {
    const key = url.searchParams.get("jk") ?? url.searchParams.get("vjk");
    if (key && /^[\w-]+$/.test(key)) return `https://${host}/viewjob?jk=${key}`;
  }
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.toString();
}

const pretty = (slug: string | null | undefined) => {
  const words = (slug ?? "").replace(/[-_+.]+/g, " ").split(/\s+/).filter(Boolean);
  return words.length ? words.map(word => word[0].toUpperCase() + word.slice(1)).join(" ").slice(0, 120) : null;
};

/** Boards that list many companies' jobs: their address does not name the company. */
const BOARDS = /(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|wellfound|angel|monster|dice|remoteok|weworkremotely|simplyhired|careerbuilder|google|builtin|otta|welcometothejungle|hired)\.[a-z.]+$/;

/** The company, where the address says it. */
export function companyFromLink(link: string): string | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  // A bare address (an IP, or a machine's own name) names no company.
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || !host.includes(".")) return null;
  const first = url.pathname.split("/").filter(Boolean)[0];
  const sub = host.split(".")[0];
  if (/(^|\.)greenhouse\.io$/.test(host)) return pretty(first === "embed" ? url.searchParams.get("for") : first);
  if (["jobs.lever.co", "jobs.ashbyhq.com", "apply.workable.com", "jobs.smartrecruiters.com", "jobs.jobvite.com", "careers.jobscore.com"].includes(host)) return pretty(first);
  if (/\.(myworkdayjobs|bamboohr|recruitee|breezy|teamtailor|workable|applytojob|pinpointhq|rippling-ats)\.[a-z.]+$/.test(host)) return pretty(sub);
  if (BOARDS.test(host)) return null;
  // careers.acme.com, jobs.acme.co.uk, acme.com/careers: the name before the ending.
  const parts = host.split(".");
  const ending = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  return pretty(parts[parts.length - ending] ?? null);
}

export type PastedJob = { url: string; title: string | null; company: string | null };

/** What an admin pasted: one job a line, as a bare link or as "Title | Company |
 * link" (a tab works as |). Several links on one line are several jobs. Each
 * link once; anything that is not a link is counted, not kept. */
export function parseLinks(text: string): { jobs: PastedJob[]; skipped: number } {
  const jobs = new Map<string, PastedJob>();
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const found = line.match(/https?:\/\/[^\s<>"'|]+/gi) ?? [];
    if (!found.length) { skipped++; continue; }
    const before = line.slice(0, line.indexOf(found[0] ?? "")).split(/\s*[|\t]\s*/).map(part => part.trim()).filter(Boolean);
    for (const raw of found) {
      const url = cleanLink(raw.replace(/[),.;]+$/, ""));
      if (!url) { skipped++; continue; }
      if (jobs.has(url)) continue;
      const one = found.length === 1;
      jobs.set(url, {
        url,
        title: one && before[0] ? before[0].slice(0, 200) : null,
        company: (one && before[1] ? before[1].slice(0, 120) : null) ?? companyFromLink(url),
      });
    }
  }
  return { jobs: [...jobs.values()], skipped };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" };
const decode = (text: string) => text
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
  .replace(/\s+/g, " ").trim();

function meta(html: string, name: string) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i"))?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") || null : null;
}

export type PageFacts = { title: string | null; company: string | null; location: string | null };

/** Hiring sites' own names: never taken for the company hiring. */
const SITE_NAMES = /^(greenhouse|lever|ashby|workday|linkedin|indeed|glassdoor|ziprecruiter|smartrecruiters|workable|bamboohr|jobvite|recruitee|breezy|teamtailor|wellfound|angellist|monster|dice|built ?in|otta|jobs?|careers?)\b/i;
const word = (value: unknown) => typeof value === "string" ? decode(value) || null : null;
const records = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : [value]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");

/** The job as the page describes it for search engines (schema.org JobPosting,
 * the data Google for Jobs reads): most hiring sites give it. */
function posting(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(match[1].trim()); } catch { continue; }
    const queue: unknown[] = [data];
    while (queue.length) {
      const item = queue.shift();
      if (Array.isArray(item)) { queue.push(...item); continue; }
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const type = record["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return record;
      if (record["@graph"]) queue.push(record["@graph"]);
    }
  }
  return null;
}

/** Where a posting is: "Remote" (with where from, if it says), or its city and country. */
function placeOf(job: Record<string, unknown>) {
  const remote = String(job.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE";
  const allowed = records(job.applicantLocationRequirements).map(entry => word(entry.name)).filter((name): name is string => !!name);
  if (remote) return allowed.length ? `Remote (${allowed.slice(0, 2).join(", ")})` : "Remote";
  for (const spot of records(job.jobLocation)) {
    const address = spot.address;
    if (typeof address === "string") return word(address);
    const [parts] = records(address);
    if (!parts) continue;
    const country = typeof parts.addressCountry === "object" ? records(parts.addressCountry)[0]?.name : parts.addressCountry;
    const said = [parts.addressLocality, parts.addressRegion, country].map(word).filter(Boolean).join(", ");
    if (said) return said;
  }
  return null;
}

const decodeKeepingLines = (text: string) => text
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);

/** Text from a page's HTML, its paragraphs and points on lines of their own. */
function plainText(html: string) {
  const unescaped = html.includes("&lt;") ? decodeKeepingLines(html) : html;
  return decodeKeepingLines(unescaped
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*(script|style)\s*>/gi, " ")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map(line => line.replace(/[ \t ]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").replace(/\n+•/g, "\n•").trim();
}

/** The job's description, as its page gives it to search engines (schema.org
 * JobPosting), in plain text; for the tailored résumés. None when it gives none. */
export function descriptionFromPage(html: string): string | null {
  const job = posting(html);
  const text = typeof job?.description === "string" ? plainText(job.description) : "";
  return text.length >= 80 ? text.slice(0, 30000) : null;
}

/** What a job's own page says about it: first what it tells search engines
 * (its title, the company hiring and where), then its title, read in the known
 * ways the hiring sites write them. A hiring site's own name is never the company. */
export function factsFromPage(link: string, html: string): PageFacts {
  const host = (() => { try { return new URL(link).hostname.toLowerCase(); } catch { return ""; } })();
  const job = posting(html);
  const told: PageFacts = job ? {
    title: word(job.title),
    company: (() => { const name = word(typeof job.hiringOrganization === "string" ? job.hiringOrganization : records(job.hiringOrganization)[0]?.name); return name && !SITE_NAMES.test(name) ? name : null; })(),
    location: placeOf(job),
  } : { title: null, company: null, location: null };
  const said = meta(html, "og:title") ?? decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const read = ((): PageFacts => {
    if (!said) return { title: null, company: null, location: null };
    let match = said.match(/^(.+?) hiring (.+?) in (.+?) \| LinkedIn$/i);
    if (match) return { company: match[1], title: match[2], location: match[3] };
    match = said.match(/^Job Application for (.+) at (.+)$/i);
    if (match) return { title: match[1], company: match[2], location: null };
    if (/indeed\./.test(host)) {
      match = said.match(/^(.+?) - (.+?) - (.+?)(?: \| Indeed\.com)?$/i);
      if (match) return { title: match[1], company: match[2], location: match[3] };
    }
    if (host === "jobs.lever.co" && said.includes(" - ")) {
      const [company, ...rest] = said.split(" - ");
      return { title: rest.join(" - "), company, location: null };
    }
    const title = said.replace(/\s*[|–—-]\s*(LinkedIn|Indeed(\.com)?|Glassdoor|Careers?|Jobs?|Job Board)\s*$/i, "");
    const site = meta(html, "og:site_name");
    return { title: title || null, company: site && !SITE_NAMES.test(site) ? site : null, location: null };
  })();
  const keep = (value: string | null, size: number) => value ? value.slice(0, size) : null;
  return { title: keep(told.title ?? read.title, 200), company: keep(told.company ?? read.company, 120), location: keep(told.location ?? read.location, 120) };
}
