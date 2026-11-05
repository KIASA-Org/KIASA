import { createClient } from "@supabase/supabase-js";
import { accountsLive, publicSupabase } from "@/lib/accounts/server";

const SOUND_DESK_VERSION = "1.0.0";
const SOUND_DESK_URL = "";

export async function GET(request: Request) {
  if (!accountsLive) return Response.json({ version: "0.0.0" });
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "No token" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const client = createClient(publicSupabase.url, publicSupabase.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await client.auth.getUser(auth.slice(7));
  if (!user || error) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ version: SOUND_DESK_VERSION, url: SOUND_DESK_URL }, { headers: { "Cache-Control": "no-store" } });
}
