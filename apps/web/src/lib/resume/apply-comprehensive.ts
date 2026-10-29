import { ComprehensiveAnswerSchema, describeIssues, type Profile } from "./schema";
import { dedupe, sameList, sameText, short, wordCount } from "./text";

export interface ApplyComprehensiveOptions {
  /** How many of the newest roles may change. The prompt allows two. */
  editableRoles?: number;
  minBulletWords?: number;
}

export interface ApplyComprehensiveResult {
  /** True when the answer parsed and every change was found and allowed. */
  ok: boolean;
  /** The profile with every applied change. Unchanged when the answer could not be parsed. */
  profile: Profile;
  applied: string[];
  /** Anchors that were not found. The model paraphrased them: rerun rather than fix by hand. */
  unmatched: string[];
  /** Changes aimed at frozen roles. Dropped. */
  rejected: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Applies a comprehensive-prompt answer (a change list) to a profile copy.
 * Matching follows the example document: the original text is located with
 * whitespace and case ignored, and only that line, summary or skills array is replaced.
 */
export function applyComprehensive(
  current: Profile,
  answer: unknown,
  opts: ApplyComprehensiveOptions = {},
): ApplyComprehensiveResult {
  const editable = opts.editableRoles ?? 2;
  const minWords = opts.minBulletWords ?? 25;
  const r: ApplyComprehensiveResult = {
    ok: false,
    profile: structuredClone(current),
    applied: [],
    unmatched: [],
    rejected: [],
    warnings: [],
    errors: [],
  };

  const parsed = ComprehensiveAnswerSchema.safeParse(answer);
  if (!parsed.success) {
    r.errors.push("The answer does not match the expected change format.", ...describeIssues(parsed.error.issues));
    return r;
  }
  const a = parsed.data;
  const p = r.profile;

  const checkWords = (bullet: string, where: string) => {
    const n = wordCount(bullet);
    if (n < minWords) r.warnings.push(`${where} has ${n} words (minimum ${minWords}): "${short(bullet)}"`);
  };
  const frozen = (roleIndex: number, what: string) =>
    r.rejected.push(
      `${what} in ${p.experience[roleIndex].company} (role ${roleIndex + 1}) was dropped: only the ${editable} most recent roles may change.`,
    );

  // Headline title
  if (a.info) {
    if (sameText(p.info.title, a.info.original.title)) {
      p.info.title = a.info.updated.title;
      r.applied.push(`Title: "${a.info.original.title}" -> "${a.info.updated.title}"`);
    } else {
      r.unmatched.push(`Title: the answer's original "${a.info.original.title}" is not the current title "${p.info.title}".`);
    }
  }

  // Summary
  if (a.summary) {
    if (sameText(p.summary, a.summary.original)) {
      p.summary = a.summary.updated;
      r.applied.push("Summary rewritten.");
    } else {
      r.unmatched.push("Summary: the answer's original text does not match the current summary.");
    }
  }

  // Bullet rewrites
  for (const item of a.exp ?? []) {
    const label = item.original.company ?? item.original.title ?? "unknown role";
    const hit = findBullet(p, item.original.company, item.original.title, item.original.description);
    if (!hit) {
      r.unmatched.push(`Bullet not found in ${label}: "${short(item.original.description)}"`);
      continue;
    }
    if (hit.roleIndex >= editable) {
      frozen(hit.roleIndex, "A bullet rewrite");
      continue;
    }
    const role = p.experience[hit.roleIndex];
    if (hit.viaFallback) {
      r.warnings.push(`Bullet "${short(item.original.description)}" was found in ${role.company}, not in ${label} as the answer said.`);
    }
    if (item.updated.title && !sameText(item.updated.title, role.title)) {
      r.warnings.push(`Ignored a job title change for ${role.company} ("${item.updated.title}"): titles never change.`);
    }
    role.descriptionLines[hit.lineIndex] = item.updated.description;
    checkWords(item.updated.description, `Rewritten bullet ${hit.lineIndex + 1} in ${role.company}`);
    r.applied.push(`Rewrote bullet ${hit.lineIndex + 1} in ${role.company}.`);
  }

  // Skills rewrites (per category; add-only is enforced here)
  for (const [name, change] of Object.entries(a.skills ?? {})) {
    let cat = p.skills.find((c) => sameText(c.category, name));
    if (!cat) cat = p.skills.find((c) => sameList(c.skills, change.original));
    if (!cat) {
      r.unmatched.push(`Skills category "${name}" was not found by name or by its skills list.`);
      continue;
    }
    if (!sameList(cat.skills, change.original)) {
      r.warnings.push(`Skills "${cat.category}": the answer's original list differs from the current list; applied anyway.`);
    }
    const dropped = cat.skills.filter((s) => !change.updated.some((u) => sameText(u, s)));
    cat.skills = dedupe([...change.updated, ...dropped]);
    if (dropped.length) {
      r.warnings.push(
        `Skills "${cat.category}": re-added ${dropped.length} skill(s) the answer left out (${dropped.join(", ")}), because skills are add-only.`,
      );
    }
    r.applied.push(`Updated skills in "${cat.category}" (${cat.skills.length} skills).`);
  }

  // New bullets
  for (const add of a.exp_add ?? []) {
    const label = [add.target.company, add.target.title].filter(Boolean).join(" / ") || "unknown role";
    const roleIndex = findRole(p, add.target.company, add.target.title);
    if (roleIndex < 0) {
      r.unmatched.push(`exp_add target not found: ${label}.`);
      continue;
    }
    if (roleIndex >= editable) {
      frozen(roleIndex, `${add.descriptionLines.length} new bullet(s)`);
      continue;
    }
    const role = p.experience[roleIndex];
    const idx = parseIndex(add.insertAfterIndex);
    const at =
      idx !== null && idx >= -1 && idx < role.descriptionLines.length
        ? idx + 1
        : Math.floor(role.descriptionLines.length / 2);
    role.descriptionLines.splice(at, 0, ...add.descriptionLines);
    add.descriptionLines.forEach((b) => checkWords(b, `New bullet in ${role.company}`));
    r.applied.push(`Added ${add.descriptionLines.length} bullet(s) to ${role.company} at position ${at + 1}.`);
  }

  // New skills
  for (const add of a.skills_add ?? []) {
    let cat = p.skills.find((c) => sameText(c.category, add.category));
    if (!cat) {
      cat = { category: add.category.trim(), skills: [] };
      p.skills.push(cat);
      r.applied.push(`Created skills category "${cat.category}".`);
    }
    const existing = cat;
    const fresh = dedupe(add.skills).filter((s) => !existing.skills.some((e) => sameText(e, s)));
    existing.skills.push(...fresh);
    r.applied.push(
      fresh.length
        ? `Added to "${existing.category}": ${fresh.join(", ")}.`
        : `Nothing new for "${existing.category}": all listed skills were already present.`,
    );
  }

  r.errors.push(...integrityErrors(current, p, editable));
  r.ok = r.errors.length === 0 && r.unmatched.length === 0 && r.rejected.length === 0;
  return r;
}

/** Index of the role named by company and/or title, or -1. */
function findRole(p: Profile, company?: string, title?: string): number {
  const all = p.experience.map((_, i) => i);
  const byCompany = company ? all.filter((i) => sameText(p.experience[i].company, company)) : [];
  if (byCompany.length === 1) return byCompany[0];
  if (byCompany.length > 1) {
    const byBoth = title ? byCompany.find((i) => sameText(p.experience[i].title, title)) : undefined;
    return byBoth ?? byCompany[0];
  }
  if (title) {
    const byTitle = all.filter((i) => sameText(p.experience[i].title, title));
    if (byTitle.length === 1) return byTitle[0];
  }
  return -1;
}

/** Finds the bullet whose text matches, preferring the named role, then any role. */
function findBullet(
  p: Profile,
  company: string | undefined,
  title: string | undefined,
  description: string,
): { roleIndex: number; lineIndex: number; viaFallback: boolean } | null {
  const preferred = findRole(p, company, title);
  const order = p.experience.map((_, i) => i);
  if (preferred >= 0) order.sort((x, y) => (x === preferred ? -1 : y === preferred ? 1 : x - y));
  for (const roleIndex of order) {
    const lineIndex = p.experience[roleIndex].descriptionLines.findIndex((line) => sameText(line, description));
    if (lineIndex >= 0) return { roleIndex, lineIndex, viaFallback: preferred >= 0 && roleIndex !== preferred };
  }
  return null;
}

function parseIndex(v: number | string | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === "string" && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

/** Safety net: the invariants the prompt promises, checked on the result. */
function integrityErrors(before: Profile, after: Profile, editable: number): string[] {
  const errors: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ["name", "location", "email", "phone", "linkedin"] as const) {
    if (before.info[key] !== after.info[key]) errors.push(`info.${key} changed.`);
  }
  if (before.experience.length !== after.experience.length) errors.push("Experience count changed.");
  if (before.education.length !== after.education.length) errors.push("Education count changed.");
  if (!same(before.education, after.education)) errors.push("Education changed.");
  if (!same(before.certifications, after.certifications)) errors.push("Certifications changed.");
  before.experience.forEach((role, i) => {
    const now = after.experience[i];
    if (!now) return;
    for (const key of ["company", "location", "startDate", "endDate", "title"] as const) {
      if (role[key] !== now[key]) errors.push(`experience[${i}].${key} changed.`);
    }
    if (i >= editable && !same(role.descriptionLines, now.descriptionLines)) {
      errors.push(`Frozen role ${role.company} changed.`);
    }
  });
  return errors;
}
