import Link from "next/link";
import { plannedPages, type PlannedPage } from "@/content/pages";
import { navigation } from "@/content/site";
import { LeafMark } from "./brand";
import { CtaContent } from "./cta";
import { ArrowRight } from "./icons";
import { SiteShell } from "./shell";

function Rows({ label, pages }: { label: string; pages: readonly { href: string; title: string; summary?: string }[] }) {
  return <nav className="planned-list" aria-label={label}>
    <h2 className="planned-list-label">{label}</h2>
    <ul>
      {pages.map(page => <li key={page.href}>
        <Link href={page.href} prefetch={false} className="planned-row">
          <span className="planned-row-title">{page.title}</span>
          <span className="planned-row-text">{page.summary}</span>
          <ArrowRight />
        </Link>
      </li>)}
    </ul>
  </nav>;
}

/** A page that has its place in the site but is not designed yet. It says so,
 * and still does a page's first job: it tells the visitor where they are and
 * what else is here. A section's own page lists everything in that section. */
export function PlannedPageView({ page }: { page: PlannedPage }) {
  const hub = navigation.find(item => item.href === page.href);
  const siblings = plannedPages.filter(other => other.section === page.section && other.href !== page.href).slice(0, 8);
  return <SiteShell>
    <article className="planned wrap">
      <p className="eyebrow planned-kind">{page.section}</p>
      <h1 className="planned-title">{page.title}</h1>
      {page.summary && <p className="planned-lead">{page.summary}</p>}

      <aside className="planned-note">
        <LeafMark className="planned-mark" weight={1.5} />
        <div>
          <h2>This page is still growing</h2>
          <p>The homepage sets the direction for the whole site. This page has its place in the plan; its own design comes next.</p>
          <Link href="/" className="cta"><CtaContent>Back to the homepage</CtaContent></Link>
        </div>
      </aside>

      {hub?.groups
        ? hub.groups.map(group => <Rows key={group.label} label={group.label} pages={group.links.map(link => ({ href: link.href, title: link.label, summary: link.summary }))} />)
        : siblings.length > 0 && <Rows label={page.section === "KIASA" ? "Elsewhere on the site" : `More under “${page.section}”`} pages={siblings} />}
    </article>
  </SiteShell>;
}
