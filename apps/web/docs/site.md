# KIASA company site: plan and first design

All paths below are relative to `apps/web`.

This is the first full design of the company site: the homepage and every
page it links to, 76 in all, each modelled on the matching page of the model
site and filled with sample content.

## The model

The structure follows the homepage of Accenture, the largest IT consulting
company, section for section. The content, the visual language and every
drawing are KIASA's own.

| Accenture's homepage | KIASA's homepage | Notes |
| --- | --- | --- |
| Header: logo, four items (three open a panel of links), search, country | Header: leaf and name, **What we do**, **What we think**, **Who we are**, **Careers**, search, region | Same layout and the same panel structure: a title, then groups of links. On phones the navigation becomes one menu. |
| Hero: a two-line headline in capitals with the second line set in; a short statement and one link beside it; a moving dark background with a pause button | **Where change takes root**; "Grown, not bolted on"; **See what we do**; the veins of a leaf, shaded like a curved blade (a bright ridge, greener outer lines, a flank in shadow) and rippling gently as in a light wind, with small green lights travelling along them | The full stop of the headline is a drop of dew. The lights turn the drops on their veins blue as they pass, as in the loading mark. |
| Eight cards in two rows: announcement, perspectives, research reports | Eight cards: one announcement, two perspectives, four research reports, one case study | A card opens a panel with its summary and a link, as Accenture's cards expand. |
| A quotation from the chief executive beside a portrait | A quotation from the managing partner beside a photograph | A photograph of a leaf stands in until there is a portrait. |
| Client spotlight: a film, and four client stories with "Explore" | Client spotlight: the film series "Grown with KIASA", and four client stories | |
| Global recognition and awards: a large heading that stays in place while three coloured cards pass over it | Recognition and awards: the same movement, in leaf green, dew blue and forest green | Done with CSS only. On phones the cards are a simple list. |
| Careers: a photograph to the edge of the window, a heading, a line in a serif face, "Join us" | The same | |
| News: a row of large dated headlines that moves on, with pause and arrows | KIASA news: the same | It waits while pointed at, focused, off screen, or when reduced motion is asked for. |
| Footer: the tagline over the name, a row of links, the legal line | "Where change takes root" over KIASA, the same ten links, the legal line | Plus one line saying the content is sample content. |

## What makes it KIASA's

