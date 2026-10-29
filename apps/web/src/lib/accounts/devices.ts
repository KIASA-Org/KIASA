import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { deviceLockOn, siteClient, visitorAddress } from "./server";

/** Admins on their own devices only (supabase/migrations/20261029230000_admin_devices.sql).
 * An approved browser holds a secret in this cookie, which only the server
 * reads; the database keeps its hash. A password sign-in to an admin's account
 * on any other browser is refused and waits for approval from an approved one. */
export const DEVICE_COOKIE = "kiasa-device";
/** The longest a browser keeps a cookie (Chrome's limit); each sign-in renews it. */
const KEEP = 400 * 24 * 60 * 60;
/** Devices asking at once, at most; and how long one may ask. */
const ASKING_AT_MOST = 5;
const ASKING_DAYS = 7;

export type AdminDevice = { id: string; name: string; address: string | null; asked_at: string; approved_at: string | null; last_used_at: string | null };
/** How a sign-in went: on an approved device, the first device (none was approved
 * yet), asked for approval, the lock off (a local test copy, or before its SQL), or failed. */
export type Trust = "approved" | "first" | "asked" | "off" | "failed";

const hashOf = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** The session a Supabase access token belongs to. */
export function sessionOf(token: string | undefined): string | null {
  try {
    const claims = JSON.parse(Buffer.from((token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { session_id?: unknown };
    return typeof claims.session_id === "string" && /^[0-9a-f-]{36}$/.test(claims.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}

/** This browser's device, as its cookie says (not yet checked against the database). */
async function heldDevice(): Promise<{ id: string; secret: string } | null> {
  const [id, secret] = ((await cookies()).get(DEVICE_COOKIE)?.value ?? "").split(".");
  return id && secret && /^[0-9a-f-]{36}$/.test(id) && /^[\w-]{43}$/.test(secret) ? { id, secret } : null;
}

async function holdDevice(id: string, secret: string) {
  (await cookies()).set(DEVICE_COOKIE, `${id}.${secret}`, {
    path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: KEEP,
  });
}

/** "Chrome on Windows", from the browser's own description. */
function nameOf(agent: string) {
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /Firefox\//.test(agent) ? "Firefox"
    : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "A browser";
  const system = /Windows/.test(agent) ? "Windows" : /iPhone|iPad/.test(agent) ? "iPhone or iPad" : /Android/.test(agent) ? "Android"
    : /Mac OS X/.test(agent) ? "Mac" : /Linux/.test(agent) ? "Linux" : "a computer";
  return `${browser} on ${system}`;
}

/** A password sign-in to an admin's account, on this browser. Approved on an
 * approved device of theirs, or (when they have none yet) as their first;
 * otherwise this browser asks to be approved. Approved, the session is
 * recorded: the database grants admin powers to recorded sessions alone. */
export async function trustSignIn(userId: string, session: string | null): Promise<Trust> {
  if (!(await deviceLockOn())) return "off";
  const site = siteClient();
  const [held, { data: devices, error }, agent, address] = await Promise.all([
    heldDevice(),
    site.from("admin_devices").select("id, token_hash, approved_at, asked_at").eq("user_id", userId),
    headers().then(list => list.get("user-agent") ?? ""),
    visitorAddress(),
  ]);
  if (error) return "failed";
  const list = devices ?? [];
  const known = held ? list.find(device => device.id === held.id && device.token_hash === hashOf(held.secret)) : undefined;
  const trust: Trust = known?.approved_at ? "approved" : list.some(device => device.approved_at) ? "asked" : "first";
  const now = new Date().toISOString();
  const place = address.slice(0, 64);

  let deviceId: string;
  if (known && held) {
    deviceId = known.id;
    await site.from("admin_devices").update(trust === "asked" ? { asked_at: now, address: place } : { approved_at: known.approved_at ?? now, last_used_at: now, address: place }).eq("id", known.id);
    await holdDevice(known.id, held.secret);
  } else {
    const secret = randomBytes(32).toString("base64url");
    const made = await site.from("admin_devices").insert({
      user_id: userId, token_hash: hashOf(secret), name: nameOf(agent), address: place,
      approved_at: trust === "asked" ? null : now, last_used_at: trust === "asked" ? null : now,
    }).select("id").single();
    if (made.error || !made.data) return "failed";
    deviceId = made.data.id as string;
    await holdDevice(deviceId, secret);
  }

  if (trust === "asked") {
    // A few asking at a time, and not for long: the rest are let go.
    const { data: asking } = await site.from("admin_devices").select("id, asked_at").eq("user_id", userId).is("approved_at", null).order("asked_at", { ascending: false });
    const stale = Date.now() - ASKING_DAYS * 864e5;
    const gone = (asking ?? []).filter((device, index) => index >= ASKING_AT_MOST || Date.parse(device.asked_at as string) < stale).map(device => device.id as string);
    if (gone.length) await site.from("admin_devices").delete().in("id", gone);
    return "asked";
  }
  if (!session) return "failed";
  const kept = await site.from("admin_sessions").upsert({ session_id: session, user_id: userId, device_id: deviceId });
  return kept.error ? "failed" : trust;
}

/** An admin's devices (approved, and asking), and which one this browser is. */
export async function devicesOf(userId: string): Promise<{ on: boolean; devices: AdminDevice[]; here: string | null }> {
  const [on, held, { data }] = await Promise.all([
    deviceLockOn(),
    heldDevice(),
    siteClient().from("admin_devices").select("id, name, address, asked_at, approved_at, last_used_at, token_hash").eq("user_id", userId).order("asked_at"),
  ]);
  const rows = (data ?? []) as (AdminDevice & { token_hash: string })[];
  const here = held ? rows.find(row => row.id === held.id && row.token_hash === hashOf(held.secret))?.id ?? null : null;
  return { on, here, devices: rows.map(row => ({ id: row.id, name: row.name, address: row.address, asked_at: row.asked_at, approved_at: row.approved_at, last_used_at: row.last_used_at })) };
}

/** Which of this admin's devices this browser is, if any. */
export async function thisDevice(userId: string): Promise<string | null> {
  return (await devicesOf(userId)).here;
}
