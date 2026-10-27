import type { ReactNode } from "react";
import { SiteFooter } from "./footer";
import { SiteHeader, type Viewer } from "./header";

/** What every page of the site shares: the header, the page's own content, the
 * footer. A page drawn for a signed-in visitor names them, for the header. */
export function SiteShell({ children, viewer }: { children: ReactNode; viewer?: Viewer }) {
  return <div className="site">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <SiteHeader viewer={viewer} />
    <main id="main-content" tabIndex={-1}>{children}</main>
    <SiteFooter />
  </div>;
}
