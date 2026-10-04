/**
 * The building blocks of the site's pages.
 *
 * Every page except the homepage is data: a `PageDoc` is a list of blocks, and
 * one renderer (`src/components/site/blocks/`) draws them, in the model's
 * section patterns and KIASA's visual language. A page's content lives in
 * `src/content/pages/<area>.ts`.
 *
 * All of it is SAMPLE CONTENT, like the rest of the site (see `site.ts`).
 */
import type { PhotoKey } from "./photos";

export type Link = { label: string; href: string };

/** KIASA's line-drawing patterns, drawn in the site's inks. Used where a page
 * wants a picture that is not a photograph: cards, plain heroes, tiles. */
export type PatternName =
  | "veins" // the inside of a leaf, its veins and a dew drop
  | "strata" // a sapling and its roots through layers of ground
  | "matrix" // a field of dots, some lit green, one blue
  | "pulse" // a line chart breathing across the frame
  | "rings" // tree rings around a heart
  | "contours" // topographic lines, a map of a hill
  | "branches" // a tree branching, as a decision does
  | "waves" // parallel waves, like a signal or the sea
  | "orbit"; // arcs around a centre, things kept in motion

/** A picture: one of the stock photographs (`photos.ts`) or one of the patterns. */
export type Art = PhotoKey | PatternName;

/** Light sections break the night, as the model's white sections do. Default is night. */
export type Tone = "night" | "paper" | "leaf";

type Base = {
  /** An anchor for in-page links. */
  id?: string;
  tone?: Tone;
};

/** The top of a page. Every page starts with one.
 * - `photo`: a photograph across the whole width, the title over its sky and the
 *   lead and body set low on the right (the model's practice and campaign pages).
 * - `split`: the title and lead on the left, a photograph on the right (service,
 *   industry and careers pages).
 * - `plain`: a large title and lead with a pattern beside them (hubs, legal,
 *   utility pages).
 * - `article`: eyebrow, title, deck and meta line, then a wide photograph below
 *   (insights, news, case studies, blog posts).
 */
export type HeroBlock = Base & {
  type: "hero";
  variant: "photo" | "split" | "plain" | "article";
  /** Small capitals above the title: the page's kind or section. */
  eyebrow?: string;
  /** The page's h1. 2–10 words for photo/split/plain; up to ~16 for an article. */
  title: string;
  /** Optional forced line breaks for the title (photo and plain); joined, they must equal `title`. */
  lines?: string[];
  /** One or two sentences under or beside the title. */
  lead?: string;
  /** Further short paragraphs (photo hero only, at most two). */
  body?: string[];
  cta?: Link;
  /** Required for photo, split and article. */
  image?: PhotoKey;
  /** For plain heroes; defaults to "contours". */
  pattern?: PatternName;
  /** Article heroes: e.g. ["September 29, 2026", "8 minute read", "By Mira Castell"]. */
  meta?: string[];
};

/** A statement: one large paragraph, optionally with smaller text in columns below. */
export type IntroBlock = Base & {
  type: "intro";
  eyebrow?: string;
  heading?: string;
  /** The large paragraph, 25–60 words. */
  text: string;
  /** 1–3 smaller paragraphs. */
  body?: string[];
  cta?: Link;
};

/** Big numbers. 3 or 4 items reads best. */
export type StatsBlock = Base & {
  type: "stats";
  eyebrow?: string;
  heading?: string;
  intro?: string;
  /** `value` is short: "61%", "4,000", "2 days", "$3.2M". `label` is one sentence. */
  items: { value: string; label: string }[];
  /** Where the numbers come from. */
  source?: string;
};

/** Tiles in a grid: what we do differently, services, values, benefits. 3, 4 or 6 items. */
export type FeaturesBlock = Base & {
  type: "features";
  eyebrow?: string;
  heading: string;
  intro?: string;
  /** Shows 01, 02, 03 on the tiles instead of a pattern. */
  numbered?: boolean;
  items: { title: string; text: string; pattern?: PatternName; link?: Link }[];
};

/** A row (or rows) of the homepage's cards: insights, related reading. 4 or 8 items. */
export type CardsBlock = Base & {
  type: "cards";
  eyebrow?: string;
  heading?: string;
  intro?: string;
  cta?: Link;
  items: CardItem[];
};
/** One card. `surface` defaults to "photo" for a photograph and "paper" for a pattern. */
export type CardItem = {
  kind: string;
  title: string;
  /** Shown when the card is pointed at: 1–2 sentences. */
  summary: string;
  href: string;
  art: Art;
  surface?: "leaf" | "paper" | "night" | "photo";
};

/** Photograph-topped cards with a title, a line and "Explore": case studies, stories, programs. 3 or 4 items. */
export type MediaBlock = Base & {
  type: "media";
  eyebrow?: string;
  heading: string;
  intro?: string;
  items: { image: PhotoKey; eyebrow?: string; title: string; text?: string; href: string; cta?: string }[];
};

/** Expandable rows: lifecycle phases, industries, FAQs. The first is open. 3–8 items. */
export type AccordionBlock = Base & {
  type: "accordion";
  eyebrow?: string;
  heading: string;
  intro?: string;
  items: { title: string; body: string[]; stat?: { value: string; label: string }; link?: Link }[];
};

