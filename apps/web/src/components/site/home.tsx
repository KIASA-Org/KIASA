import { Careers } from "./careers";
import { Featured } from "./featured";
import { Hero } from "./hero";
import { News } from "./news";
import { Recognition } from "./recognition";
import { SiteShell } from "./shell";
import { Spotlight } from "./spotlight";
import { Voice } from "./voice";

/** The company's homepage. Its order follows the model it was planned from:
 * hero, featured cards, a leader's words, client stories, recognition, careers, news. */
export function HomePage() {
  return <SiteShell>
    <Hero />
    <Featured />
    <Voice />
    <Spotlight />
    <Recognition />
    <Careers />
    <News />
  </SiteShell>;
}
