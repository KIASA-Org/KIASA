import Image from "next/image";
import Link from "next/link";
import bridge from "@/assets/media/canopy-bridge.jpg";
import { canopy } from "@/content/canopy";
import { LeafMark } from "./brand";
import { CtaContent } from "./cta";
import { SiteFooter } from "./footer";

/** The practice's header, as on the model's practice pages: the firm's leaf, a
 * rule, the practice's name, and three links. It is not the firm's header: the
 * practice page stands on its own, with Home as the way back. */
function CanopyHeader() {
  return <header className="canopy-header">
    <div className="canopy-bar wrap wrap-wide">
      <Link href="/" prefetch={false} className="canopy-lockup" aria-label="KIASA home">
        <LeafMark className="canopy-mark" weight={3.4} />
        <span className="canopy-divider" aria-hidden="true" />
        <span className="canopy-word">KIASA <span>Canopy</span></span>
      </Link>
      <nav className="canopy-nav" aria-label="KIASA Canopy">
        <ul>
          {canopy.navigation.map(link => <li key={link.href}><Link href={link.href} prefetch={false} className="canopy-link"><span>{link.label}</span></Link></li>)}
        </ul>
      </nav>
    </div>
  </header>;
}

/** KIASA Canopy's page: a photograph across the whole width, the promise in two
 * lines over its sky, and what the practice does set low on the right. */
export function CanopyPage() {
  const { hero } = canopy;
  return <div className="site canopy">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <CanopyHeader />
    <main id="main-content" tabIndex={-1}>
      <section className="canopy-hero" aria-labelledby="canopy-title">
        <Image src={bridge} alt={hero.imageAlt} fill priority sizes="100vw" placeholder="blur" className="canopy-hero-photo" />
        <div className="canopy-hero-inner wrap wrap-wide">
          <h1 id="canopy-title" className="canopy-title">
            {hero.headline.map(line => <span key={line}>{line}</span>)}
          </h1>
          <div className="canopy-aside">
            <span className="canopy-rule" aria-hidden="true" />
            {hero.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            <Link href={hero.cta.href} prefetch={false} className="cta"><CtaContent>{hero.cta.label}</CtaContent></Link>
          </div>
        </div>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
