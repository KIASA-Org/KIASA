/**
 * Text helpers shared by the appliers.
 *
 * Matching follows the example document: whitespace and case are ignored.
 * Smart quotes, dashes and non-breaking spaces are folded to ASCII as well,
 * because they are the usual reason an "exact" match silently fails.
 */
export function normalize(s: string): string {
  return s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function sameText(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** Same items regardless of order, compared with normalize(). */
export function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const remaining = b.map(normalize);
  for (const item of a) {
    const i = remaining.indexOf(normalize(item));
    if (i < 0) return false;
    remaining.splice(i, 1);
  }
  return true;
}

/** Drops blanks and repeats (compared with normalize()), keeping the first spelling. */
export function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = normalize(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function short(s: string, max = 60): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max - 3) + "...";
}
