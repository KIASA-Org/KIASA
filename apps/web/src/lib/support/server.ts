import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { accountsLive, noteAttempt, publicSupabase, siteClient, tooMany } from "@/lib/accounts/server";
import { iceServers } from "@/lib/meetings/server";

/** Relay passwords for a support session last two hours: a reconnect, or a session that
 * goes on longer, asks again (the app and the page both do). Cloudflare's relay keeps a
 * password working until it expires: ending a session stops both ends' media at once, but
 * a password already handed out is not cancelled early. */
export const SUPPORT_ICE_TTL = 7_200;
/** Relay requests a person may make in an hour, all sessions together. */
const ICE_PER_HOUR = 60;

const noStore = { "Cache-Control": "no-store" };

/** Who sent this request from a KIASA Windows app (a bearer token), and a database
 * client that acts as them, so the database's own rules decide. Null if no one. */
export async function nativeCaller(request: Request): Promise<{ id: string; client: SupabaseClient } | null> {
  const auth = request.headers.get("authorization");
  if (!accountsLive || !auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const client = createClient(publicSupabase.url, publicSupabase.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (!user || error) return null;
  return { id: user.id, client };
}

/** An approved member, or an admin: the only people who may use KIASA's relay. */
export async function approvedOrAdmin(id: string): Promise<boolean> {
  const site = siteClient();
  const [admin, profile] = await Promise.all([
    site.from("admins").select("user_id").eq("user_id", id).maybeSingle(),
    site.from("profiles").select("status").eq("id", id).maybeSingle(),
  ]);
  return !!admin.data || profile.data?.status === "approved";
}

/** Counted relay requests: false once a person has asked too often this hour. */
export async function relayAllowance(id: string): Promise<boolean> {
  if (await tooMany("relay", id, 60, ICE_PER_HOUR)) return false;
  await noteAttempt("relay", id);
  return true;
}

/** The relay for one support session, if the database says this person is in it and it is live. */
export async function supportIce(client: SupabaseClient, id: string, session: string) {
  if (!/^[0-9a-f-]{36}$/.test(session)) return { status: 400, body: { error: "No session" } };
  const { data: ok, error } = await client.rpc("support_relay_ok", { session });
  if (error || ok !== true) return { status: 403, body: { error: "Not in this session" } };
  if (!await relayAllowance(id)) return { status: 429, body: { error: "Too many requests" } };
  return { status: 200, body: { ice: await iceServers(SUPPORT_ICE_TTL), ttl: SUPPORT_ICE_TTL } };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** Names of the people in this viewer's own sessions only. */
export async function sessionNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const site = siteClient();
  const [profiles, admins] = await Promise.all([
    site.from("profiles").select("id, name").in("id", ids),
    site.from("admins").select("user_id, name").in("user_id", ids),
  ]);
  return Object.fromEntries([
    ...(profiles.data ?? []).map(row => [row.id as string, row.name as string]),
    ...(admins.data ?? []).map(row => [row.user_id as string, row.name as string]),
  ]);
}
