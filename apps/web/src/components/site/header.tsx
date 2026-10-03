"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type ReactNode } from "react";
import { searchPages } from "@/content/pages";
import { navigation, popularSearches, regions, type NavItem } from "@/content/site";
import { Lockup } from "./brand";
import { CtaContent } from "./cta";
import { ArrowRight, ChevronDown, Close, Globe, Menu, Search } from "./icons";

/** Which panel is open under the bar: a navigation item's id, or one of the tools. */
type Panel = string | null;

const onScroll = (notify: () => void) => {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
};
/** True once the page has moved under the bar, which then needs its own ground. */
const hasScrolled = () => window.scrollY > 8;

/** The site's header: the lockup, four navigation items and two tools, as on the
 * homepage's model. Three of the items open a panel of links; so do Search and
 * the region menu. One panel is open at a time. On small screens the navigation
 * moves into a single menu. */
export function SiteHeader() {
  const [open, setOpen] = useState<Panel>(null);
  const scrolled = useSyncExternalStore(onScroll, hasScrolled, () => false);
  const root = useRef<HTMLElement>(null);
  const close = () => setOpen(null);
  const toggle = (panel: string) => setOpen(current => (current === panel ? null : panel));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      document.getElementById(`nav-${open}`)?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    // The menu covers the page on small screens: the page behind must not scroll.
    if (open === "menu") document.documentElement.dataset.menuOpen = "";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      delete document.documentElement.dataset.menuOpen;
    };
  }, [open]);

  // Tabbing out of the header closes whatever was open.
  const onBlur = (event: FocusEvent) => {
    if (open && open !== "menu" && event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(null);
  };

  return <>
    <header ref={root} className="masthead" data-solid={scrolled || open ? "" : undefined} onBlur={onBlur}>
      <div className="masthead-bar wrap">
        <Link href="/" className="masthead-brand" aria-label="KIASA home" onClick={close}><Lockup /></Link>

        <nav className="masthead-nav" aria-label="Primary">
          <ul>
            {navigation.map(item => <li key={item.id}>
              {item.groups ? <>
                <button type="button" id={`nav-${item.id}`} className="masthead-item" aria-expanded={open === item.id}
                  aria-controls={`panel-${item.id}`} onClick={() => toggle(item.id)}>
                  <span>{item.label}</span><ChevronDown />
                </button>
                <Mega item={item} open={open === item.id} onNavigate={close} />
              </> : <Link href={item.href} prefetch={false} className="masthead-item" onClick={close}><span>{item.label}</span></Link>}
            </li>)}
          </ul>
        </nav>

        <div className="masthead-tools">
          <button type="button" id="nav-search" className="masthead-tool" aria-label="Search" aria-expanded={open === "search"}
            aria-controls="panel-search" onClick={() => toggle("search")}>
            {open === "search" ? <Close /> : <Search />}
          </button>
          <SearchPanel open={open === "search"} onNavigate={close} />

          <button type="button" id="nav-region" className="masthead-tool masthead-region" aria-label="Region and language: Global, English"
            aria-expanded={open === "region"} aria-controls="panel-region" onClick={() => toggle("region")}>
            <Globe /><ChevronDown />
          </button>
          <RegionPanel open={open === "region"} onChoose={close} />

          <button type="button" id="nav-menu" className="masthead-tool masthead-menu" aria-label={open === "menu" ? "Close menu" : "Open menu"}
            aria-expanded={open === "menu"} aria-controls="panel-menu" onClick={() => toggle("menu")}>
            {open === "menu" ? <Close /> : <Menu />}
          </button>
          <MobileMenu open={open === "menu"} onNavigate={close} />
        </div>
      </div>
    </header>
    {/* Dims the page while a panel is open; a click on it closes the panel (handled above). */}
    <div className="masthead-scrim" data-open={open ? "" : undefined} aria-hidden="true" />
  </>;
}

function Go({ href, onNavigate, className, children }: { href: string; onNavigate: () => void; className?: string; children: ReactNode }) {
  return <Link href={href} prefetch={false} className={className} onClick={onNavigate}>{children}</Link>;
}

