import type { Profile } from "./schema";
import { dedupe } from "./text";

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_BY_NAME: Record<string, string> = {};
for (const m of MONTHS) {
  MONTH_BY_NAME[m.toLowerCase()] = m;
  MONTH_BY_NAME[m.slice(0, 3).toLowerCase()] = m;
}
MONTH_BY_NAME.sept = "September";

/**
 * Normalizes a date to "Month YYYY", "YYYY" or "Present", the forms the prompts expect.
 * Reads "Jan 2021", "jan. 2021", "2021-01", "01/2021", "01/15/2021", "2021-01-15", "current".
 * Anything it cannot read is returned trimmed, for the validator to flag.
 */
export function normalizeDate(input: string): string {
  const t = input.trim().replace(/\s+/g, " ");
  if (!t) return "";
  if (/^(present|current|currently|now|ongoing|to date|till date|today)$/i.test(t)) return "Present";
  let m: RegExpExecArray | null;
  if ((m = /^([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(t))) {
    const mon = MONTH_BY_NAME[m[1].toLowerCase()];
    if (mon) return `${mon} ${m[2]}`;
  }
  if ((m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(t))) {
    const mon = MONTHS[Number(m[2]) - 1];
    if (mon) return `${mon} ${m[1]}`;
  }
  if ((m = /^(\d{1,2})[-/.](?:\d{1,2}[-/.])?(\d{4})$/.exec(t))) {
    const mon = MONTHS[Number(m[1]) - 1];
    if (mon) return `${mon} ${m[2]}`;
  }
  return t;
}

/** For schools and certifications: just the year, or "Present". */
export function normalizeYear(input: string): string {
  const d = normalizeDate(input);
  if (d === "" || d === "Present") return d;
  const m = /(\d{4})$/.exec(d);
  return m ? m[1] : d;
}

export const isYear = (s: string): boolean => /^\d{4}$/.test(s);
const MONTH_YEAR_RE = new RegExp(`^(${MONTHS.join("|")}) \\d{4}$`);
export const isMonthYear = (s: string): boolean => MONTH_YEAR_RE.test(s);

export function isValidDate(s: string, allowPresent = false): boolean {
  return isYear(s) || isMonthYear(s) || (allowPresent && s === "Present");
}

export function emptyProfile(): Profile {
  return {
    info: { name: "", title: "", location: "", email: "", phone: "", linkedin: "" },
    summary: "",
    skills: [],
    experience: [],
    certifications: [],
    education: [],
  };
}

/** One bullet per line; leading bullet characters are stripped. */
export function splitLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•·–—\-*]+/, "").trim())
    .filter(Boolean);
}

