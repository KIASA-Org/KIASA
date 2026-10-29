"use server";

import { visitorClient } from "@/lib/accounts/server";
import { jobsViewer } from "@/lib/jobs/server";
import { applyComprehensive } from "./apply-comprehensive";
import { applyInit } from "./apply-init";
import { extractJson } from "./extract-json";
import { buildJobRecord, buildPasteText } from "./job-record";
import { tidyProfile, validateProfile } from "./profile-form";
import { ProfileSchema, type Profile } from "./schema";
import { prompt } from "./server";

/** What applying an answer did (the Resume Tailor App's report). */
export type TailorReport = { ok: boolean; applied: string[]; unmatched: string[]; rejected: string[]; warnings: string[]; errors: string[] };
export type BaseStatus = "typed" | "imported" | "generated";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ONLY = "Tailored résumés are for KIASA's members.";
/** The longest answer taken: a whole résumé in JSON is far less. */
const LONGEST_ANSWER = 200_000;

/** A member, signed in, with the database as them (its rules decide what they may touch). */
async function member() {
  const me = await jobsViewer();
  return me?.member ? { me, db: await visitorClient() } : null;
}

async function baseOf(db: Awaited<ReturnType<typeof visitorClient>>, id: string): Promise<Profile | null> {
  const { data } = await db.from("resume_profiles").select("profile").eq("user_id", id).maybeSingle();
  const parsed = ProfileSchema.safeParse(data?.profile);
  return parsed.success ? parsed.data : null;
}

/** Checks and tidies a profile from the editor: the problems, or the profile to keep. */
function checked(input: unknown): { profile: Profile } | { errors: string[] } {
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) return { errors: ["The résumé could not be read. Please try again."] };
  const profile = tidyProfile(parsed.data);
  const errors = validateProfile(profile);
  return errors.length ? { errors } : { profile };
}

/** The import prompt: for turning a résumé the member has (a PDF) into the base. */
export async function importPrompt(): Promise<string | null> {
  return (await member()) ? prompt("import") : null;
}

/** Keeps the member's base résumé (from the editor): typed, imported or generated. */
export async function saveBaseResume(input: unknown, status: BaseStatus): Promise<{ errors?: string[] }> {
  const who = await member();
  if (!who) return { errors: [ONLY] };
  const result = checked(input);
  if ("errors" in result) return result;
  const how: BaseStatus = status === "imported" || status === "generated" ? status : "typed";
  const { error } = await who.db.from("resume_profiles").upsert({ user_id: who.me.id, profile: result.profile, status: how });
  return error ? { errors: ["That did not save. Please try again."] } : {};
}

/** The text to paste into a new chat for one job: the tailoring prompt (or the
 * init prompt, to generate a whole base résumé), then the job and the member's
 * base résumé, with their email and phone left out. The job's description is
 * the one KIASA keeps, or `description` when the member pastes one. */
export async function textForJob(job: string, kind: "tailor" | "init", description?: string): Promise<{ text?: string; error?: string; needsDescription?: boolean; needsBase?: boolean }> {
  const who = await member();
  if (!who) return { error: ONLY };
  if (typeof job !== "string" || !ID.test(job)) return { error: "That job is not known." };
  const [{ data: posting }, base] = await Promise.all([
    who.db.from("jobs").select("url, title, company, description").eq("id", job).maybeSingle(),
    baseOf(who.db, who.me.id),
  ]);
  if (!posting) return { error: "That job is no longer on the list." };
  if (!base) return { needsBase: true, error: "First make your base résumé, once: every job's résumé is made from it." };
  const jd = (typeof description === "string" && description.trim() ? description : posting.description ?? "").trim().slice(0, 30000);
  if (jd.length < 80) return { needsDescription: true, error: "KIASA has no description for this job yet. Paste it from the job's page." };
  const record = buildJobRecord(
    { company: posting.company ?? "", title: posting.title ?? "", jd, link: posting.url, about: "" },
    base,
    kind === "init" ? { profileId: "master", templateId: "default" } : {},
  );
  return { text: buildPasteText(prompt(kind === "init" ? "init" : "tailor"), record) };
}

/** The chat's answer to the init prompt, checked against the base résumé sent:
 * every fact the model changed is put back; the result goes to the editor. */
export async function checkGenerated(answer: string): Promise<{ profile?: Profile; repairs: string[]; warnings: string[]; errors: string[] }> {
  const who = await member();
  if (!who) return { repairs: [], warnings: [], errors: [ONLY] };
  const base = await baseOf(who.db, who.me.id);
  if (!base) return { repairs: [], warnings: [], errors: ["Make your base résumé first."] };
  const found = extractJson(String(answer ?? "").slice(0, LONGEST_ANSWER));
  if (!found.ok) return { repairs: [], warnings: [], errors: [found.error] };
  const result = applyInit(base, found.value, { contact: { email: base.info.email, phone: base.info.phone } });
  return { profile: result.profile ?? undefined, repairs: result.repairs, warnings: result.warnings, errors: result.errors };
}

/** The chat's answer to the tailoring prompt for one job: its changes applied
 * to the member's base résumé, and kept as their résumé for that job. Not kept
 * when the answer could not be used at all. */
export async function tailorFromAnswer(job: string, answer: string): Promise<{ saved: boolean; report: TailorReport }> {
  const empty = (error: string): { saved: boolean; report: TailorReport } => ({ saved: false, report: { ok: false, applied: [], unmatched: [], rejected: [], warnings: [], errors: [error] } });
  const who = await member();
  if (!who) return empty(ONLY);
  if (typeof job !== "string" || !ID.test(job)) return empty("That job is not known.");
  const base = await baseOf(who.db, who.me.id);
  if (!base) return empty("Make your base résumé first.");
  const found = extractJson(String(answer ?? "").slice(0, LONGEST_ANSWER));
  if (!found.ok) return empty(found.error);
  const result = applyComprehensive(base, found.value);
  const report: TailorReport = { ok: result.ok, applied: result.applied, unmatched: result.unmatched, rejected: result.rejected, warnings: result.warnings, errors: result.errors };
  // An answer that could not be read, or that broke the résumé's facts, is not kept.
  if (result.errors.length || !result.applied.length) return { saved: false, report };
  const { error } = await who.db.from("tailored_resumes").upsert({ job_id: job, user_id: who.me.id, profile: result.profile, report, edited: false });
  if (error) return { saved: false, report: { ...report, errors: ["That did not save. Please try again."] } };
  return { saved: true, report };
}

/** A tailored résumé changed by hand in the editor. */
export async function saveTailored(job: string, input: unknown): Promise<{ errors?: string[] }> {
  const who = await member();
  if (!who) return { errors: [ONLY] };
  if (typeof job !== "string" || !ID.test(job)) return { errors: ["That job is not known."] };
  const result = checked(input);
  if ("errors" in result) return result;
  const { data, error } = await who.db.from("tailored_resumes").update({ profile: result.profile, edited: true })
    .eq("job_id", job).eq("user_id", who.me.id).select("job_id");
  return error || !data?.length ? { errors: ["That did not save. Please try again."] } : {};
}
