# KIASA startup mark

All source and asset paths below are relative to `apps/web`.

The homepage opens with the KIASA leaf as a white line drawing, about 240 px
wide, on a near-black ground, with a thin loading bar and a small "Loading..."
label beneath it. The leaf is drawn once; then the mark fades away and the
company page is there. It plays on every load of the homepage, so a refresh
starts again from the first light.

## What plays

One clock drives everything (`src/components/intro/timing.ts`, seconds):

| Clock | What happens |
| --- | --- |
| 0 | A small light at the heart of the plant. It is visible before scripts load. |
| 0.25 – 2.0 | The leaf is drawn in one pale ink, line by line: bud, the three stems, the borders, then the veins, innermost first. |
| 1.6 – 2.8 | Dew beads roll along their veins and settle as drops. |
| 2.92 (`SETTLED`) | The drawing is complete. On the homepage the mark now fades away (0.6 s, `LEAVE_MS`) while the page's headline rises into place. |
| after `SETTLED` | Only where the mark has to stay because the application is still loading: the loop, every 5.7 s (`PERIOD`). A light-green line runs out along one border of a leaf and back along the other, leaf after leaf. As it enters a leaf, light runs up that leaf's stem and dew-bearing veins, and turns blue where it reaches a drop, wrapping the drop from the point of contact. |

The white drawing never changes; colour only ever travels across it. The logo's
wordmark and colour artwork are not shown.

The travelling light is drawn as a comet rather than a flat bar of colour
(`RAMP` in `scene.tsx`): eight stretches of the same line, all ending at the
head, each shorter than the last and each faint, coloured from one ramp. That
gives a long deep-teal tail, a jade body, a pale mint tip and a small spark at
the very front, with a close glow from CSS, and no visible step where one
stretch gives way to the next. The border line is strongest, stems a little less, fine
veins quieter (`PRESENCE`). Light on stems and veins gathers speed as it leaves
the heart. It reaches a drop still green and turns blue as it wraps it.

The loading bar follows the same clock. It is a thin pill with one solid fill
in a soft light green. It fills from empty at 0 to full at `SETTLED`, so it
shows how far the drawing has got, not an invented percentage, and then it
stays full and still. It is decorative (hidden from assistive technology);
genuine loading is announced by `StartupBoundary`'s status text instead.

The mark and its bar are kept on whole pixels (see the `@supports` block at the
top of `globals.css`), so the 3 px bar is drawn as exactly three sharp rows.

## Source map

| File | Responsibility |
| --- | --- |
| `src/app/page.tsx` | The homepage, wrapped in `StartupBoundary`. |
| `src/app/layout.tsx` | Document, typefaces, metadata and the inline pre-paint bootstrap. |
| `src/components/intro/geometry.ts` | Generated. Every line and dew drop, measured from the logo. |
| `src/components/intro/drawing.ts` | How the leaf is drawn: its ink, line weights and the glint on each drop. Shared with the still leaf in the site's header. |
| `src/components/intro/timing.ts` | The choreography as data: entrance spans, loop pulses, easing. |
| `src/components/intro/scene.tsx` | `MarkScene`: the SVG, a pure function of the clock. |
| `src/components/intro/playback.ts` | `useMarkPlayback`: runs the entrance once, then the loop; reduced motion. |
| `src/components/intro/controller.tsx` | `StartupBoundary`: the mark in front of a page, for the entrance and for as long as the page is genuinely loading. |
| `src/components/intro/bootstrap.ts` | Pre-paint decision, Skip, focus, and the watchdog that guarantees an end. |
| `src/components/intro/config.ts` | Replay policy, session key, budgets, the length of the fade. |
| `src/components/intro/preview.tsx` | Development inspector. |
| `scripts/trace-logo.mjs` | Measures `public/brand/kiasa-logo.png` and writes `geometry.ts` and the favicon. |

## How the lines were measured

The supplied logo is a 1200 × 1200 transparent PNG with no vector paths. Its
veins and borders are pale lines on green, so its blue channel isolates them.
`scripts/trace-logo.mjs` thins that channel to one-pixel centrelines, follows
each from the plant's heart outward, and fits smooth curves to them. The bud's
dark right edge is found by scanning its light body row by row. Dew drops are
measured circles; each records the vein that reaches it and where they touch,
which is where the blue light starts to wrap.

