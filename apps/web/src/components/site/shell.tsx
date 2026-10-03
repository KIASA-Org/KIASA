import type { ReactNode } from "react";
import { SiteFooter } from "./footer";
import { SiteHeader } from "./header";

/** What every page of the site shares: the header, the page's own content, the footer. */
export function SiteShell({ children }: { children: ReactNode }) {
  return <div className="site">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <SiteHeader />
    <main id="main-content" tabIndex={-1}>{children}</main>
    <SiteFooter />
  </div>;
}
