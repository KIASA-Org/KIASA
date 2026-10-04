import { canopy } from "./canopy";
import { footer, navigation, news, spotlight, stories } from "./site";

/** A page the site links to. Only the homepage is designed so far; every other
 * page is listed here so its link, title and place in the site are already real. */
export type PlannedPage = { href: string; title: string; section: string; summary: string };

const DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });
/** "2026-09-29" → "September 29, 2026", the same on the server and in every browser. */
export const formatDay = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

/** Pages already designed, with routes of their own. They are left out of the
 * placeholder pages, but search and the site's link checks know them. */
export const designedPages: PlannedPage[] = [
  { href: canopy.href, title: canopy.name, section: "Announcement", summary: canopy.description },
];
const designed = new Set(designedPages.map(page => page.href));

function collect(): PlannedPage[] {
  const pages: PlannedPage[] = [];
  for (const item of navigation) {
    pages.push({ href: item.href, title: item.label, section: "KIASA", summary: item.summary });
    for (const group of item.groups ?? []) {
      for (const link of group.links) pages.push({ href: link.href, title: link.label, section: group.label, summary: link.summary ?? "" });
    }
  }
  for (const story of stories) pages.push({ href: story.href, title: story.title, section: story.kind, summary: story.summary });
  pages.push({ href: spotlight.film.cta.href, title: spotlight.film.title, section: "Film series", summary: spotlight.film.description });
  pages.push({ href: "/client-stories", title: "Client stories", section: "KIASA", summary: "How the systems we helped build are working today, told by the people who run them." });
  for (const story of spotlight.stories) pages.push({ href: story.href, title: story.title, section: "Case study", summary: "" });
  for (const item of news.items) pages.push({ href: item.href, title: item.title, section: "News", summary: formatDay(item.date) });
  const plain: Record<string, string> = {
    "/contact": "Tell us what you are working on. A partner will reply within two working days.",
    "/sitemap": "Every page on this site, in one list.",
    "/privacy": "What we collect, why, and the choices you have.",
    "/terms": "The terms that apply when you use this site.",
    "/cookies": "The cookies this site sets, and how to change your settings.",
    "/accessibility": "How we build this site to be usable by everyone, and how to tell us where it falls short.",
    "/preferences": "Choose what you hear from us, and how often.",
  };
  for (const link of footer.links) pages.push({ href: link.href, title: link.label, section: "KIASA", summary: plain[link.href] ?? "" });
  // The same page is linked from several places; the first description wins.
  return pages.filter((page, index) => !designed.has(page.href) && pages.findIndex(other => other.href === page.href) === index);
}

export const plannedPages = collect();
export const findPage = (path: string) => plannedPages.find(page => page.href === path);

/** The header's search: every word typed must appear in a page's title or section. */
export function searchPages(query: string, limit = 7): PlannedPage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return [...designedPages, ...plannedPages].filter(page => {
    const text = `${page.title} ${page.section}`.toLowerCase();
    return words.every(word => text.includes(word));
  }).slice(0, limit);
}
