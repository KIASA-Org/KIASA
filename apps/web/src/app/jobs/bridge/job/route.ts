import { visitorClient } from "@/lib/accounts/server";
import { jobsViewer } from "@/lib/jobs/server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A job's link, for the KIASA ChatGPT Bridge to read its description off the
 * job's page in the member's own browser. The bridge asks here (as the member)
 * rather than taking a link from KIASA's page, so it only ever opens jobs that
 * are on KIASA's list, whatever a page asks of it. */
export async function GET(request: Request) {
  const me = await jobsViewer();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (!me?.member) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  if (!ID.test(id)) return Response.json({ error: "That job is not known." }, { status: 400, headers });
  const { data } = await (await visitorClient()).from("jobs").select("url").eq("id", id).maybeSingle();
  const url = typeof data?.url === "string" && /^https?:\/\//i.test(data.url) ? data.url : null;
  return url ? Response.json({ url }, { headers }) : Response.json({ error: "That job is no longer on the list." }, { status: 404, headers });
}
