# KIASA — startup mark

The landing page is one thing: the KIASA leaf as a white line drawing on a dark
ground, with a thin loading bar and a small "Loading..." label (its dots appear
one by one) beneath it. A small light appears, the leaf is
drawn line by line while the bar fills, dew rolls along its veins, and then a
glowing light-green line keeps running around the leaf, turning blue where it
touches a dew drop. The bar stays full. No wordmark and no colour artwork are
shown.

Built with Next.js App Router, React, strict TypeScript, Tailwind CSS v4 and
Motion. Nothing has been deployed.

## Run locally

Requires Node 20.9+ and npm. From `apps/web`:

```powershell
npm ci
npm run dev
```

Open http://localhost:3000. For a local production run: `npm run build`, then `npm start`.

## Inspect

In development, open http://localhost:3000/dev/intro. Scrub the timeline, jump
to a named frame, or press **Play**. `/dev/intro?t=1.4` opens
one exact frame. The timeline slider and buttons are a development tool only:
they are not part of the landing page and return 404 in production.

**Test pending request** opens `/?intro-test=loading`, a fixture for
`StartupBoundary`: the mark stands in front of a page while a real request is
pending. It is also development only.

## Controls

| To change | Edit |
| --- | --- |
| Size of the drawing | `--mark-size` in `src/app/globals.css` (now about 240 px, 200 px on phones) |
| Loading bar width, thickness, colour, gap | `.mark-bar`, `.mark-bar-fill` and `.mark-group` in `src/app/globals.css` |
| "Loading..." label text, size, colour, dot animation | `Bar` in `scene.tsx`; `.mark-label` and `.mark-dots` in `globals.css` |
| Pace of the drawing | `TEMPO`, `PHASE`, `SPEED` in `src/components/intro/timing.ts` |
| Speed and route of the running line | `CIRCUIT`, `CIRCUIT_SPEED`, `STEM_SPEED`, `VEIN_SPEED` in `timing.ts` |
| Colours and line weights | `INK`, `LEAF`, `WATER`, `inkWidth` in `src/components/intro/scene.tsx` |
| Shape and strength of the travelling light | `COMET`, `SPARK`, `PRESENCE` in `scene.tsx`; its glow is `.mark-flow` and `.mark-water` in `globals.css` |
| Draw on every visit or once per session | `INTRO_FREQUENCY` in `src/components/intro/config.ts` |
| Which lines exist | the tables in `scripts/trace-logo.mjs`, then re-run it |

## The drawing comes from the logo

`public/brand/kiasa-logo.png` is the supplied 1200 × 1200 logo, byte-identical
to `../../assets/kiasa-logo.png`. The page does not load it. Instead
`node scripts/trace-logo.mjs` measures it and writes
`src/components/intro/geometry.ts`: the centreline of every pale vein, border
and stem, the bud, and each dew drop. Add `--debug artifacts/trace` to get an
overlay of the traced lines on the artwork. The same script cuts the favicon
(`src/app/icon.png`).

## Using it in front of a real page

- `StartupMark` is the animated drawing as page content. The landing page uses it.
- `StartupBoundary` puts the same drawing in front of a page: it plays once, and
  keeps flowing only while `readiness` is genuinely `pending`. It takes
  `onComplete` and `onSkip` callbacks and shows a Skip control.

See [integration notes](docs/intro.md) for the lifecycle and fallbacks.

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