/** A photograph beside a heading and text. Alternate `side` when several follow each other. */
export type SplitBlock = Base & {
  type: "split";
  eyebrow?: string;
  heading: string;
  body: string[];
  cta?: Link;
  image: PhotoKey;
  side?: "left" | "right";
};

/** A quotation from a person, with an optional photograph (never a portrait of an invented person: use a place or detail). */
export type QuoteBlock = Base & {
  type: "quote";
  text: string;
  name: string;
  role?: string;
  image?: PhotoKey;
};

/** A closing call: "Get a clear view of what's next". Usually the last block. */
export type CtaBlock = Base & {
  type: "cta";
  heading: string;
  text?: string;
  cta: Link;
  secondary?: Link;
  image?: PhotoKey;
};

/** Running text for articles, case studies, news releases, policies. */
export type ProseBlock = Base & {
  type: "prose";
  items: ProseItem[];
  /** A short summary beside the text ("In brief"), shown sticky on wide screens. */
  aside?: { heading: string; points: string[] };
};
export type ProseItem =
  | { p: string }
  | { h: string }
  | { list: string[] }
  | { quote: string; by?: string }
  | { figure: PhotoKey; caption?: string }
  | { stat: string; label: string };

/** People as tiles with their initials: leadership, authors, contacts. 3–12 items. */
export type PeopleBlock = Base & {
  type: "people";
  eyebrow?: string;
  heading: string;
  intro?: string;
  items: { name: string; role: string; bio?: string }[];
};

/** Rows of links in groups: hubs, the sitemap, "explore more". */
export type LinksBlock = Base & {
  type: "links";
  eyebrow?: string;
  heading?: string;
  intro?: string;
  groups: { label: string; links: { title: string; href: string; summary?: string }[] }[];
};

/** Open roles with search and filters. 12–24 jobs reads as a real list. */
export type JobsBlock = Base & {
  type: "jobs";
  heading: string;
  intro?: string;
  jobs: { title: string; area: string; location: string; kind: "Full time" | "Part time" | "Internship" | "Graduate"; posted: string; summary: string }[];
};

/** A form. Nothing is sent anywhere yet: on submit it thanks the visitor and says so. */
export type FormBlock = Base & {
  type: "form";
  heading: string;
  intro?: string;
  kind: "contact" | "preferences" | "cookies";
};

/** Names in a grid, set as wordmarks: the platforms we build on. */
export type LogosBlock = Base & {
  type: "logos";
  eyebrow?: string;
  heading: string;
  intro?: string;
  items: { name: string; note?: string }[];
};

/** Numbered steps across the page: a process or journey. 3–6 items. */
export type StepsBlock = Base & {
  type: "steps";
  eyebrow?: string;
  heading: string;
  intro?: string;
  items: { title: string; text: string }[];
};

/** Studios by region. */
export type LocationsBlock = Base & {
  type: "locations";
  heading: string;
  intro?: string;
  regions: { name: string; studios: { city: string; country: string; address: string; phone?: string; email?: string; image?: PhotoKey }[] }[];
};

/** Dated rows: news, releases, blog posts. */
export type NewsBlock = Base & {
  type: "news";
  eyebrow?: string;
  heading: string;
  intro?: string;
  /** `date` is ISO, "2026-09-29". */
  items: { date: string; title: string; href: string; kind?: string }[];
  cta?: Link;
};

/** Who to call: press contacts, practice leads. */
export type ContactsBlock = Base & {
  type: "contacts";
  heading: string;
  intro?: string;
  items: { name: string; role: string; email: string; phone?: string }[];
};

/** Key facts in a row: client, industry, region, duration, team. */
export type FactsBlock = Base & {
  type: "facts";
  items: { label: string; value: string }[];
};

/** A film and its episodes. */
export type FilmBlock = Base & {
  type: "film";
  eyebrow?: string;
  heading: string;
  text?: string;
  image: PhotoKey;
  duration: string;
  episodes?: { title: string; duration: string; image: PhotoKey; text?: string }[];
};

export type Block =
  | HeroBlock | IntroBlock | StatsBlock | FeaturesBlock | CardsBlock | MediaBlock | AccordionBlock
  | SplitBlock | QuoteBlock | CtaBlock | ProseBlock | PeopleBlock | LinksBlock | JobsBlock | FormBlock
  | LogosBlock | StepsBlock | LocationsBlock | NewsBlock | ContactsBlock | FactsBlock | FilmBlock;

/** A practice's own header, as on the model's practice pages (KIASA Canopy). */
export type Practice = { name: string; nav: Link[] };

/** A page of the site. */
export type PageDoc = {
  href: string;
  /** The browser tab's title and the page's name in search and link lists. */
  title: string;
  /** Where the page belongs: "Capabilities", "Industries", "Research report", "News"… */
  section: string;
  /** One sentence: the meta description, and the line under the page in search. */
  summary: string;
  /** Draws the page with a practice's own header instead of the site's. */
  practice?: Practice;
  /** In order; the first is a hero. */
  blocks: Block[];
};
