"use server";

import { accountsLive, currentViewer } from "@/lib/accounts/server";
import { iceServers } from "@/lib/meetings/server";

/** How two browsers reach each other across networks, relay included, for a member
 * sharing their sound or an admin listening to it. Only for KIASA's own people. */
export async function soundIce(): Promise<RTCIceServer[]> {
  if (!accountsLive) return [];
  const viewer = await currentViewer();
  if (!viewer || !(viewer.admin || viewer.member?.status === "approved")) return [];
  return iceServers();
}
