"use server";

import { currentViewer, siteClient } from "@/lib/accounts/server";
import { companyFromLink, descriptionFromPage, factsFromPage } from "./links";
import { descriptionFor, readPage } from "./page";

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
  const { data } = await site.from("jobs").select("id, url, title, company, location, description").in("id", wanted);
  const rows = (data ?? []) as { id: string; url: string; title: string | null; company: string | null; location: string | null; description: string | null }[];
  const readings: JobReading[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(12, rows.length) }, async () => {
    while (next < rows.length) {
      const row = rows[next++];
      // A company named by the admin (not just the address's guess), a title and a description: nothing to read.
      const guessed = companyFromLink(row.url);
      const given = row.company && row.company !== guessed ? row.company : null;
      const named = { id: row.id, title: row.title, company: row.company, location: row.location };
      if (row.title && given && row.description) { readings.push({ ...named, read: true }); continue; }
      const html = await readPage(row.url).catch(() => null);
      const facts = html ? factsFromPage(row.url, html) : null;
      const kept = { title: row.title ?? facts?.title ?? null, company: given ?? facts?.company ?? row.company, location: row.location ?? facts?.location ?? null };
      // Its description, for the members' tailored résumés.
      const description = row.description ?? (html ? descriptionFromPage(html) : null) ?? await descriptionFor(row.url).catch(() => null);
      if (kept.title !== row.title || kept.company !== row.company || kept.location !== row.location || description !== row.description) {
        await site.from("jobs").update({ ...kept, description }).eq("id", row.id);
      }
      readings.push({ id: row.id, ...kept, read: !!kept.title });
    }
  }));
  return readings;
}
