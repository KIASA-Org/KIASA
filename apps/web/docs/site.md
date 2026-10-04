# KIASA company site: plan and first design

All paths below are relative to `apps/web`.

This is the first design of the company site: the homepage, complete, with
sample content. Every other page has its address, title and place in the
navigation, and shows a short "still growing" page until it is designed.

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

Only the homepage is designed. The others are listed in
`src/content/pages.ts`, which collects every address the site links to
(74 of them): the navigation's pages, the stories, the news items and the
footer's pages. `src/app/[...slug]/page.tsx` renders each of them as a
placeholder with its title, its section and a short description; a section's
own page (for example `/what-we-do`) lists everything in it. Any other address
is a 404 (`src/app/not-found.tsx`).

| Section | Pages |
| --- | --- |
| What we do (27) | Its own page, 14 capabilities, 12 industries |
| What we think (7) | The insights listing and the six pieces linked from the cards |
| Who we are (8) | Its own page, how we work, leadership, locations, partners, sustainability report, awards, analyst recognition |
| Newsroom (9) | The newsroom, media relations, seven news items |
| Careers (10) | Its own page, search for jobs, career areas, early careers, working here, benefits, learning and growth, careers blog, hiring journey, interview tips |
| Client stories (6) | The listing, the film series and four case studies |
| Footer (7) | Contact, sitemap, privacy, terms, cookies, accessibility, preferences |

## Sample content

Everything a visitor reads is in one file, `src/content/site.ts`: the
navigation, the hero, the eight cards, the quotation, the client stories, the
recognition cards, the careers text, the news and the footer.

**All of it is placeholder content.** The clients (Halden Mutual, Osprey
Freight, Tessera Health, Varda Energy), the people (Elena Marsh, Daniel
Okafor), the product name Canopy, the figures, the awards and the dates are
invented so the design can be judged with realistic copy. None of it is a
statement about KIASA. Before the site is public:

1. Replace the content in `src/content/site.ts`.
2. Replace the photographs (see below).
3. Set `SAMPLE_CONTENT` to `false` in that file. This removes the line in the
   footer that says the content is sample content.

## Photographs

The portrait beside the quotation, `portrait.jpg`, was supplied by KIASA. The
other five photographs in `src/assets/media/` are placeholders from Unsplash,
free to use under the Unsplash License. Replace them with KIASA's own
photography when there is some; the people in `studio.jpg` are not KIASA staff.

| File | Used for | Photographer | Unsplash photo |
| --- | --- | --- | --- |
| `portrait.jpg` | Beside the quotation | Supplied by KIASA | — |
| `river-road.jpg` | The film in Client spotlight | Ben den Engelsen | `photo-1596779845727-d88eb78a1b08` |
| `studio.jpg` | Careers | Drew Dempsey | `photo-1678282931256-370578a0d036` |
| `blue-leaf.jpg` | Card: The maintenance dividend | Amin Alizadeh | `photo-1673554227888-f33f40a90055` |
| `forest-road.jpg` | Card: Halden Mutual | Giordano Rossoni | `photo-1637058468176-30aa8c88bb6b` |
| `leaf-tip.jpg` | Card: Security debt | Alexandra | `photo-1695551527664-585082953b87` |

## How it is built

| File | What it is |
| --- | --- |
| `src/app/page.tsx` | The homepage, wrapped in `StartupBoundary` so the loading mark stands in front of it on every load. |
| `src/app/[...slug]/page.tsx`, `src/app/not-found.tsx` | The placeholder pages and the 404 page. |
| `src/content/site.ts`, `src/content/pages.ts` | The sample content, and the list of pages built from it (also what Search looks through). |
| `src/components/site/shell.tsx` | Header, content, footer: what every page shares. |
| `src/components/site/header.tsx` | The header and its panels: navigation, search, region, and the menu on phones. |
| `src/components/site/hero.tsx`, `hero-field.tsx`, `motion-toggle.tsx` | The hero, its background of veins and lights (plain SVG; the lights move by CSS, the veins ripple by a few lines of script), and the pause button. |
| `src/components/site/featured.tsx`, `story-grid.tsx`, `plates.tsx` | The eight cards, the dialog a card opens, and the line drawings. |
| `src/components/site/voice.tsx`, `spotlight.tsx`, `recognition.tsx`, `careers.tsx`, `news.tsx`, `news-rail.tsx`, `footer.tsx` | The remaining sections. |
| `src/components/site/brand.tsx`, `icons.tsx`, `cta.tsx` | The leaf and the lockup, the icons, the arrow link. |
| `src/styles/site*.css` | The site's styles, one file per part. Colours and typefaces are variables in `src/app/globals.css`. |

Most of the page is rendered on the server and needs no script. Script is used
only where something has to respond: the header's panels and search, the dialog
a card opens, the news row, and the pause button. Without JavaScript the whole
page is still readable.

Motion follows three rules. It stops for visitors who ask for reduced motion.
Anything that moves by itself for more than a moment can be paused. Nothing
moves the layout: the measured layout shift is zero.

## What comes next

1. Decide the real content: what KIASA offers, for whom, with which proof.
2. Design the inner pages, starting with **What we do**, one capability page,
   one case study and **Contact**.
3. Replace the sample content and the photographs.
4. Before going public: a contact form that reaches someone, a cookie notice if
   analytics are added, a sitemap and social sharing images, and checks in
   Safari, Firefox and on real phones.