/** The panel under a navigation item: its title, then its groups of links. */
function Mega({ item, open, onNavigate }: { item: NavItem; open: boolean; onNavigate: () => void }) {
  const groups = item.groups!;
  return <div id={`panel-${item.id}`} className="mega" data-open={open ? "" : undefined} data-groups={groups.length}>
    <div className="wrap">
      <Go href={item.href} onNavigate={onNavigate} className="mega-title cta">
        <CtaContent>{item.label}</CtaContent>
      </Go>
      <div className="mega-groups">
        {groups.map((group, index) => <section key={group.label} className="mega-group" aria-labelledby={`${item.id}-group-${index}`}>
          <h2 id={`${item.id}-group-${index}`} className="mega-label">{group.label}</h2>
          <ul className="mega-links">
            {group.links.map(link => <li key={link.href}><Go href={link.href} onNavigate={onNavigate}>{link.label}</Go></li>)}
          </ul>
        </section>)}
      </div>
    </div>
  </div>;
}

/** Search across the pages the site links to. Results appear as the visitor types. */
function SearchPanel({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = searchPages(query);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  return <div id="panel-search" className="mega search" data-open={open ? "" : undefined}>
    <div className="wrap">
      <form className="search-field" role="search" onSubmit={event => event.preventDefault()}>
        <Search />
        <input ref={input} type="search" name="q" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="What are you looking for?" aria-label="Search KIASA" autoComplete="off" spellCheck={false} />
      </form>
      {query.trim() ? <div className="search-results" aria-live="polite">
        <p className="mega-label">{results.length ? `${results.length} ${results.length === 1 ? "result" : "results"}` : `Nothing found for “${query.trim()}”`}</p>
        <ul>
          {results.map(page => <li key={page.href}>
            <Go href={page.href} onNavigate={onNavigate} className="search-result">
              <span className="search-result-kind">{page.section}</span>
              <span className="search-result-title">{page.title}</span>
              <ArrowRight />
            </Go>
          </li>)}
        </ul>
      </div> : <div className="search-popular">
        <p className="mega-label">Popular searches</p>
        <ul>
          {popularSearches.map(term => <li key={term}>
            <button type="button" onClick={() => { setQuery(term); input.current?.focus(); }}>{term}</button>
          </li>)}
        </ul>
      </div>}
    </div>
  </div>;
}

/** The regional sites. Only the global site exists in this design, so choosing another closes the menu. */
function RegionPanel({ open, onChoose }: { open: boolean; onChoose: () => void }) {
  return <div id="panel-region" className="region" data-open={open ? "" : undefined}>
    <p className="mega-label">Region and language</p>
    <ul>
      {regions.map(entry => <li key={entry.region}>
        <button type="button" aria-current={entry.current ? "true" : undefined} onClick={onChoose}>
          <span>{entry.region}</span><span className="region-language" lang={entry.language === "Deutsch" ? "de" : entry.language === "日本語" ? "ja" : undefined}>{entry.language}</span>
        </button>
      </li>)}
    </ul>
  </div>;
}

/** Small screens: the whole navigation in one scrolling sheet, one section open at a time. */
function MobileMenu({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  return <div id="panel-menu" className="sheet" data-open={open ? "" : undefined}>
    <nav aria-label="Menu" className="sheet-scroll">
      <ul className="sheet-list">
        {navigation.map(item => <li key={item.id}>
          {item.groups ? <details name="sheet">
            <summary><span>{item.label}</span><ChevronDown /></summary>
            <div className="sheet-body">
              <Go href={item.href} onNavigate={onNavigate} className="sheet-all">
                <span>All of “{item.label}”</span><ArrowRight />
              </Go>
              {item.groups.map(group => <section key={group.label}>
                <h2 className="mega-label">{group.label}</h2>
                <ul>
                  {group.links.map(link => <li key={link.href}><Go href={link.href} onNavigate={onNavigate}>{link.label}</Go></li>)}
                </ul>
              </section>)}
            </div>
          </details> : <Go href={item.href} onNavigate={onNavigate} className="sheet-link"><span>{item.label}</span><ArrowRight /></Go>}
        </li>)}
      </ul>
      <div className="sheet-foot">
        <Go href="/contact" onNavigate={onNavigate} className="cta">
          <CtaContent>Contact us</CtaContent>
        </Go>
        <p className="sheet-region"><Globe /><span>Global · English</span></p>
      </div>
    </nav>
  </div>;
}
