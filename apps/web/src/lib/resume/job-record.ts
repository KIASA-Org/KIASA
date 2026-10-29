import { JobPostingSchema, JobRecordSchema, type JobPosting, type JobRecord, type Profile } from "./schema";

export interface BuildJobRecordOptions {
  profileId?: string;
  templateId?: string;
  /** Keep email and phone in the copy. Default false: they are blanked before anything is pasted into a chat. */
  keepContact?: boolean;
}

/** A copy of the profile with email and phone blanked: what is sent to a chat. */
export function blankContact(profile: Profile): Profile {
  const copy = structuredClone(profile);
  copy.info.email = "";
  copy.info.phone = "";
  return copy;
}

/** Builds the JSON object the user pastes after the prompt. The stored profile is not modified. */
export function buildJobRecord(posting: JobPosting, profile: Profile, opts: BuildJobRecordOptions = {}): JobRecord {
  const p = JobPostingSchema.parse(posting);
  const copy = opts.keepContact ? structuredClone(profile) : blankContact(profile);
  const record: JobRecord = { ...p, profile: copy };
  if (opts.profileId) record.profileId = opts.profileId;
  if (opts.templateId) record.templateId = opts.templateId;
  return JobRecordSchema.parse(record);
}

/** The full text to paste into a new chat: the prompt first, then the job record in a json code block. */
export function buildPasteText(promptText: string, record: JobRecord): string {
  return `${promptText.trimEnd()}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

/** Puts the real email and phone back after a paste-back. */
export function restoreContact(profile: Profile, contact: { email: string; phone: string }): Profile {
  const copy = structuredClone(profile);
  copy.info.email = contact.email;
  copy.info.phone = contact.phone;
  return copy;
}