export function splitComma(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Trims every field, normalizes dates, and drops empty rows, bullets and skills. */
export function tidyProfile(p: Profile): Profile {
  const t = (s: string) => s.trim().replace(/\s+/g, " ");
  return {
    info: {
      name: t(p.info.name),
      title: t(p.info.title),
      location: t(p.info.location),
      email: t(p.info.email),
      phone: t(p.info.phone),
      linkedin: t(p.info.linkedin),
    },
    summary: p.summary.trim(),
    skills: p.skills
      .map((c) => ({ category: t(c.category), skills: dedupe(c.skills) }))
      .filter((c) => c.category || c.skills.length),
    experience: p.experience
      .map((e) => ({
        title: t(e.title),
        company: t(e.company),
        location: t(e.location),
        startDate: normalizeDate(e.startDate),
        endDate: normalizeDate(e.endDate),
        descriptionLines: e.descriptionLines.map(t).filter(Boolean),
      }))
      .filter((e) => e.company || e.title || e.location || e.startDate || e.endDate || e.descriptionLines.length),
    certifications: p.certifications
      .map((c) => ({ name: t(c.name), issuer: t(c.issuer), date: normalizeYear(c.date) }))
      .filter((c) => c.name || c.issuer || c.date),
    education: p.education
      .map((e) => ({
        degree: t(e.degree),
        major: t(e.major),
        school: t(e.school),
        startDate: normalizeYear(e.startDate),
        endDate: normalizeYear(e.endDate),
      }))
      .filter((e) => e.school || e.degree || e.major || e.startDate || e.endDate),
  };
}

/** Problems a person must fix before the profile can be saved as the master. Run tidyProfile first. */
export function validateProfile(p: Profile): string[] {
  const errors: string[] = [];
  if (!p.info.name) errors.push("Name is required.");
  if (p.info.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.info.email)) {
    errors.push(`Email "${p.info.email}" does not look like an email address.`);
  }
  if (p.experience.length === 0) errors.push("Add at least one role under Experience.");
  p.experience.forEach((e, i) => {
    const who = `Role ${i + 1}${e.company ? ` (${e.company})` : ""}`;
    if (!e.company) errors.push(`${who}: company is required.`);
    if (!e.startDate) errors.push(`${who}: start date is required.`);
    else if (!isValidDate(e.startDate)) errors.push(`${who}: start date "${e.startDate}" should look like "May 2021" or "2021".`);
    if (!e.endDate) errors.push(`${who}: end date is required ("Present" for a current job).`);
    else if (!isValidDate(e.endDate, true)) {
      errors.push(`${who}: end date "${e.endDate}" should look like "May 2021", "2021" or "Present".`);
    }
  });
  p.education.forEach((e, i) => {
    const who = `Education ${i + 1}${e.school ? ` (${e.school})` : ""}`;
    if (!e.school) errors.push(`${who}: school is required.`);
    if (!e.degree) errors.push(`${who}: degree is required.`);
    if (e.startDate && !isValidDate(e.startDate)) errors.push(`${who}: start date "${e.startDate}" should be a year like "2014".`);
    if (e.endDate && !isValidDate(e.endDate, true)) {
      errors.push(`${who}: end date "${e.endDate}" should be a year like "2018", or "Present".`);
    }
  });
  p.certifications.forEach((c, i) => {
    const who = `Certification ${i + 1}${c.name ? ` (${c.name})` : ""}`;
    if (!c.name) errors.push(`${who}: name is required.`);
    if (c.date && !isYear(c.date)) errors.push(`${who}: date "${c.date}" should be a year like "2022".`);
  });
  p.skills.forEach((c, i) => {
    if (!c.category) errors.push(`Skills group ${i + 1} needs a name.`);
  });
  return errors;
}

// ------------------------------------------------------------ form model
// The editor keeps bullets and skills as text so people can type freely.

export interface ExperienceForm {
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  /** One bullet per line. */
  bullets: string;
}

export interface SkillForm {
  category: string;
  /** Comma-separated. */
  skills: string;
}

export interface FormModel {
  info: Profile["info"];
  summary: string;
  skills: SkillForm[];
  experience: ExperienceForm[];
  certifications: Profile["certifications"];
  education: Profile["education"];
}

export function toForm(p: Profile): FormModel {
  return {
    info: { ...p.info },
    summary: p.summary,
    skills: p.skills.map((c) => ({ category: c.category, skills: c.skills.join(", ") })),
    experience: p.experience.map((e) => ({
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: e.descriptionLines.join("\n"),
    })),
    certifications: p.certifications.map((c) => ({ ...c })),
    education: p.education.map((e) => ({ ...e })),
  };
}

export function fromForm(f: FormModel): Profile {
  return {
    info: { ...f.info },
    summary: f.summary,
    skills: f.skills.map((c) => ({ category: c.category, skills: splitComma(c.skills) })),
    experience: f.experience.map((e) => ({
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      descriptionLines: splitLines(e.bullets),
    })),
    certifications: f.certifications.map((c) => ({ ...c })),
    education: f.education.map((e) => ({ ...e })),
  };
}
