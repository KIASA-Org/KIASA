import Link from "next/link";
import type { Block, PageDoc, Practice } from "@/content/blocks";
import { LeafMark } from "../brand";
import { SiteFooter } from "../footer";
import { PlateDefs } from "../plates";
import { SiteShell } from "../shell";
import { FormSection } from "./forms";
import { Hero } from "./hero";
import { Jobs } from "./jobs";
import { Prose } from "./prose";
import {
  Accordion, Cards, Contacts, CtaBand, Facts, Features, Film, Intro, Links, Locations, Logos, Media, News, People, Quote,
  Split, Stats, Steps,
} from "./sections";

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "hero": return <Hero block={block} />;
    case "intro": return <Intro block={block} />;
    case "stats": return <Stats block={block} />;
    case "features": return <Features block={block} />;
    case "cards": return <Cards block={block} />;
    case "media": return <Media block={block} />;
    case "accordion": return <Accordion block={block} />;
    case "split": return <Split block={block} />;
    case "quote": return <Quote block={block} />;
    case "cta": return <CtaBand block={block} />;
    case "prose": return <Prose block={block} />;
    case "people": return <People block={block} />;
    case "links": return <Links block={block} />;
    case "jobs": return <Jobs block={block} />;
    case "form": return <FormSection block={block} />;
    case "logos": return <Logos block={block} />;
    case "steps": return <Steps block={block} />;
    case "locations": return <Locations block={block} />;
    case "news": return <News block={block} />;
    case "contacts": return <Contacts block={block} />;
    case "facts": return <Facts block={block} />;
    case "film": return <Film block={block} />;
  }
}

/** A practice's own header, as on the model's practice pages: the firm's leaf, a
 * rule, the practice's name, and a few links. Home is the way back to the firm. */
function PracticeHeader({ practice }: { practice: Practice }) {
  const [firm, ...rest] = practice.name.split(" ");
  return <header className="practice-header">
    <div className="practice-bar wrap wrap-wide">
      <Link href="/" prefetch={false} className="practice-lockup" aria-label="KIASA home">
        <LeafMark className="practice-mark" weight={3.4} />
        <span className="practice-divider" aria-hidden="true" />
        <span className="practice-word">{firm} <span>{rest.join(" ")}</span></span>
      </Link>
      <nav className="practice-nav" aria-label={practice.name}>
        <ul>{practice.nav.map(link => <li key={link.href}><Link href={link.href} prefetch={false} className="practice-link"><span>{link.label}</span></Link></li>)}</ul>
      </nav>
    </div>
  </header>;
}

/** A page of the site, drawn from its blocks. */
export function PageView({ doc }: { doc: PageDoc }) {
  const blocks = <>
    <PlateDefs />
    {doc.blocks.map((block, index) => <BlockView key={`${block.type}-${index}`} block={block} />)}
  </>;
  if (doc.practice) return <div className="site practice">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <PracticeHeader practice={doc.practice} />
    <main id="main-content" tabIndex={-1} className="page">{blocks}</main>
    <SiteFooter />
  </div>;
  return <SiteShell><div className="page">{blocks}</div></SiteShell>;
}
