/** KIASA Jobs, as the pages and the database share it. */

export type JobStatus = "applied" | "interview" | "offer" | "hired" | "rejected" | "skipped";
/** Each status as a member sees it, in the order a job goes through them. */
export const STATUS_LABELS: Record<JobStatus, string> = {
  applied: "Applied", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected", skipped: "Skipped",
};

/** Who is looking: a member applies to jobs; an admin posts them, plans and confirms. */
export type JobsMe = { id: string; name: string; admin: boolean; member: boolean; photo: string | null };
/** A member of the team, as everyone sees them. */
export type TeamPerson = { id: string; name: string; detail: string; photo: string | null };
export type JobSettings = { timezone: string | null; currency: string };

/** A job of the day, as `jobs_on` gives it: with this person's own status, and
 * how many on the team have applied to it. */
export type Job = {
  id: string; url: string; title: string | null; company: string | null; location: string | null; note: string | null;
  posted_at: string; posted_by: string | null;
  status: JobStatus | null; applied_at: string | null; resume_id: string | null; my_note: string | null;
  applied: number;
};
export type Application = {
  job_id: string; user_id: string; status: JobStatus; resume_id: string | null; note: string | null;
  applied_at: string | null; offered_at: string | null; updated_at: string;
};
export type JobLink = Pick<Job, "id" | "url" | "title" | "company" | "location" | "posted_at">;

export type Resume = {
  id: string; user_id: string; title: string; path: string; file_name: string; mime: string; size: number; is_default: boolean; created_at: string;
};
export type ResumeStats = { resume_id: string; applications: number; interviews: number; offers: number };

export type InterviewKind = "phone" | "video" | "onsite" | "technical" | "other";
export type InterviewOutcome = "scheduled" | "done" | "passed" | "failed" | "cancelled";
export type Interview = {
  id: string; user_id: string; job_id: string | null; company: string | null; title: string | null;
  starts_at: string; minutes: number; kind: InterviewKind; stage: string | null; place: string | null; note: string | null;
  outcome: InterviewOutcome; created_at: string;
  job?: Pick<Job, "title" | "company" | "url"> | null;
};

export type Decision = "pending" | "confirmed" | "declined";
/** A job a member won, with its monthly salary: counted once an admin confirms it. */
export type Position = {
  id: string; user_id: string; job_id: string | null; company: string; title: string; monthly_salary: number;
  started_on: string | null; ended_on: string | null; status: Decision; decided_by: string | null; decided_at: string | null; created_at: string;
};
/** Pay a member received: counted once an admin confirms it. */
export type Payment = {
  id: string; user_id: string; position_id: string | null; amount: number; paid_on: string; note: string | null;
  status: Decision; decided_by: string | null; decided_at: string | null; created_at: string;
};

export type Period = "day" | "week" | "month";
/** Targets an admin sets for a member, from a day, week or month on; the note is for that period only. */
export type Plan = {
  user_id: string; period: Period; starts_on: string; applications: number | null; interviews: number | null; offers: number | null;
  note: string | null; updated_at: string;
};

/** One member's totals, as `team_board` gives them to everyone on the team. */
export type BoardRow = {
  user_id: string; name: string;
  apps_day: number; apps_week: number; apps_month: number;
  interviews_day: number; interviews_week: number; interviews_month: number;
  offers_day: number; offers_week: number; offers_month: number;
  jobs_held: number; monthly_salary: number; paid_month: number; paid_total: number; last_applied_at: string | null;
};
export type TrendRow = { user_id: string; day: string; applications: number };
export type HourRow = { user_id: string; hour: number; applications: number };

/** What the page starts with, in one trip. */
export type JobsStart = {
  settings: JobSettings; today: string; jobs: Job[]; board: BoardRow[]; resumes: Resume[]; plans: Plan[]; team: TeamPerson[]; pending: number;
};

/** A computer running Job Saving Bot, which works down Jobright's list and posts the jobs it saves. */
export type BotState = "new" | "ready" | "busy" | "sign_in" | "setup" | "error";
export type JobBot = {
  id: string; name: string; computer: string | null; version: string | null; state: BotState; detail: string | null; seen_at: string | null;
  daily_cap: number; schedule_at: string | null; schedule_cards: number; schedule_days: number[]; created_at: string;
};
export type RunState = "waiting" | "running" | "done" | "stopped" | "failed" | "missed";
export type BotRun = {
  id: string; bot_id: string; cards: number; origin: "admin" | "schedule" | "computer"; asked_by: string | null; asked_at: string;
  state: RunState; stop_asked: boolean; saved: number; removed: number; skipped: number; failed: number; processed: number;
  message: string | null; started_at: string | null; ended_at: string | null;
};
export type BotStep = { id: number; run_id: string; at: string; level: "info" | "step" | "ok" | "warn" | "error"; text: string; job_id: string | null };
