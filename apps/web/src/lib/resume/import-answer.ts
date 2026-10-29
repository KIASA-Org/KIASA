import { extractJson } from "./extract-json";
import { splitLines, tidyProfile } from "./profile-form";
import { ProfileSchema, type Profile } from "./schema";

/**
 * The import prompt asks for the exact schema, but a chat answer may leave keys out,
 * use null, or put bullets in one string. This fills every gap with an empty value
 * so the result always matches the schema and the person can fix it on the edit screen.
 */
export function coerceProfile(input: unknown): Profile {
  const o = obj(input);
  const info = obj(o.info);

  const rawSkills = list(o.skills);
  const skills =
    rawSkills.length > 0 && rawSkills.every((x) => typeof x === "string")
      ? [{ category: "Skills", skills: rawSkills.map(str) }]
      : rawSkills.map((c) => {
          if (typeof c === "string") return { category: "Skills", skills: [c] };
          const x = obj(c);
          return { category: str(x.category ?? x.name) || "Skills", skills: strList(x.skills ?? x.items) };
        });

  return ProfileSchema.parse({
    info: {
      name: str(info.name),
      title: str(info.title ?? info.headline),
      location: str(info.location),
      email: str(info.email),
      phone: str(info.phone),
      linkedin: str(info.linkedin),
    },
    summary: str(o.summary),
    skills,
    experience: list(o.experience).map((e) => {
      const x = obj(e);
      return {
        title: str(x.title),
        company: str(x.company),
        startDate: str(x.startDate),
        endDate: str(x.endDate),
        location: str(x.location),
        descriptionLines: strList(x.descriptionLines ?? x.description ?? x.bullets),
      };
    }),
    certifications: list(o.certifications).map((c) => {
      const x = obj(c);
      return { name: str(x.name), issuer: str(x.issuer), date: str(x.date ?? x.year) };
    }),
    education: list(o.education).map((e) => {
      const x = obj(e);
      return {
        degree: str(x.degree),
        major: str(x.major ?? x.field),
        school: str(x.school ?? x.institution),
        startDate: str(x.startDate),
        endDate: str(x.endDate),
      };
    }),
  });
}

export type ImportResult =
  | { ok: true; profile: Profile; warnings: string[] }
  | { ok: false; error: string };

/** Turns a pasted chat answer into a tidy profile, with warnings about what is missing. */
export function parseImportedProfile(text: string): ImportResult {
  const extracted = extractJson(text);
  if (!extracted.ok) return { ok: false, error: extracted.error };

  let raw: Record<string, unknown> = extracted.value;
  if ("profile" in raw && !("info" in raw)) raw = obj(raw.profile);

  const profile = tidyProfile(coerceProfile(raw));
  const warnings: string[] = [];
  if (!profile.info.name) warnings.push("No name was found.");
  if (!profile.info.email) warnings.push("No email was found.");
  if (!profile.info.phone) warnings.push("No phone number was found.");
  if (!profile.info.linkedin) warnings.push("No LinkedIn link was found.");
  if (profile.experience.length === 0) warnings.push("No work experience was found.");
  if (profile.education.length === 0) warnings.push("No education was found.");
  if (profile.skills.length === 0) warnings.push("No skills were found.");
  return { ok: true, profile, warnings };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str);
  if (typeof v === "string") return splitLines(v);
  return [];
}
