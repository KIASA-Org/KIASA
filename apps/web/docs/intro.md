# KIASA startup mark

All source and asset paths below are relative to `apps/web`.

The landing page shows the KIASA leaf as a white line drawing, about 240 px
wide, on a near-black ground, with a thin loading bar beneath it. It adds no
company claims, navigation or copy.

## What plays

One clock drives everything (`src/components/intro/timing.ts`, seconds):

| Clock | What happens |
| --- | --- |
| 0 | A small light at the heart of the plant. It is visible before scripts load. |
| 0.25 – 2.0 | The leaf is drawn in one pale ink, line by line: bud, the three stems, the borders, then the veins, innermost first. |
| 1.6 – 2.8 | Dew beads roll along their veins and settle as drops. |
| 2.92 (`SETTLED`) | The drawing is complete and at rest. |
| after `SETTLED` | The loop, every 5.7 s (`PERIOD`): a light-green line runs out along one border of a leaf and back along the other, leaf after leaf. As it enters a leaf, light runs up that leaf's stem and dew-bearing veins, and turns blue where it reaches a drop, wrapping the drop from the point of contact. |

The white drawing never changes; colour only ever travels across it. The logo's
wordmark and colour artwork are not shown.

The travelling light is drawn as a comet rather than a flat bar of colour
(`COMET` in `scene.tsx`): several stretches of the same line, all ending at the
head, each shorter and stronger than the last. That gives a long faint tail, a
vivid green body, an almost white tip and a small spark at the very front, with
a close glow from CSS. The border line is strongest, stems a little less, fine
veins quieter (`PRESENCE`). Light on stems and veins gathers speed as it leaves
the heart. It reaches a drop still green and turns blue as it wraps it.

The loading bar follows the same clock. It is a thin pill with one solid fill
in a soft light green. It fills from empty at 0 to full at `SETTLED`, so it
shows how far the drawing has got, not an invented percentage, and then it
stays full and still. It is decorative (hidden from assistive technology);
genuine loading is announced by `StartupBoundary`'s status text instead.

## Source map

| File | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Server-rendered landing page: a heading for the brand name and the mark. |
| `src/app/layout.tsx` | Document, metadata and the inline pre-paint bootstrap. |
| `src/components/intro/geometry.ts` | Generated. Every line and dew drop, measured from the logo. |
| `src/components/intro/timing.ts` | The choreography as data: entrance spans, loop pulses, easing. |
| `src/components/intro/scene.tsx` | `MarkScene`: the SVG, a pure function of the clock. |
| `src/components/intro/playback.ts` | `useMarkPlayback`: runs the entrance once, then the loop; reduced motion. |
| `src/components/intro/mark.tsx` | `StartupMark`: the drawing as page content (the landing page). |
| `src/components/intro/controller.tsx` | `StartupBoundary`: the drawing in front of a page that may still be loading. |
| `src/components/intro/bootstrap.ts` | Pre-paint decision, Skip, focus, and the watchdog that guarantees an end. |
| `src/components/intro/config.ts` | Replay policy, session key, budgets. |
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

The server renders the finished, still drawing over a full bar. Everything else
is an enhancement on top of that, so a failure leaves a complete leaf, never an
empty page.

- **Before first paint** the inline bootstrap decides whether the entrance
  plays. If it will, `<html data-kiasa-intro="waiting">` hides the lines,
  empties the bar and shows only the small light, so nothing has to be un-drawn. When React starts
  the clock the attribute becomes `"playing"`; when the entrance ends it is
  removed.
- **Scripts never arrive:** after `START_BUDGET_MS` (3 s) the bootstrap gives
  up and the finished drawing fades in.
- **No JavaScript:** the finished drawing is simply there.
- **Reduced motion:** the finished drawing from first paint, and no loop. If
  the preference changes while playing, motion stops; if it is lifted, the loop
  starts.
- **Background tab:** timers are throttled there, so the deadline is checked
  again the moment the tab is shown.
- **Escape** ends the entrance at once.
- The loop pauses with the tab (it runs on animation frames) and costs nothing
  while hidden.

`INTRO_FREQUENCY` in `config.ts` is `"every-visit"`: the landing page is the
animation, so each load draws it. Set `"once-per-session"` when a full site
sits behind it; later visits in the same tab then start from the finished
drawing. Blocked session storage fails open to the finished drawing.

## Integration

```tsx
// The drawing as page content (today's landing page):
<StartupMark onComplete={result => {}} />

// The drawing in front of a page:
<StartupBoundary readiness={{ status: "pending" }} onComplete={…} onSkip={…}>
  <YourPage />
</StartupBoundary>
```

```ts
type ApplicationReadiness = { status: "ready" } | { status: "pending"; message?: string };
type IntroResult = { reason: IntroReason; elapsedMs: number };
```

`StartupBoundary` covers its children only while the entrance plays, shows a
Skip control, keeps the covered page inert, and moves focus into the page when
it ends. While `readiness` is `pending` the mark stays up and keeps flowing,
and a visually hidden status announces "Loading…"; it never invents progress.
Pass real request state in. Do not start or finish data loading from
`onComplete`: it reports the animation, not the application. It fires once for
every outcome, including `reduced-motion`, `returning-visit` and `not-started`
(client-side navigation, where the pre-paint script did not run).

Keep the boundary on the pages that should open with the mark. The bootstrap
only ever opts in on `/`, so dashboard deep links never play it.

If a Content Security Policy later restricts inline scripts, give the bootstrap
a nonce or hash. If it is blocked, the page still shows the finished drawing and
the loop. `StartupBoundary` also registers an optional, feature-detected WebMCP
action, `skip_kiasa_intro`, which calls the same Skip handler.

## Notes for whoever changes this next

- The timeline slider at `/dev/intro` is a development inspector, not part of
  the product.
- The entrance takes 2.9 s. `TEMPO = 0.8` in `timing.ts` brings it to about 2.3 s.
- Stroke widths are in logo pixels and scale with `--mark-size`. Below about
  200 px the finest veins get close to half a pixel wide.
