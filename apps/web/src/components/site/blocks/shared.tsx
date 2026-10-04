import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Art, Link as LinkData, Tone } from "@/content/blocks";
import { isPhoto, photos, type PhotoKey } from "@/content/photos";
import { CtaContent } from "../cta";
import { Plate, isPlate } from "../plates";

/** A stock photograph. `decorative` drops the description where the picture only dresses a link. */
export function Photo({ photo, sizes, priority = false, decorative = false, className }: {
  photo: PhotoKey; sizes: string; priority?: boolean; decorative?: boolean; className?: string;
}) {
  const { src, alt } = photos[photo];
  return <Image src={src} alt={decorative ? "" : alt} fill sizes={sizes} priority={priority} placeholder="blur" className={className} />;
}

/** A photograph or one of the patterns, always decorative: it sits beside words that say the same. */
export function ArtView({ art, sizes }: { art: Art; sizes: string }) {
  if (isPhoto(art)) return <Photo photo={art} sizes={sizes} decorative />;
  if (isPlate(art)) return <Plate name={art} />;
  return null;
}

/** The arrow link used across the site. */
export function Cta({ link, className }: { link: LinkData; className?: string }) {
  return <Link href={link.href} prefetch={false} className={`cta${className ? ` ${className}` : ""}`}><CtaContent>{link.label}</CtaContent></Link>;
}

/** One section of a page, in the wide column. Light tones bring their own ground. */
export function Section({ type, tone, id, label, children, wide = true }: {
  type: string; tone?: Tone; id?: string; label?: string; children: ReactNode; wide?: boolean;
}) {
  return <section className={`block block-${type}`} data-tone={tone && tone !== "night" ? tone : undefined} id={id} aria-label={label}>
    <div className={`wrap${wide ? " wrap-wide" : ""}`}>{children}</div>
  </section>;
}

/** A section's heading: small capitals, the title, a line under it, and a link to the right. */
export function SectionHead({ eyebrow, heading, intro, cta }: { eyebrow?: string; heading?: string; intro?: string; cta?: LinkData }) {
  if (!eyebrow && !heading && !intro && !cta) return null;
  return <header className="block-head">
    <div className="block-head-text">
      {eyebrow && <p className="eyebrow block-eyebrow">{eyebrow}</p>}
      {heading && <h2 className="block-title">{heading}</h2>}
      {intro && <p className="block-lead">{intro}</p>}
    </div>
    {cta && <Cta link={cta} className="block-head-cta" />}
  </header>;
}

/** Initials for a person's tile: the first letter of the first and last names. */
export function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
}

const DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });
/** "2026-09-29" → "September 29, 2026", the same on the server and in every browser. */
export const longDate = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));
