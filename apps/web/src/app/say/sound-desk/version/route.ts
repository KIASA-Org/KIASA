import { createClient } from "@supabase/supabase-js";
import { accountsLive, publicSupabase } from "@/lib/accounts/server";

const SOUND_DESK_VERSION = "1.1.1";
const SOUND_DESK_URL = "https://github.com/KIASA-Org/KIASA/releases/download/sound-desk-1.1.1/KiasaSoundDesk.exe";
// SHA-256 of the exe above. The app refuses to apply an update that does not match this,
// so a newer version is served only to builds that can verify exactly what they downloaded.
const SOUND_DESK_SHA256 = "d15bab4820dafce8879b24aeb9f6737e7d1b3a81246f0e404b08a9edcc7c36c8";

export async function GET(request: Request) {
  if (!accountsLive) return Response.json({ version: "0.0.0" });
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "No token" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const client = createClient(publicSupabase.url, publicSupabase.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await client.auth.getUser(auth.slice(7));
  if (!user || error) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ version: SOUND_DESK_VERSION, url: SOUND_DESK_URL, sha256: SOUND_DESK_SHA256 }, { headers: { "Cache-Control": "no-store" } });
}
