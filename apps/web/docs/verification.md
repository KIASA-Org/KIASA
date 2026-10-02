# Local verification — 2026-10-02

Verified on Windows with Node 24.15.0, npm 11.12.1 and headless Playwright
Chromium. Everything below was run on the code as it now stands: the brighter
travelling light and the thin, soft-green loading bar that fills once and stays
full.

- `npm run typecheck`: passed.
- `npm run lint`: passed, no warnings.
- `npm run build`: passed; `/` is prerendered as static content.
- Development browser suite: **40 passed**, 2 production-only cases skipped.
- Production browser suite: **30 passed**, 12 development-only cases skipped.
- Both suites run at desktop 1440 × 900 and mobile 390 × 844.
- `node scripts/capture.mjs`: named frames at both sizes written to `artifacts/`.
  Inspected by eye: the light and the blue rings at real size and at 5× zoom, the
  bar pixel by pixel through the entrance and the loop, and the desktop page
  during the drawing and during the loop.
- `node scripts/measure.mjs` against the production build:

| Production measurement | Desktop | Mobile viewport | Mobile, CPU 4× slower |
| --- | ---: | ---: | ---: |
| Entrance complete | 3032 ms | 3061 ms | 3769 ms |
| Frame interval p95, entrance | 16.7 ms | 16.7 ms | 16.8 ms |
| Frame interval p95, loop | 16.7 ms | 16.8 ms | 16.7 ms |
| Layout shift | 0 | 0 | 0 |
| Long tasks | 0 | 0 | 3 (during hydration) |
| Requests for the logo PNG | 0 | 0 | 0 |
| Browser errors | 0 | 0 | 0 |

The finished still frame is the same picture without JavaScript and with
reduced motion: 0 differing colour channels out of 3,888,000.

Covered by the suites: the entrance playing once and the loop continuing;
the loading bar filling with the drawing, full exactly when it is complete,
then staying full and still, in one solid colour at a whole-pixel size; the
complete leaf (every traced line and drop) with no wordmark or image; only the
small light and an empty bar before scripts load, and the finished leaf if they
never load; no JavaScript; a blocked inline script; Escape; reduced motion at
load and when it changes during the entrance or the loop; every-visit replay;
the once-per-session policy (returning visit, blocked storage); a throttled
background tab settling on return; dashboard deep links; one ink while drawing,
green light only afterwards, and light that reaches a drop green and has turned
blue once it has wrapped it; the loop repeating exactly; `StartupBoundary` with
a pending request after completion and after Skip, keyboard Skip and focus, the
optional WebMCP Skip; production hiding the inspector and fixture.

## Not verified

- Safari, Firefox and real phones. Mobile is Chromium emulation.
- The animation's feel in real time was judged from frame captures, not watched.
- Background-tab behaviour is a deterministic simulation (frames frozen, timers delayed).
- The WebMCP test uses an injected registry, not a browser with native support.
- Tests that rewrite the homepage document run Chromium with
  `--disable-features=LocalNetworkAccessChecks`; see `playwright.config.ts`.
