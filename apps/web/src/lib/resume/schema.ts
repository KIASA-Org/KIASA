import { z } from "zod";

const str = z.string();

export const InfoSchema = z.object({
  name: str,
  title: str,
  location: str,
  email: str,
  phone: str,
  linkedin: str,
});

export const SkillCategorySchema = z.object({
  category: str,
  skills: z.array(str),
});

export const ExperienceSchema = z.object({
  title: str,
  company: str,
  startDate: str,
  endDate: str,
  location: str,
  descriptionLines: z.array(str),
});

export const CertificationSchema = z.object({
  name: str,
  issuer: str,
  date: str,
});

export const EducationSchema = z.object({
  degree: str,
  major: str,
  school: str,
  startDate: str,
  endDate: str,
});

/** The profile object every prompt reads and the init prompt returns. Unknown keys are dropped. */
export const ProfileSchema = z.object({
  info: InfoSchema,
  summary: str,
  skills: z.array(SkillCategorySchema),
  experience: z.array(ExperienceSchema),
  certifications: z.array(CertificationSchema),
  education: z.array(EducationSchema),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

/** The five posting fields the user captures for each job. */
export const JobPostingSchema = z.object({
  company: str,
  title: str,
  jd: str,
  link: str.default(""),
  about: str.default(""),
});
export type JobPosting = z.input<typeof JobPostingSchema>;

/** The payload both prompts take as the user message (the init prompt's input contract). */
export const JobRecordSchema = JobPostingSchema.extend({
  profileId: str.optional(),
  templateId: str.optional(),
  profile: ProfileSchema,
});
export type JobRecord = z.output<typeof JobRecordSchema>;

/** The change list the comprehensive prompt returns. Every section is optional. */
const TextPair = z.object({ original: str, updated: str });

const ExpRewrite = z.object({
  original: z.object({ title: str.optional(), company: str.optional(), description: str }),
  updated: z.object({ title: str.optional(), company: str.optional(), description: str }),
});

const SkillRewrite = z.object({ original: z.array(str), updated: z.array(str) });

const ExpAdd = z.object({
  target: z
    .object({ title: str.optional(), company: str.optional() })
    .refine((t) => Boolean(t.title?.trim() || t.company?.trim()), {
      message: "target needs a title or a company",
    }),
  descriptionLines: z.array(str).min(1),
  // The prompt's template shows a placeholder string here, so accept a number, a string or null.
  insertAfterIndex: z.union([z.number(), z.string(), z.null()]).optional(),
});

const SkillsAdd = z.object({ category: str, skills: z.array(str).min(1) });

export const ComprehensiveAnswerSchema = z.object({
  info: z.object({ original: z.object({ title: str }), updated: z.object({ title: str }) }).optional(),
  summary: TextPair.optional(),
  exp: z.array(ExpRewrite).optional(),
  skills: z.record(str, SkillRewrite).optional(),
  exp_add: z.array(ExpAdd).optional(),
  skills_add: z.array(SkillsAdd).optional(),
});
export type ComprehensiveAnswer = z.infer<typeof ComprehensiveAnswerSchema>;

export function describeIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string[] {
  return issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
}
