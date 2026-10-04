import type { HeroBlock } from "@/content/blocks";
import { LeafMark } from "../brand";
import { Plate } from "../plates";
import { DewReveal } from "./reveal";
import { Cta, Photo } from "./shared";

function Title({ block, className }: { block: HeroBlock; className: string }) {
  return <h1 className={className}>
    {block.lines ? block.lines.map(line => <span key={line} className="b-hero-line">{line} </span>) : block.title}
  </h1>;
}

/** A photograph across the whole width, the title over its sky, the lead and body set low on the right. */
function PhotoHero({ block }: { block: HeroBlock }) {
  return <section className="b-hero" data-variant="photo">
    {block.image && <Photo photo={block.image} sizes="100vw" priority className="b-hero-photo" />}
    {block.image && <>
      {/* Night until the drops take over, so the photograph never shows before them. */}
      <div className="b-hero-cover" aria-hidden="true" />
      <DewReveal />
    </>}
    <div className="b-hero-inner wrap wrap-wide">
      <div className="b-hero-top">
        {block.eyebrow && <p className="eyebrow b-hero-eyebrow">{block.eyebrow}</p>}
        <Title block={block} className="b-hero-title" />
      </div>
      {(block.lead || block.body || block.cta) && <div className="b-hero-aside">
        <span className="b-hero-rule" aria-hidden="true" />
        {block.lead && <p>{block.lead}</p>}
        {block.body?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        {block.cta && <Cta link={block.cta} />}
      </div>}
    </div>
  </section>;
}

/** The title and lead on the left, a photograph on the right. */
function SplitHero({ block }: { block: HeroBlock }) {
  return <section className="b-hero" data-variant="split">
    <div className="b-hero-inner wrap wrap-wide">
      <div className="b-hero-text">
        {block.eyebrow && <p className="eyebrow b-hero-eyebrow">{block.eyebrow}</p>}
        <Title block={block} className="b-hero-title" />
        {block.lead && <p className="b-hero-lead">{block.lead}</p>}
        {block.cta && <Cta link={block.cta} />}
      </div>
      {block.image && <div className="b-hero-media"><Photo photo={block.image} sizes="(max-width: 899px) 100vw, 46vw" priority /></div>}
    </div>
  </section>;
}

/** A large title and lead, with one of the patterns beside them. */
function PlainHero({ block }: { block: HeroBlock }) {
  return <section className="b-hero" data-variant="plain">
    <div className="b-hero-inner wrap wrap-wide">
      <div className="b-hero-text">
        {block.eyebrow && <p className="eyebrow b-hero-eyebrow">{block.eyebrow}</p>}
        <Title block={block} className="b-hero-title" />
        {block.lead && <p className="b-hero-lead">{block.lead}</p>}
        {block.cta && <Cta link={block.cta} />}
      </div>
      <div className="b-hero-pattern" aria-hidden="true"><Plate name={block.pattern ?? "contours"} /></div>
    </div>
  </section>;
}

/** Eyebrow, title, deck and a line of facts, then a wide photograph. */
function ArticleHero({ block }: { block: HeroBlock }) {
  return <section className="b-hero" data-variant="article">
    <div className="b-hero-inner wrap wrap-wide">
      <div className="b-hero-text">
        {block.eyebrow && <p className="eyebrow b-hero-eyebrow">{block.eyebrow}</p>}
        <Title block={block} className="b-hero-title" />
        {block.lead && <p className="b-hero-lead">{block.lead}</p>}
        {block.meta && block.meta.length > 0 && <ul className="b-hero-meta">
          {block.meta.map(item => <li key={item}>{item}</li>)}
        </ul>}
        {block.cta && <Cta link={block.cta} />}
      </div>
      {block.image
        ? <div className="b-hero-media"><Photo photo={block.image} sizes="(max-width: 1919px) 92vw, 1664px" priority /></div>
        : <div className="b-hero-mark" aria-hidden="true"><LeafMark weight={1.4} /></div>}
    </div>
  </section>;
}

export function Hero({ block }: { block: HeroBlock }) {
  switch (block.variant) {
    case "photo": return <PhotoHero block={block} />;
    case "split": return <SplitHero block={block} />;
    case "plain": return <PlainHero block={block} />;
    case "article": return <ArticleHero block={block} />;
  }
}
