import Link from "next/link";
import { SAMPLE_CONTENT, company, footer } from "@/content/site";
import { LeafMark } from "./brand";

/** The foot of every page: the name under its line, the standing links, the legal line. */
export function SiteFooter() {
  return <footer className="footer wrap">
    <Link href="/" className="footer-brand" aria-label="KIASA home">
      <span className="footer-line">{company.tagline}</span>
      <span className="footer-name"><LeafMark className="footer-mark" weight={1.9} /><span>KIASA</span></span>
    </Link>
    <nav aria-label="Footer">
      <ul className="footer-links">
        {footer.links.map(link => <li key={link.label}><Link href={link.href} prefetch={false}>{link.label}</Link></li>)}
      </ul>
    </nav>
    <p className="footer-legal">{footer.legal}</p>
    {SAMPLE_CONTENT && <p className="footer-sample">{footer.sampleNotice}</p>}
  </footer>;
}
