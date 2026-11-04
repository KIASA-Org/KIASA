import { createHash } from "node:crypto";
import { noteAttempt, siteClient, tooMany, visitorClient } from "@/lib/accounts/server";
import { jobsViewer } from "@/lib/jobs/server";
import { ProfileSchema, type Profile } from "@/lib/resume/schema";
import { attachmentHeader, pdfName, resumePdf } from "@/lib/resume/server";

// Printing a résumé takes a few seconds (a headless Chromium, on Node).
export const runtime = "nodejs";
export const maxDuration = 60;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The largest résumé taken to print: a whole one in JSON is far less. */
const LARGEST = 400_000;
const say = (text: string, status: number) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** How many résumés a KIASA Browser may have printed in an hour: well above the
 * pace of a working day, and low enough that a lost key cannot run up the bill. */
const AGENT_HOURLY = 120;

/** A KIASA Browser has no sign-in, only its key: it gets the résumé made for a job
 * its own member is applying to, and nothing else. */
async function forBrowser(key: string, job: string | null) {
  if (!job || !ID.test(job)) return say("That résumé is not known.", 400);
  const site = siteClient();
  const found = await site.rpc("browser_agent_resume", { agent_key: key, job });
  if (found.error) return say("This browser is not connected to KIASA.", 401);
  const parsed = ProfileSchema.safeParse(found.data);
  if (!parsed.success) return say("There is no résumé made for this job yet.", 404);
  const who = createHash("sha256").update(key).digest("hex").slice(0, 32);
  if (await tooMany("agent-resume", who, 60, AGENT_HOURLY)) return say("Too many résumés this hour. Please try again later.", 429);
  await noteAttempt("agent-resume", who);
  return printed(parsed.data, false);
}

/** Prints it, or says it could not. */
async function printed(profile: Profile, inline: boolean) {
  let pdf: Uint8Array<ArrayBuffer>;
  try {
    pdf = await resumePdf(profile);
  } catch (error) {
    console.error("Résumé PDF failed:", error);
    return say("The PDF could not be made just now. Please try again in a minute.", 503);
  }
  const name = pdfName(profile.info.name);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentHeader(name, inline),
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

/** A résumé as a PDF: `?job=<id>` the signed-in member's résumé made for that
 * job (an admin adds `&user=<id>` for a member's), or `?base=1` their base
 * résumé. `&inline=1` shows it instead of downloading it. The database's own
 * rules decide what each person may read. */
export async function GET(request: Request) {
  const agentKey = request.headers.get("authorization")?.match(/^Bearer (kapp_[a-z0-9]{40,120})$/)?.[1];
  if (agentKey) return forBrowser(agentKey, new URL(request.url).searchParams.get("job"));
  const me = await jobsViewer();
  if (!me) return say("Please sign in.", 401);
  const asked = new URL(request.url).searchParams;
  const job = asked.get("job");
  const user = asked.get("user") && me.admin ? asked.get("user")! : me.id;
  if ((job && !ID.test(job)) || !ID.test(user)) return say("That résumé is not known.", 400);
  const db = await visitorClient();
  const found = job
    ? await db.from("tailored_resumes").select("profile").eq("job_id", job).eq("user_id", user).maybeSingle()
    : await db.from("resume_profiles").select("profile").eq("user_id", user).maybeSingle();
  const parsed = ProfileSchema.safeParse(found.data?.profile);
  if (!parsed.success) return say(job ? "There is no résumé made for this job yet." : "There is no base résumé yet.", 404);
  return printed(parsed.data, asked.get("inline") === "1");
}

/** A résumé not kept on KIASA (tailored for a job not on its list), sent as
 * `{ profile }`, printed for the signed-in member and given back as a PDF. */
export async function POST(request: Request) {
  const me = await jobsViewer();
  if (!me?.member) return say("Please sign in.", 401);
  const body = await request.text().catch(() => "");
  if (!body || body.length > LARGEST) return say("That résumé could not be read.", 400);
  let sent: unknown;
  try { sent = (JSON.parse(body) as { profile?: unknown }).profile; } catch { return say("That résumé could not be read.", 400); }
  const parsed = ProfileSchema.safeParse(sent);
  if (!parsed.success) return say("That résumé could not be read.", 400);
  return printed(parsed.data, false);
}
