import { applyComprehensive, integrityErrors } from "./apply-comprehensive";
import { extractJson } from "./extract-json";
import { buildFixText } from "./job-record";
import type { Profile } from "./schema";
import { FIX_ROUNDS, PASS_SCORE, scoreLine, scoreResume, scoreSummary, type ResumeScore } from "./score";

/** What applying an answer did (the Resume Tailor App's report). `base`: no
 * description could be found (the job's page is only a form), so the job's
 * résumé is the member's base résumé as it is. `score`: its match score for
 * the job (none for the base résumé as it is, or with no description to score
 * against), and `rounds`: how many answers made it (the tailoring answer and
 * its fix rounds). */
export type TailorReport = {
  ok: boolean; applied: string[]; unmatched: string[]; rejected: string[]; warnings: string[]; errors: string[];
  base?: boolean; score?: ResumeScore; rounds?: number;
};
/** An answer applied: what it did, and, when the résumé scored under the pass
 * mark with fix rounds left, the text for the next one (ChatGPT's answer to it
 * is sent with the answers before it). */
export type TailorOutcome = { report: TailorReport; fix?: string };

/** The newest roles an answer may change (as the tailoring prompt says). */
const EDITABLE_ROLES = 2;
/** The longest answer taken: a whole résumé in JSON is far less. */
const LONGEST_ANSWER = 200_000;

export const failedReport = (error: string): TailorReport => ({ ok: false, applied: [], unmatched: [], rejected: [], warnings: [], errors: [error] });

/** The answers so far, in order (the tailoring answer, then each fix round's), or null. */
export function answersOf(input: unknown): string[] | null {
  const list = Array.isArray(input) ? input : [input];
  if (!list.length || list.length > 1 + FIX_ROUNDS || list.some(answer => typeof answer !== "string")) return null;
  return list.map(answer => String(answer).slice(0, LONGEST_ANSWER));
}

/** The answers applied to the base résumé one after another, and the result
 * scored against the job. At or over the pass mark it is the résumé; under it,
 * the text for a fix round while one is left (`fixPrompt`: the fix prompt);
 * after the last, rejected. A fix round's answer that cannot be used changes
 * nothing (and is said). With no description to score against, the résumé is
 * kept without a score. */
export function tailorRounds(
  base: Profile,
  answers: string[],
  job: { company: string; title: string; jd: string },
  fixPrompt: () => string,
): TailorOutcome & { profile?: Profile } {
  const first = extractJson(answers[0]);
  if (!first.ok) return { report: failedReport(first.error) };
  const result = applyComprehensive(base, first.value, { editableRoles: EDITABLE_ROLES });
  const report: TailorReport = { ok: result.ok, applied: result.applied, unmatched: result.unmatched, rejected: result.rejected, warnings: result.warnings, errors: result.errors };
  // An answer that could not be read, or that broke the résumé's facts, is not used.
  if (result.errors.length || !result.applied.length) return { report };
  let profile = result.profile;
  for (let round = 1; round < answers.length; round++) {
    const say = (line: string) => `Fix round ${round}: ${line}`;
    const found = extractJson(answers[round]);
    if (!found.ok) { report.warnings.push(say(`its answer could not be read (${found.error}), so nothing changed.`)); continue; }
    const fixed = applyComprehensive(profile, found.value, { editableRoles: EDITABLE_ROLES });
    if (fixed.errors.length) { report.warnings.push(say(`its answer was not used: ${fixed.errors.join(" ")}`)); continue; }
    profile = fixed.profile;
    report.applied.push(...fixed.applied.map(say));
    report.unmatched.push(...fixed.unmatched.map(say));
    report.rejected.push(...fixed.rejected.map(say));
    report.warnings.push(...fixed.warnings.map(say));
  }
  // The rounds together keep the base résumé's facts, as one answer must.
  report.errors.push(...integrityErrors(base, profile, EDITABLE_ROLES));
  report.ok = !report.errors.length && !report.unmatched.length && !report.rejected.length;
  if (report.errors.length) return { report };
  report.rounds = answers.length;
  if (job.jd.trim().length < 80) {
    report.warnings.push("There is no job description to score it against, so its match score was not checked.");
    return { profile, report };
  }
  const detail = scoreResume(profile, job);
  report.score = scoreSummary(detail);
  if (detail.pass) return { profile, report };
  if (answers.length <= FIX_ROUNDS) return { report, fix: buildFixText(fixPrompt(), job, profile, detail) };
  report.ok = false;
  report.errors.push(`Rejected: ${scoreLine(report.score)} It stayed under ${PASS_SCORE} after ${FIX_ROUNDS} fix rounds, so it is not kept and no PDF is made.`);
  return { report };
}
