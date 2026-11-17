"use server";

import { accountsLive, signedIn } from "@/lib/accounts/server";
import { iceServers } from "@/lib/meetings/server";
import { approvedOrAdmin } from "@/lib/support/server";

/** How two browsers reach each other across networks, relay included, for a member
 * sharing their sound or an admin listening to it. Only for KIASA's own people.
 *
 * An admin by account, as the sound channel's rules ask (20261117170000_live_sounds_fix.sql)
 * and as the desks' /say/ice does: whether an admin's sign-in counts at all is the access
 * token hook's to decide (signedIn() takes only a token it let through). Asking the device
 * check again here gave such an admin no relay, only STUN, so the sound reached them only
 * on networks that let it through directly. */
export async function soundIce(): Promise<RTCIceServer[]> {
  if (!accountsLive) return [];
  const person = await signedIn();
  if (!person || !await approvedOrAdmin(person.id)) return [];
  return iceServers();
}
