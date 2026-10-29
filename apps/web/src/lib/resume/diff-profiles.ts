import type { Profile } from "./schema";
import { normalize } from "./text";

export interface RoleDiff {
  index: number;
  company: string;
  title: string;
  /** Lines that were in the role before and are gone (replaced) now. */
  removed: string[];
  /** Lines that are new or rewritten. */
  added: string[];
}

export interface SkillDiff {
  category: string;
  added: string[];
  removed: string[];
  isNew: boolean;
}

export interface ProfileDiff {
  title?: { before: string; after: string };
  summary?: { before: string; after: string };
  roles: RoleDiff[];
  skills: SkillDiff[];
  changed: boolean;
}

/** A plain before/after comparison for the review screen: what text changed, per role and per skills group. */
export function diffProfiles(before: Profile, after: Profile): ProfileDiff {
  const d: ProfileDiff = { roles: [], skills: [], changed: false };

  if (before.info.title !== after.info.title) d.title = { before: before.info.title, after: after.info.title };
  if (before.summary !== after.summary) d.summary = { before: before.summary, after: after.summary };

  const n = Math.max(before.experience.length, after.experience.length);
  for (let i = 0; i < n; i++) {
    const b = before.experience[i];
    const a = after.experience[i];
    const bl = b?.descriptionLines ?? [];
    const al = a?.descriptionLines ?? [];
    const removed = bl.filter((x) => !al.includes(x));
    const added = al.filter((x) => !bl.includes(x));
    if (removed.length || added.length) {
      const role = a ?? b;
      d.roles.push({ index: i, company: role.company, title: role.title, removed, added });
    }
  }

  const same = (x: string, y: string) => normalize(x) === normalize(y);
  const find = (list: Profile["skills"], name: string) => list.find((c) => same(c.category, name));
  for (const a of after.skills) {
    const b = find(before.skills, a.category);
    const was = b?.skills ?? [];
    const added = a.skills.filter((s) => !was.some((x) => same(x, s)));
    const removed = was.filter((s) => !a.skills.some((x) => same(x, s)));
    if (!b || added.length || removed.length) d.skills.push({ category: a.category, added, removed, isNew: !b });
  }
  for (const b of before.skills) {
    if (!find(after.skills, b.category)) d.skills.push({ category: b.category, added: [], removed: b.skills, isNew: false });
  }

  d.changed = Boolean(d.title || d.summary || d.roles.length || d.skills.length);
  return d;
}
