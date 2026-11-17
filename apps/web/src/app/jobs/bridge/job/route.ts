import { visitorClient } from "@/lib/accounts/server";
import { jobsViewer } from "@/lib/jobs/server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A web page on a named site: never an address on the member's computer or
 * network, nor a link carrying a password (the bridge opens it in their browser). */
function publicPage(url: string) {
  let address: URL;
  try { address = new URL(url); } catch { return false; }
  if ((address.protocol !== "https:" && address.protocol !== "http:") || address.username || address.password) return false;
  const host = address.hostname.toLowerCase();
  return /^([a-z0-9-]+\.)+[a-z][a-z0-9-]+$/.test(host) && !/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host);
}

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
  const url = typeof data?.url === "string" && publicPage(data.url) ? data.url : null;
  return url ? Response.json({ url }, { headers }) : Response.json({ error: "That job is no longer on the list." }, { status: 404, headers });
}
