import { Fragment } from "react";
import { RING, glint, inkWidth } from "@/components/intro/drawing";
import { DEW, ORIGIN, STROKES, VIEW, type Leaf } from "@/components/intro/geometry";
import { LOOP_PULSES, LOOP_RIPPLES, PERIOD } from "@/components/intro/timing";

/** The hero's background: the whole KIASA leaf, large and faint, swaying gently
 * as if in a light wind. The same green light that runs around the loading mark
 * runs around it here, on the mark's own timing, and turns each dew drop blue as
 * it passes. It is the same drawing as the mark and the header, every line of it.
 * Drawn as plain SVG and moved by CSS, so it costs no script, pauses with the
 * hero's button and stops for reduced motion.
 */

/** The background takes the mark's choreography at a calmer pace. */
const TEMPO = 1.5;
/** A light is a comet: stacked stretches ending at the same head, each shorter and brighter. [share of the line, class, extra width] */
const COMET = [[0.5, "tail", 2.4], [0.24, "body", 1.8], [0.05, "tip", 0.6]] as const;

const seconds = (value: number) => `${(value * TEMPO).toFixed(2)}s`;
const round = (value: number) => Math.round(value * 100) / 100;

/** Each stroke that carries light, with its run as CSS variables. With pathLength
 * 1 a unit is the whole line. The dash pattern repeats every `--span` units, and
 * one period moves it exactly one span, so the head crosses the line in the
 * pulse's own duration and is back at the start when the period comes round. */
const lights = STROKES.flatMap(stroke => {
  const pulse = LOOP_PULSES.get(stroke.id);
  if (!pulse) return [];
  const span = PERIOD / pulse.duration;
  return [{ stroke, reverse: !!pulse.reverse, style: { "--span": round(span), "--from": seconds(pulse.offset - PERIOD) } as React.CSSProperties }];
});

const drops = DEW.map(drop => {
  const ripple = LOOP_RIPPLES.get(drop.id)!;
  const leaf: Leaf = drop.vein ? STROKES.find(stroke => stroke.id === drop.vein)!.leaf : "bud";
  return { drop, leaf, style: { "--from": seconds(ripple.offset - PERIOD) } as React.CSSProperties };
});

const LEAVES: readonly Leaf[] = ["bud", "crown", "left", "right"];

/** A group that turns about the plant's heart: CSS rotates the middle element
 * about its own origin, which the translations put at the heart. */
function AboutTheHeart({ className, children }: { className: string; children: React.ReactNode }) {
  return <g transform={`translate(${ORIGIN.x} ${ORIGIN.y})`}>
    <g className={className}><g transform={`translate(${-ORIGIN.x} ${-ORIGIN.y})`}>{children}</g></g>
  </g>;
}

export function HeroField() {
  return <div className="hero-field" aria-hidden="true" style={{ "--period": seconds(PERIOD) } as React.CSSProperties}>
    <svg className="hero-leaf" viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}`} fill="none" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <AboutTheHeart className="hero-sway">
        {LEAVES.map(leaf => <AboutTheHeart key={leaf} className={`hero-sway-leaf hero-sway-${leaf}`}>
          <g className="hero-veins">
            {STROKES.filter(stroke => stroke.leaf === leaf).map(stroke => <path key={stroke.id} d={stroke.d} strokeWidth={inkWidth(stroke)} data-role={stroke.role} />)}
          </g>
          {lights.some(({ stroke }) => stroke.leaf === leaf) && <g className="hero-lights">
            {lights.filter(({ stroke }) => stroke.leaf === leaf).map(({ stroke, reverse, style }) => <g key={stroke.id} style={style} data-reverse={reverse ? "" : undefined}>
              {COMET.map(([share, part, extra]) => <path key={part} d={stroke.d} pathLength={1} data-part={part} strokeWidth={inkWidth(stroke) + extra} style={{ "--share": share } as React.CSSProperties} />)}
            </g>)}
          </g>}
          <g className="hero-drops">
            {drops.filter(entry => entry.leaf === leaf).map(({ drop, style }) => <Fragment key={drop.id}>
              <circle cx={drop.x} cy={drop.y} r={drop.r} strokeWidth={RING} style={style} />
              <path d={glint(drop)} strokeWidth={RING - 0.3} style={style} />
            </Fragment>)}
          </g>
        </AboutTheHeart>)}
      </AboutTheHeart>
    </svg>
  </div>;
}
