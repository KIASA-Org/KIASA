import type { Metadata } from "next";
import Link from "next/link";
import { CtaContent } from "@/components/site/cta";
import { SiteShell } from "@/components/site/shell";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return <SiteShell>
    <article className="planned wrap">
      <p className="eyebrow planned-kind">Error 404</p>
      <h1 className="planned-title">Nothing has taken root here</h1>
      <p className="planned-lead">The page you were looking for has moved, or it never existed. The homepage is a good place to start again.</p>
      <p className="planned-back"><Link href="/" className="cta"><CtaContent>Back to the homepage</CtaContent></Link></p>
    </article>
  </SiteShell>;
}