Run `node scripts/trace-logo.mjs --debug artifacts/trace` to see the traced
lines over the artwork. The original PNG stays in `public/brand/` and
`../../assets/` unchanged (SHA-256
`D9A3CBB0EC469FA7FA972673AA280FED5D6E5ECD71528960D6543A2C8376B885`); the page
itself does not download it.

## Lifecycle and fallbacks

The server renders the whole homepage, and after it the stage with the finished
drawing. CSS keeps the stage out of sight unless the pre-paint script asks for
it, so a failure anywhere leaves the page, never an empty screen.

- **Before first paint** the inline bootstrap decides whether the entrance
  plays. If it will, `<html data-kiasa-intro="waiting">` shows the stage with
  only the small light and an empty bar, so nothing has to be un-drawn. When
  React starts the clock the attribute becomes `"playing"`; when the entrance
  ends it is removed.
- **While it plays** the page behind is inert, hidden from assistive
  technology, and cannot be scrolled, so it opens at its top. **Skip intro**
  (or Escape) ends the entrance at once; keyboard focus then moves into the
  page.
- **When it ends** the stage lets go of the page immediately, fades for 0.6 s
  and is then removed. The page's headline rises into place under the fade.
  Where the browser cannot animate that, the stage simply goes.
- **Once per session.** `INTRO_FREQUENCY` in `config.ts` is
  `"once-per-session"`: a reload, or coming back to the homepage in the same
  tab, opens the page at once. Blocked session storage fails open to the page.
  `"every-visit"` plays it on every homepage load.
- **Scripts never arrive:** after `START_BUDGET_MS` (3 s) the bootstrap gives
  up and the page is shown.
- **No JavaScript:** the page is simply there.
- **Reduced motion:** the page from first paint, with no entrance. If the
  preference changes while the entrance is playing, it ends without a fade.
- **Background tab:** timers are throttled there, so the deadline is checked
  again the moment the tab is shown.
- **Other pages** never play it: the bootstrap only opts in on `/`.

## Integration

```tsx
// The mark in front of a page (the homepage does this):
<StartupBoundary onComplete={result => {}} onSkip={() => {}}>
  <YourPage />
</StartupBoundary>

// The same, for a page that has to wait for something real:
<StartupBoundary readiness={{ status: "pending" }}>
  <YourPage />
</StartupBoundary>
```

```ts
type ApplicationReadiness = { status: "ready" } | { status: "pending"; message?: string };
type IntroResult = { reason: IntroReason; elapsedMs: number };
```

`StartupBoundary` covers its children only while the entrance plays, shows a
Skip control, keeps the covered page inert, and moves focus into the page when
it ends. The page needs an element with the id `main-content` to receive that
focus. While `readiness` is `pending` the mark stays up and keeps flowing, and
a visually hidden status announces "Loading…"; it never invents progress. Pass
real request state in. Do not start or finish data loading from `onComplete`:
it reports the animation, not the application. It fires once for every outcome,
including `reduced-motion`, `returning-visit` and `not-started` (client-side
navigation, where the pre-paint script did not run).

If a Content Security Policy later restricts inline scripts, give the bootstrap
a nonce or hash. If it is blocked, there is no entrance and the page is shown.
`StartupBoundary` also registers an optional, feature-detected WebMCP action,
`skip_kiasa_intro`, which calls the same Skip handler.

## Notes for whoever changes this next

- The timeline slider at `/dev/intro` is a development inspector, not part of
  the product. `/?intro-test=loading` (development only) shows the mark in
  front of a page that is waiting for a real request.
- The entrance takes 2.9 s. `TEMPO = 0.8` in `timing.ts` brings it to about 2.3 s.
- Stroke widths are in logo pixels and scale with `--mark-size`. Below about
  200 px the finest veins get close to half a pixel wide.
- The leaf in the site's header and footer is the same drawing, still
  (`LeafMark` in `src/components/site/brand.tsx`). Do not simplify it; thicken
  its lines with `weight` instead.
