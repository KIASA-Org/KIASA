"use server";

import { refresh } from "next/cache";
import { thisDevice } from "./devices";
import { currentViewer, siteClient } from "./server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ONLY = "Only an admin, on one of their approved devices, can do that.";

/** An admin approving a device of theirs that asked, from an approved one. It
 * signs in there again to use it. */
export async function approveDevice(id: string): Promise<{ error?: string }> {
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: ONLY };
  if (typeof id !== "string" || !ID.test(id)) return { error: "That device is not known." };
  const { data, error } = await siteClient().from("admin_devices").update({ approved_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", viewer.id).is("approved_at", null).select("id");
  if (error) return { error: "That did not work. Please try again." };
  if (!data?.length) return { error: "That device is no longer asking. Have it sign in again." };
  refresh();
  return {};
}

/** Refusing a device that asked, or removing an approved one: anyone signed in
 * there is signed out, and its admin powers end at once. Not the device in use. */
export async function forgetDevice(id: string): Promise<{ error?: string }> {
  const viewer = await currentViewer();
  if (!viewer?.admin) return { error: ONLY };
  if (typeof id !== "string" || !ID.test(id)) return { error: "That device is not known." };
  if ((await thisDevice(viewer.id)) === id) return { error: "This is the device you are using: it cannot remove itself." };
  const site = siteClient();
  const { data: device } = await site.from("admin_devices").select("id").eq("id", id).eq("user_id", viewer.id).maybeSingle();
  if (!device) return { error: "That device is already gone." };
  const { error } = await site.rpc("admin_device_forget", { device: id });
  if (error) return { error: "That did not work. Please try again." };
  refresh();
  return {};
}
