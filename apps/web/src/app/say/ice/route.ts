import { iceServers } from "@/lib/meetings/server";
import { accountsLive } from "@/lib/accounts/server";
import { approvedOrAdmin, json, nativeCaller, relayAllowance } from "@/lib/support/server";

/** The KIASA Sound Desk (Windows app) and KIASA User Live Desk ask here for the relay and the
 * addresses that let two computers find each other. Only approved members and admins
 * (a new, unapproved sign-up gets 403), and only so often (429): KIASA-012. */
export async function GET(request: Request) {
  if (!accountsLive) return json({ ice: [] });
  const caller = await nativeCaller(request);
  if (!caller) return json({ error: "Unauthorized" }, 401);
  if (!await approvedOrAdmin(caller.id)) return json({ error: "Not approved" }, 403);
  if (!await relayAllowance(caller.id)) return json({ error: "Too many requests" }, 429);
  return json({ ice: await iceServers() });
}
