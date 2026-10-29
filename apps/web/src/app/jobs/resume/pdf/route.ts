import { visitorClient } from "@/lib/accounts/server";
import { jobsViewer } from "@/lib/jobs/server";
import { ProfileSchema } from "@/lib/resume/schema";
import { attachmentHeader, pdfName, resumePdf } from "@/lib/resume/server";

// Printing a résumé takes a few seconds (a headless Chromium, on Node).
export const runtime = "nodejs";
export const maxDuration = 60;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const say = (text: string, status: number) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** A résumé as a PDF: `?job=<id>` the signed-in member's résumé made for that
 * job (an admin adds `&user=<id>` for a member's), or `?base=1` their base
 * résumé. `&inline=1` shows it instead of downloading it. The database's own
 * rules decide what each person may read. */
export async function GET(request: Request) {
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
  let pdf: Uint8Array<ArrayBuffer>;
  try {
    pdf = await resumePdf(parsed.data);
  } catch (error) {
    console.error("Résumé PDF failed:", error);
    return say("The PDF could not be made just now. Please try again in a minute.", 503);
  }
  const name = pdfName(parsed.data.info.name);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentHeader(name, asked.get("inline") === "1"),
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
