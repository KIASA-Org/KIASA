# KIASA — company site

The homepage of KIASA's company site, with the animated KIASA leaf in front of
it on the first visit.

- **The loading mark.** A small light appears, the leaf is drawn line by line
  in white while a thin bar fills, dew rolls along its veins, and then the mark
  fades away. It plays on every load of the homepage.
- **The homepage.** Planned on the structure of Accenture's homepage: header
  with panels of links, a hero, eight featured cards, a leader's words, client
  spotlight, recognition, careers, news, footer. All of its content is **sample
  content** for the design review, kept in one file.
- **Every other page** has its address and title and shows a short placeholder
  until it is designed.

Built with Next.js App Router, React, strict TypeScript, Tailwind CSS v4 and
Motion. The plan, the list of pages and the photo credits are in
[docs/site.md](docs/site.md); the loading mark is described in
[docs/intro.md](docs/intro.md).

## Run locally

Requires Node 20.9+ and npm. From `apps/web`:

```powershell
npm ci
npm run dev
```

Open http://localhost:3000. For a local production run: `npm run build`, then `npm start`.

The loading mark plays on every load of the homepage; a refresh starts it again.

## Change the content

| To change | Edit |
| --- | --- |
| Any text, link, client, figure or date on the homepage | `src/content/site.ts` |
| The navigation and what its panels list | `navigation` in `src/content/site.ts` |
| The photographs | `src/assets/media/` (credits in [docs/site.md](docs/site.md)) |
| The line drawings on the cards | `src/components/site/plates.tsx` |
| Colours and typefaces | the variables at the top of `src/app/globals.css`, and the fonts in `src/app/layout.tsx` |
| The look of a section | `src/styles/site*.css` (one file per part of the page) |
| The notice that the content is sample content | `SAMPLE_CONTENT` in `src/content/site.ts` |

## Change the loading mark

| To change | Edit |
| --- | --- |
| Size of the drawing | `--mark-size` in `src/app/globals.css` (now about 240 px, 200 px on phones) |
| Loading bar width, thickness, colour, gap | `.mark-bar`, `.mark-bar-fill` and `.mark-group` in `src/app/globals.css` |
| "Loading..." label text, size, colour, dot animation | `Bar` in `scene.tsx`; `.mark-label` and `.mark-dots` in `globals.css` |
| Pace of the drawing | `TEMPO`, `PHASE`, `SPEED` in `src/components/intro/timing.ts` |
| Colours and line weights | `LEAF`, `WATER` in `src/components/intro/scene.tsx`; `INK`, `inkWidth` in `drawing.ts` |
| On every visit, or once per session | `INTRO_FREQUENCY` in `src/components/intro/config.ts` |
| How long the mark takes to fade away | `LEAVE_MS` in `config.ts` and the transition on `#kiasa-intro` in `globals.css` |
| Which lines exist | the tables in `scripts/trace-logo.mjs`, then re-run it |

`public/brand/kiasa-logo.png` is the supplied 1200 × 1200 logo, byte-identical
to `../../assets/kiasa-logo.png`. The page does not load it. Instead
`node scripts/trace-logo.mjs` measures it and writes
`src/components/intro/geometry.ts`: the centreline of every pale vein, border
and stem, the bud, and each dew drop. The same script cuts the favicon
(`src/app/icon.png`). The header and footer show the same drawing, still.

## Development tools

In development, http://localhost:3000/dev/intro is an inspector for the loading
mark: scrub its timeline, jump to a named frame, or press **Play**. Its
**Test pending request** button opens `/?intro-test=loading`, where the mark
stands in front of a page that is waiting for a real request. Neither exists in
production.

## Verify

```powershell
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:e2e:production
```

With the dev server on port 3000, `node scripts/capture.mjs` writes named frames
to `artifacts/`. With a production server started using
`npm start -- --port 3001`, `node scripts/measure.mjs` records timing and frame
pacing. Results and limits are in [docs/verification.md](docs/verification.md).
