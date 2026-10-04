import Link from "next/link";
import type {
  AccordionBlock, CardsBlock, ContactsBlock, CtaBlock, FactsBlock, FeaturesBlock, FilmBlock, IntroBlock, LinksBlock,
  LocationsBlock, LogosBlock, MediaBlock, NewsBlock, PeopleBlock, QuoteBlock, SplitBlock, StatsBlock, StepsBlock,
} from "@/content/blocks";
import { isPhoto } from "@/content/photos";
import { LeafMark } from "../brand";
import { ArrowRight, ChevronRight, Plus } from "../icons";
import { Plate } from "../plates";
import { StoryCard } from "../story-grid";
import { ArtView, Cta, Photo, Section, SectionHead, initials, longDate } from "./shared";

export function Intro({ block }: { block: IntroBlock }) {
  return <Section type="intro" tone={block.tone} id={block.id}>
    <div className="b-intro">
      {(block.eyebrow || block.heading) && <div className="b-intro-head">
        {block.eyebrow && <p className="eyebrow block-eyebrow">{block.eyebrow}</p>}
        {block.heading && <h2 className="block-title">{block.heading}</h2>}
      </div>}
      <div className="b-intro-body">
        <p className="b-intro-text">{block.text}</p>
        {block.body && <div className="b-intro-columns">{block.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>}
        {block.cta && <Cta link={block.cta} />}
      </div>
    </div>
  </Section>;
}

export function Stats({ block }: { block: StatsBlock }) {
  return <Section type="stats" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <dl className="b-stats" data-count={block.items.length}>
      {block.items.map(item => <div key={item.value + item.label} className="b-stat">
        <dt className="b-stat-value">{item.value}</dt>
        <dd className="b-stat-label">{item.label}</dd>
      </div>)}
    </dl>
    {block.source && <p className="b-source">{block.source}</p>}
  </Section>;
}

export function Features({ block }: { block: FeaturesBlock }) {
  return <Section type="features" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <ul className="b-features" data-count={block.items.length}>
      {block.items.map((item, index) => <li key={item.title} className="b-feature">
        {block.numbered
          ? <span className="b-feature-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          : item.pattern && <span className="b-feature-art" aria-hidden="true"><Plate name={item.pattern} /></span>}
        <h3 className="b-feature-title">{item.title}</h3>
        <p className="b-feature-text">{item.text}</p>
        {item.link && <Cta link={item.link} className="b-feature-link" />}
      </li>)}
    </ul>
  </Section>;
}

export function Cards({ block }: { block: CardsBlock }) {
  return <Section type="cards" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} cta={block.cta} />
    <ul className="story-grid">
      {block.items.map(item => <li key={item.href + item.title}>
        <StoryCard story={{ id: item.href, kind: item.kind, title: item.title, summary: item.summary, href: item.href, surface: item.surface ?? (isPhoto(item.art) ? "photo" : "paper") }}
          art={<ArtView art={item.art} sizes="(max-width: 1099px) 300px, (max-width: 1919px) 20vw, 380px" />} />
      </li>)}
    </ul>
  </Section>;
}

export function Media({ block }: { block: MediaBlock }) {
  return <Section type="media" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <ul className="b-media" data-count={block.items.length}>
      {block.items.map(item => <li key={item.href + item.title}>
        <Link href={item.href} prefetch={false} className="b-media-card">
          <div className="b-media-image"><Photo photo={item.image} sizes="(max-width: 899px) 92vw, 30vw" decorative /></div>
          <div className="b-media-text">
            {item.eyebrow && <p className="eyebrow">{item.eyebrow}</p>}
            <h3 className="b-media-title">{item.title}</h3>
            {item.text && <p className="b-media-line">{item.text}</p>}
            <span className="b-media-cta">{item.cta ?? "Explore"} <ChevronRight /></span>
          </div>
        </Link>
      </li>)}
    </ul>
  </Section>;
}

export function Accordion({ block }: { block: AccordionBlock }) {
  return <Section type="accordion" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <div className="b-accordion">
      {block.items.map((item, index) => <details key={item.title} className="b-fold" open={index === 0}>
        <summary className="b-fold-head">
          <span className="b-fold-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <h3 className="b-fold-title">{item.title}</h3>
          <span className="b-fold-icon" aria-hidden="true"><Plus /></span>
        </summary>
        <div className="b-fold-body">
          <div className="b-fold-text">
            {item.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            {item.link && <Cta link={item.link} />}
          </div>
          {item.stat && <div className="b-fold-stat"><span className="b-fold-stat-value">{item.stat.value}</span><span className="b-fold-stat-label">{item.stat.label}</span></div>}
        </div>
      </details>)}
    </div>
  </Section>;
}

export function Split({ block }: { block: SplitBlock }) {
  return <Section type="split" tone={block.tone} id={block.id}>
    <div className="b-split" data-side={block.side ?? "left"}>
      <div className="b-split-media"><Photo photo={block.image} sizes="(max-width: 899px) 92vw, 46vw" /></div>
      <div className="b-split-text">
        {block.eyebrow && <p className="eyebrow block-eyebrow">{block.eyebrow}</p>}
        <h2 className="block-title">{block.heading}</h2>
        {block.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        {block.cta && <Cta link={block.cta} />}
      </div>
    </div>
  </Section>;
}

export function Quote({ block }: { block: QuoteBlock }) {
  return <Section type="quote" tone={block.tone} id={block.id} label={`A word from ${block.name}`}>
    <figure className="b-quote" data-photo={block.image ? "" : undefined}>
      {block.image
        ? <div className="b-quote-media"><Photo photo={block.image} sizes="(max-width: 899px) 92vw, 42vw" /></div>
        : <div className="b-quote-mark" aria-hidden="true"><LeafMark weight={1.3} /></div>}
      <blockquote className="b-quote-text"><p>“{block.text}”</p></blockquote>
      <figcaption className="b-quote-by"><span className="b-quote-name">{block.name}</span><span className="b-quote-role">{block.role}</span></figcaption>
    </figure>
  </Section>;
}

export function CtaBand({ block }: { block: CtaBlock }) {
  return <section className="block block-cta" data-tone={block.tone && block.tone !== "night" ? block.tone : undefined} data-photo={block.image ? "" : undefined} id={block.id}>
    {block.image && <Photo photo={block.image} sizes="100vw" decorative className="b-cta-photo" />}
    <div className="wrap wrap-wide b-cta">
      <h2 className="b-cta-title">{block.heading}</h2>
      <div className="b-cta-side">
        {block.text && <p>{block.text}</p>}
        <div className="b-cta-links">
          <Cta link={block.cta} />
          {block.secondary && <Cta link={block.secondary} className="cta-quiet" />}
        </div>
      </div>
    </div>
  </section>;
}

export function People({ block }: { block: PeopleBlock }) {
  return <Section type="people" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <ul className="b-people">
      {block.items.map((person, index) => <li key={person.name} className="b-person">
        <div className="b-person-tile" aria-hidden="true" data-shade={index % 4}>
          <span className="b-person-initials">{initials(person.name)}</span>
          <LeafMark className="b-person-mark" weight={1.6} />
        </div>
        <h3 className="b-person-name">{person.name}</h3>
        <p className="b-person-role">{person.role}</p>
        {person.bio && <p className="b-person-bio">{person.bio}</p>}
      </li>)}
    </ul>
  </Section>;
}

export function Links({ block }: { block: LinksBlock }) {
  return <Section type="links" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <div className="b-links" data-groups={block.groups.length}>
      {block.groups.map(group => <nav key={group.label} className="b-links-group" aria-label={group.label}>
        <h3 className="b-links-label">{group.label}</h3>
        <ul>
          {group.links.map(link => <li key={link.href + link.title}>
            <Link href={link.href} prefetch={false} className="b-links-row">
              <span className="b-links-title">{link.title}</span>
              {link.summary && <span className="b-links-text">{link.summary}</span>}
              <ArrowRight />
            </Link>
          </li>)}
        </ul>
      </nav>)}
    </div>
  </Section>;
}

export function Logos({ block }: { block: LogosBlock }) {
  return <Section type="logos" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <ul className="b-logos">
      {block.items.map(item => <li key={item.name} className="b-logo">
        <span className="b-logo-name">{item.name}</span>
        {item.note && <span className="b-logo-note">{item.note}</span>}
      </li>)}
    </ul>
  </Section>;
}

export function Steps({ block }: { block: StepsBlock }) {
  return <Section type="steps" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} />
    <ol className="b-steps" data-count={block.items.length}>
      {block.items.map((item, index) => <li key={item.title} className="b-step">
        <span className="b-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <h3 className="b-step-title">{item.title}</h3>
        <p className="b-step-text">{item.text}</p>
      </li>)}
    </ol>
  </Section>;
}

export function Locations({ block }: { block: LocationsBlock }) {
  return <Section type="locations" tone={block.tone} id={block.id}>
    <SectionHead heading={block.heading} intro={block.intro} />
    {block.regions.map(region => <div key={region.name} className="b-region">
      <h3 className="b-region-name">{region.name}</h3>
      <ul className="b-studios">
        {region.studios.map(studio => <li key={studio.city} className="b-studio">
          {studio.image && <div className="b-studio-image"><Photo photo={studio.image} sizes="(max-width: 899px) 92vw, 30vw" decorative /></div>}
          <h4 className="b-studio-city">{studio.city}<span>{studio.country}</span></h4>
          <address className="b-studio-address">
            {studio.address.split(/,\s*/).map(line => <span key={line}>{line}</span>)}
            {studio.phone && <a href={`tel:${studio.phone.replace(/[^+\d]/g, "")}`}>{studio.phone}</a>}
            {studio.email && <a href={`mailto:${studio.email}`}>{studio.email}</a>}
          </address>
        </li>)}
      </ul>
    </div>)}
  </Section>;
}

export function News({ block }: { block: NewsBlock }) {
  return <Section type="news-list" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.intro} cta={block.cta} />
    <ul className="b-news">
      {block.items.map(item => <li key={item.href + item.title}>
        <Link href={item.href} prefetch={false} className="b-news-row">
          <time dateTime={item.date} className="b-news-date">{longDate(item.date)}</time>
          {item.kind && <span className="b-news-kind">{item.kind}</span>}
          <span className="b-news-title">{item.title}</span>
          <ArrowRight />
        </Link>
      </li>)}
    </ul>
  </Section>;
}

export function Contacts({ block }: { block: ContactsBlock }) {
  return <Section type="contacts" tone={block.tone} id={block.id}>
    <SectionHead heading={block.heading} intro={block.intro} />
    <ul className="b-contacts">
      {block.items.map(item => <li key={item.email + item.name} className="b-contact">
        <h3 className="b-contact-name">{item.name}</h3>
        <p className="b-contact-role">{item.role}</p>
        <a href={`mailto:${item.email}`} className="b-contact-link">{item.email}</a>
        {item.phone && <a href={`tel:${item.phone.replace(/[^+\d]/g, "")}`} className="b-contact-link">{item.phone}</a>}
      </li>)}
    </ul>
  </Section>;
}

export function Facts({ block }: { block: FactsBlock }) {
  return <Section type="facts" tone={block.tone} id={block.id}>
    <dl className="b-facts">
      {block.items.map(item => <div key={item.label} className="b-fact"><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
    </dl>
  </Section>;
}

export function Film({ block }: { block: FilmBlock }) {
  return <Section type="film" tone={block.tone} id={block.id}>
    <SectionHead eyebrow={block.eyebrow} heading={block.heading} intro={block.text} />
    <figure className="b-film">
      <div className="b-film-poster">
        <Photo photo={block.image} sizes="(max-width: 1919px) 92vw, 1664px" />
        <span className="b-film-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg></span>
      </div>
      <figcaption className="b-film-caption">{block.heading} <span>{block.duration}</span></figcaption>
    </figure>
    {block.episodes && <ul className="b-episodes">
      {block.episodes.map((episode, index) => <li key={episode.title} className="b-episode">
        <div className="b-episode-image"><Photo photo={episode.image} sizes="(max-width: 899px) 70vw, 22vw" decorative /><span className="b-film-play b-film-play-small" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg></span></div>
        <p className="eyebrow">Episode {index + 1} · {episode.duration}</p>
        <h3 className="b-episode-title">{episode.title}</h3>
        {episode.text && <p className="b-episode-text">{episode.text}</p>}
      </li>)}
    </ul>}
  </Section>;
}
