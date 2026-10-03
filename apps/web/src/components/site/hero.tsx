import Link from "next/link";
import { hero } from "@/content/site";
import { CtaContent } from "./cta";
import { HeroField } from "./hero-field";
import { MotionToggle } from "./motion-toggle";

/** The opening: a two-line headline with the second line set in, a short
 * statement and one call to action beside it, over the veins of a leaf. */
export function Hero() {
  const [first, second] = hero.headline;
  return <section className="hero" aria-labelledby="hero-title">
    <HeroField />
    <div className="hero-inner wrap">
      <h1 id="hero-title" className="hero-title">
        <span className="hero-line"><span>{first}</span></span>{" "}
        <span className="hero-line"><span>{second}<i className="hero-dew" aria-hidden="true" /></span></span>
      </h1>
      <div className="hero-aside">
        <span className="hero-rule" aria-hidden="true" />
        <h2 className="hero-kicker">{hero.kicker}</h2>
        <p className="hero-body">{hero.body}</p>
        <Link href={hero.cta.href} prefetch={false} className="cta"><CtaContent>{hero.cta.label}</CtaContent></Link>
      </div>
    </div>
    <div className="wrap"><MotionToggle /></div>
  </section>;
}
