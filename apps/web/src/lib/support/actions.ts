"use server";

import { accountsLive, signedIn, visitorClient } from "@/lib/accounts/server";
import { supportIce } from "./server";

/** The relay for a support session, for the manager's page: only while the database says
 * this person is the session's manager (or member) and it is live; counted per person. */
export async function supportRelay(session: string): Promise<{ ice: RTCIceServer[]; ttl: number } | { error: string }> {
  if (!accountsLive) return { ice: [], ttl: 0 };
  const person = await signedIn();
  if (!person) return { error: "Please sign in again." };
  const answer = await supportIce(await visitorClient(), person.id, session);
  if (answer.status !== 200 || !("ice" in answer.body)) return { error: ("error" in answer.body && answer.body.error) || "Refused" };
  return answer.body as { ice: RTCIceServer[]; ttl: number };
}