- **One visual language.** The site uses the loading mark's language: a
  near-black green ground, pale ink, line drawings, a soft green
  (`#B8EC93`, the loading bar's colour) for actions, and the blue of the dew
  (`#45C8FF`) as a rare second accent.
- **The leaf is never redrawn.** The header and footer use the same full line
  drawing as the loading mark (`LeafMark` in `src/components/site/brand.tsx`),
  with heavier lines at small sizes so every vein still reads.
- **Type.** Schibsted Grotesk for headings and text, Newsreader (a serif) for
  the few quieter lines. Both are self-hosted by `next/font`; the browser makes
  no request to Google.
- **Drawings instead of stock illustration.** The pictures on the light and dark
  cards are generated line drawings (`src/components/site/plates.tsx`): a
  seedling whose roots run through layers of ground, the rings of a tree, a
  field of readings, a signal. Each carries a drop of dew, drawn as the logo
  draws it.
- **Square corners, no shadows, no gradients on type.** Colour is used in large
  flat areas, as on the model.

## The pages

Every page the site links to is designed, 75 of them plus the homepage, each
in the form of the model's page of the same kind and filled with sample
content.

**Pages are data.** A page is a `PageDoc` (`src/content/blocks.ts`): its
address, title, section, one-line summary, and a list of blocks, the first of
them a hero. One renderer (`src/components/site/blocks/`) draws every block in
the model's section patterns and KIASA's visual language, so a page is written,
not built. The contract lists 22 blocks: four heroes (photo, split, plain,
article), intro, stats, features, the homepage's cards, media cards, accordion,
split, quote, closing call, prose (with an "In brief" panel), people, links,
open roles with search and filters, forms (contact, preferences, cookies),
wordmarks, steps, studios, news rows, contacts, facts and film. Light tones
(`paper`, `leaf`) break the night as the model's white sections do.

The content is in `src/content/docs/`, one file per area. The catch-all route
`src/app/[...slug]/page.tsx` draws a page from its record and pre-renders all
of them; any address not in the plan is a 404 (`src/app/not-found.tsx`).
`src/content/pages.ts` still collects every address the site links to, for
search and the link checks.

**KIASA Canopy** (`/canopy`) is a practice page like Accenture Construct: its
own header (the leaf, a rule, "KIASA Canopy", then Home, Who we are, Contact
us) and the model's eight sections, from the bridge across the first screen to
"Get a clear view of what's next". The homepage's announcement card opens it.

**Photo heroes arrive as dew.** Like the glyph reveal on the model's practice
pages, a full-width hero's photograph first appears as a field of dew drops read
from the photograph itself (a speck in its shadows, a ring in its mid-tones, a
full drop with its glint where it is brightest; a few catch green and one the
dew's blue), then the drops clear, the brightest first, in about two seconds
(`src/components/site/blocks/reveal.tsx`). A night cover keeps the photograph
hidden until the drops take over; without script it simply fades, and for
reduced motion there is no reveal.

**Cards** behave as on the model: the whole card is a link to its page;
pointed at or focused it grows a little, its picture gives way, and its summary
and "Expand" come up in its place.

| Section | Pages |
| --- | --- |
| What we do (27) | Its own page, 14 capabilities, 12 industries |
| What we think (7) | The insights listing and the six pieces linked from the cards |
| Who we are (8) | Its own page, how we work, leadership, locations, partners, sustainability report, awards, analyst recognition |
| Newsroom (9) | The newsroom, media relations, seven news items |
| Careers (10) | Its own page, search for jobs, career areas, early careers, working here, benefits, learning and growth, careers blog, hiring journey, interview tips |
| Client stories (6) | The listing, the film series and four case studies |
| Footer (7) | Contact, sitemap, privacy, terms, cookies, accessibility, preferences |
| Practice (1) | KIASA Canopy |

Company facts the pages share, so they agree: founded in London in 2012, owned
through an employee ownership trust, 420 people in eight studios (Lisbon,
Amsterdam, London and Nairobi; Toronto and Austin; Singapore and Melbourne).
Lisbon is the first engineering studio and Melbourne, opened July 2026, the
second. Emissions in 2025: 1,840 tonnes CO2e, 4.4 tonnes per person.

## Sample content

The homepage's words are in `src/content/site.ts`: the
navigation, the hero, the eight cards, the quotation, the client stories, the
recognition cards, the careers text, the news and the footer.

**All of it is placeholder content.** The clients (Halden Mutual, Osprey
Freight, Tessera Health, Varda Energy), the people (Elena Marsh, Daniel
Okafor), the product name Canopy, the figures, the awards and the dates are
invented so the design can be judged with realistic copy. None of it is a
statement about KIASA. Before the site is public:

1. Replace the content in `src/content/site.ts` and `src/content/docs/`.
2. Replace the photographs (see below).
3. Set `SAMPLE_CONTENT` to `false` in that file. This removes the line in the
   footer that says the content is sample content.

## Photographs

The portrait beside the quotation, `portrait.jpg`, and the bridge on the
Canopy page, `stock/canopy-bridge.jpg`, were supplied by KIASA. The other five
photographs in `src/assets/media/` are placeholders from Unsplash,
free to use under the Unsplash License.

The inner pages use 68 more photographs in `src/assets/stock/`, chosen from the
Lorem Picsum collection: every one is an Unsplash photograph, free to use under
the Unsplash License. `src/content/photos.ts` is their registry: a key, a
description used as the alternative text, the photographer and the Unsplash
source of each. Pages name a photograph by its key. People in them are not KIASA
staff, and no invented person is ever shown with a photograph. Replace them with KIASA's own
photography when there is some; the people in `studio.jpg` are not KIASA staff.

| File | Used for | Photographer | Unsplash photo |
| --- | --- | --- | --- |
| `portrait.jpg` | Beside the quotation | Supplied by KIASA | — |
| `stock/canopy-bridge.jpg` | KIASA Canopy hero | Supplied by KIASA | — |
| `river-road.jpg` | The film in Client spotlight | Ben den Engelsen | `photo-1596779845727-d88eb78a1b08` |
| `studio.jpg` | Careers | Drew Dempsey | `photo-1678282931256-370578a0d036` |
| `blue-leaf.jpg` | Card: The maintenance dividend | Amin Alizadeh | `photo-1673554227888-f33f40a90055` |
| `forest-road.jpg` | Card: Halden Mutual | Giordano Rossoni | `photo-1637058468176-30aa8c88bb6b` |
| `leaf-tip.jpg` | Card: Security debt | Alexandra | `photo-1695551527664-585082953b87` |

## How it is built

| File | What it is |
| --- | --- |
| `src/app/page.tsx` | The homepage, wrapped in `StartupBoundary` so the loading mark stands in front of it on every load. |
| `src/app/[...slug]/page.tsx`, `src/app/not-found.tsx` | Every inner page, drawn from its record, and the 404 page. |
| `src/content/blocks.ts`, `src/content/docs/*.ts` | The page contract, and every page's content, one file per area. |
| `src/content/photos.ts`, `src/assets/stock/` | The stock photographs and their credits. |
| `src/components/site/blocks/*.tsx`, `src/styles/site-blocks.css` | The renderer: one component per block, the practice header, and their styles. |
| `src/content/site.ts`, `src/content/pages.ts` | The sample content, and the list of pages built from it (also what Search looks through). |
| `src/components/site/shell.tsx` | Header, content, footer: what every page shares. |
| `src/components/site/header.tsx` | The header and its panels: navigation, search, region, and the menu on phones. |
| `src/components/site/hero.tsx`, `hero-field.tsx`, `motion-toggle.tsx` | The hero, its background of veins and lights (plain SVG; the lights move by CSS, the veins ripple by a few lines of script), and the pause button. |
| `src/components/site/featured.tsx`, `story-grid.tsx`, `plates.tsx` | The eight cards (each a link to its page), and the nine line drawings used as patterns. |
| `src/components/site/voice.tsx`, `spotlight.tsx`, `recognition.tsx`, `careers.tsx`, `news.tsx`, `news-rail.tsx`, `footer.tsx` | The remaining sections. |
| `src/components/site/brand.tsx`, `icons.tsx`, `cta.tsx` | The leaf and the lockup, the icons, the arrow link. |
| `src/styles/site*.css` | The site's styles, one file per part. Colours and typefaces are variables in `src/app/globals.css`. |

Most of the page is rendered on the server and needs no script. Script is used
only where something has to respond: the header's panels and search, the news
row, the pause button, the open roles' search and filters, and the forms (which
are not connected yet, and say so when sent). Without JavaScript the whole
page is still readable.

Motion follows three rules. It stops for visitors who ask for reduced motion.
Anything that moves by itself for more than a moment can be paused. Nothing
moves the layout: the measured layout shift is zero.

## What comes next

1. Decide the real content: what KIASA offers, for whom, with which proof, and
   replace the sample pages area by area in `src/content/docs/`.
2. Replace the photographs with KIASA's own.
3. Before going public: connect the forms to someone who reads them, a cookie
   notice if analytics are added, social sharing images, and checks in Safari,
   Firefox and on real phones.
