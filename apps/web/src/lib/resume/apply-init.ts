import { ProfileSchema, describeIssues, type Profile } from "./schema";
import { sameText, wordCount } from "./text";

export interface ApplyInitOptions {
  /** Real email and phone from storage; the copy sent to the chat had them blanked. Defaults to the values in `sent`. */
  contact?: { email: string; phone: string };
  minBulletWords?: number;
}

export interface ApplyInitResult {
  ok: boolean;
  /** The generated profile with every fact forced back to the input. Null when the structure is wrong. */
  profile: Profile | null;
  errors: string[];
  /** Facts the model changed and the app restored. */
  repairs: string[];
  /** Things a person should look at before saving. */
  warnings: string[];
}

const eq = (a: string, b: string) => a.trim() === b.trim();

/**
 * Applies an init-prompt answer: the answer replaces the whole profile, but every
 * immutable fact (identity, employers, dates, schools, degrees, entry counts) is
 * checked against what was sent and restored when the model changed it.
 */
export function applyInit(sent: Profile, answer: unknown, opts: ApplyInitOptions = {}): ApplyInitResult {
  const minWords = opts.minBulletWords ?? 25;
  const errors: string[] = [];
  const repairs: string[] = [];
  const warnings: string[] = [];

  // Some models return the whole job record instead of just the profile.
  let candidate: unknown = answer;
  if (candidate && typeof candidate === "object" && "profile" in candidate && !("info" in candidate)) {
    candidate = (candidate as { profile: unknown }).profile;
  }

  const parsed = ProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      profile: null,
      errors: ["The answer does not match the profile structure.", ...describeIssues(parsed.error.issues)],
      repairs,
      warnings,
    };
  }
  const out = parsed.data;

  if (out.experience.length !== sent.experience.length) {
    errors.push(`Experience count changed: sent ${sent.experience.length} roles, got ${out.experience.length}.`);
  }
  if (out.education.length !== sent.education.length) {
    errors.push(`Education count changed: sent ${sent.education.length} entries, got ${out.education.length}.`);
  }
  if (errors.length) return { ok: false, profile: null, errors, repairs, warnings };

  // Identity
  for (const key of ["name", "location"] as const) {
    if (!eq(out.info[key], sent.info[key])) {
      repairs.push(`info.${key}: "${out.info[key]}" restored to "${sent.info[key]}".`);
      out.info[key] = sent.info[key];
    }
  }
  if (sent.info.linkedin.trim()) {
    if (!eq(out.info.linkedin, sent.info.linkedin)) {
      repairs.push(`info.linkedin: "${out.info.linkedin}" restored to "${sent.info.linkedin}".`);
      out.info.linkedin = sent.info.linkedin;
    }
  } else if (out.info.linkedin.trim()) {
    repairs.push(`info.linkedin: the model invented "${out.info.linkedin}"; removed.`);
    out.info.linkedin = "";
  }
  const contact = opts.contact ?? { email: sent.info.email, phone: sent.info.phone };
  out.info.email = contact.email;
  out.info.phone = contact.phone;

  // Employers and dates
  out.experience.forEach((role, i) => {
    const s = sent.experience[i];
    for (const key of ["company", "location", "startDate", "endDate"] as const) {
      if (!eq(role[key], s[key])) {
        repairs.push(`experience[${i}].${key}: "${role[key]}" restored to "${s[key]}".`);
        role[key] = s[key];
      }
    }
    if (s.title.trim() && !eq(role.title, s.title)) {
      warnings.push(
        `Job title at ${s.company}: "${s.title}" became "${role.title}". Restore the real title if a background check would verify it.`,
      );
    }
    if (role.descriptionLines.length === 0) warnings.push(`No bullets were written for ${s.company}.`);
    role.descriptionLines.forEach((b, j) => {
      const n = wordCount(b);
      if (n < minWords) warnings.push(`${s.company} bullet ${j + 1} has ${n} words (minimum ${minWords}).`);
    });
  });

  // Schools and degrees
  out.education.forEach((edu, i) => {
    const s = sent.education[i];
    for (const key of ["degree", "school", "startDate", "endDate"] as const) {
      if (!eq(edu[key], s[key])) {
        repairs.push(`education[${i}].${key}: "${edu[key]}" restored to "${s[key]}".`);
        edu[key] = s[key];
      }
    }
  });

  // Things to review
  if (!out.summary.trim()) warnings.push("The summary is empty.");
  if (out.skills.length === 0) warnings.push("The skills list is empty.");
  const added = out.certifications.filter((c) => !sent.certifications.some((s) => sameText(s.name, c.name)));
  const dropped = sent.certifications.filter((s) => !out.certifications.some((c) => sameText(c.name, s.name)));
  if (added.length) {
    warnings.push(
      `The model added ${added.length} certification(s): ${added.map((c) => c.name).join(", ")}. Delete any the user does not hold.`,
    );
  }
  if (dropped.length) {
    warnings.push(`The model dropped ${dropped.length} certification(s) from the input: ${dropped.map((c) => c.name).join(", ")}.`);
  }
  out.certifications.forEach((c, i) => {
    if (!/^\d{4}$/.test(c.date.trim())) warnings.push(`certifications[${i}] date "${c.date}" is not a 4-digit year.`);
  });

  return { ok: true, profile: out, errors, repairs, warnings };
}
