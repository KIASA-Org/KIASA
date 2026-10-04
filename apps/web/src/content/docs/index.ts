import type { PageDoc } from "../blocks";
import { aboutPages } from "./about";
import { canopyPages } from "./canopy";
import { capabilitiesPages } from "./capabilities";
import { careersPages } from "./careers";
import { clientStoriesPages } from "./client-stories";
import { industriesPages } from "./industries";
import { insightsPages } from "./insights";
import { legalPages } from "./legal";
import { newsroomPages } from "./newsroom";
import { whatWeDoPages } from "./what-we-do";

/** Every designed page of the site, by address. The homepage is not here: it is its own route. */
export const pageDocs: PageDoc[] = [
  ...canopyPages,
  ...whatWeDoPages,
  ...capabilitiesPages,
  ...industriesPages,
  ...insightsPages,
  ...clientStoriesPages,
  ...aboutPages,
  ...newsroomPages,
  ...careersPages,
  ...legalPages,
];

export const findDoc = (href: string) => pageDocs.find(doc => doc.href === href);
