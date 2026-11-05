import { createClient } from "@supabase/supabase-js";
import { iceServers } from "@/lib/meetings/server";
import { accountsLive, publicSupabase } from "@/lib/accounts/server";

/** The KIASA Sound Desk (Windows app) and KIASA User Live Desk ask here for the relay and the
 * addresses that let two browsers find each other. Only people who have signed in to KIASA. */
export async function GET(request: Request) {
  if (!accountsLive) return Response.json({ ice: [] });
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "No token" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const client = createClient(publicSupabase.url, publicSupabase.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await client.auth.getUser(auth.slice(7));
  if (!user || error) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ ice: await iceServers() }, { headers: { "Cache-Control": "no-store" } });
}
