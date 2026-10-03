import { Fragment } from "react";
import { RING, glint, inkWidth } from "@/components/intro/drawing";
import { DEW, STROKES, VIEW } from "@/components/intro/geometry";

/** The KIASA leaf, still: the same line drawing as the loading mark, every vein,
 * border and dew drop of it. `weight` thickens its lines for small sizes, where
 * the drawing's own weights would be thinner than a pixel. */
export function LeafMark({ weight = 1, className }: { weight?: number; className?: string }) {
  return <svg className={className} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}`} fill="none" stroke="currentColor"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {STROKES.map(stroke => <path key={stroke.id} d={stroke.d} strokeWidth={inkWidth(stroke) * weight} />)}
    {DEW.map(drop => <Fragment key={drop.id}>
      <circle cx={drop.x} cy={drop.y} r={drop.r} strokeWidth={RING * weight} />
      <path d={glint(drop)} strokeWidth={(RING - 0.3) * weight} />
    </Fragment>)}
  </svg>;
}

/** The leaf beside the company's name. */
export function Lockup({ className }: { className?: string }) {
  return <span className={`lockup${className ? ` ${className}` : ""}`}>
    <LeafMark className="lockup-mark" weight={3.4} />
    <span className="lockup-word">KIASA</span>
  </span>;
}
