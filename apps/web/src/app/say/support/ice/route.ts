import { json, nativeCaller, supportIce } from "@/lib/support/server";

/** The KIASA Sound Desk asks here for the relay of one support session it is part of:
 * GET /say/support/ice?session=<id> with its sign-in as a bearer token. Refused unless
 * the database says the caller is in that live session; counted per person. */
export async function GET(request: Request) {
  const caller = await nativeCaller(request);
  if (!caller) return json({ error: "Unauthorized" }, 401);
  const session = new URL(request.url).searchParams.get("session") ?? "";
  const answer = await supportIce(caller.client, caller.id, session);
  return json(answer.body, answer.status);
}
