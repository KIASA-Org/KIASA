import { ArrowRight } from "./icons";

/** The inside of a `.cta` link: its words, then the small square with an arrow.
 * Two arrows sit in the square so one can leave as the other arrives on hover. */
export function CtaContent({ children }: { children: React.ReactNode }) {
  return <>
    <span className="cta-label">{children}</span>
    <span className="cta-chip" aria-hidden="true"><span className="cta-chip-track"><ArrowRight /><ArrowRight /></span></span>
  </>;
}
