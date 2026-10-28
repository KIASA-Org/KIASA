"use server";

import { lookup as lookupEach } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { currentViewer, siteClient } from "@/lib/accounts/server";
import { companyFromLink, factsFromPage } from "./links";

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
 * redirects, each checked. */
async function readPage(link: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  for (let hop = 0; hop < 4; hop++) {
    if (!(await reachable(url))) return null;
    const response = await undiciFetch(url, {
      dispatcher: outward, redirect: "manual", signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; KIASA-Jobs/1.0)", accept: "text/html,application/xhtml+xml", "accept-language": "en" },
    }).catch(() => null);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      url = new URL(next, url);
      continue;
    }
    if (!response.ok || !/html/i.test(response.headers.get("content-type") ?? "") || !response.body) return null;
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

/** What reading a job's page gave: its title, company and place, as kept, and
 * whether the page could be read for its title. */
export type JobReading = { id: string; title: string | null; company: string | null; location: string | null; read: boolean };

/** The jobs bot's reading: each job's own page, twelve at once, for its title,
 * the company hiring and where. What an admin typed is kept; the company the
 * address suggested gives way to the one the page names. For admins only, up
 * to thirty jobs a call. */
export async function readJobs(ids: string[]): Promise<JobReading[]> {
  const viewer = await currentViewer();
  if (!viewer?.admin || !Array.isArray(ids)) return [];
  const wanted = ids.filter(id => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 30);
  if (!wanted.length) return [];
  const site = siteClient();
  const { data } = await site.from("jobs").select("id, url, title, company, location").in("id", wanted);
  const rows = (data ?? []) as { id: string; url: string; title: string | null; company: string | null; location: string | null }[];
  const readings: JobReading[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(12, rows.length) }, async () => {
    while (next < rows.length) {
      const row = rows[next++];
      // A company named by the admin (not just the address's guess) and a title: nothing to read.
      const guessed = companyFromLink(row.url);
      const given = row.company && row.company !== guessed ? row.company : null;
      if (row.title && given) { readings.push({ ...row, read: true }); continue; }
      const html = await readPage(row.url).catch(() => null);
      const facts = html ? factsFromPage(row.url, html) : null;
      const kept = { title: row.title ?? facts?.title ?? null, company: given ?? facts?.company ?? row.company, location: row.location ?? facts?.location ?? null };
      if (kept.title !== row.title || kept.company !== row.company || kept.location !== row.location) {
        await site.from("jobs").update(kept).eq("id", row.id);
      }
      readings.push({ id: row.id, ...kept, read: !!kept.title });
    }
  }));
  return readings;
}
