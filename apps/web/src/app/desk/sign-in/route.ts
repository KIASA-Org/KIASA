import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { sessionOf, trustSignIn } from "@/lib/accounts/devices";
import { accountsLive, noteAttempt, publicSupabase, siteClient, tooMany, visitorAddress } from "@/lib/accounts/server";

const TOO_MANY = "Too many tries. Please wait 15 minutes, then try again.";
const RETRY = "That did not work just now. Please try again in a minute.";
const ASKED = "This computer has asked to be added. In your browser, open Admin, approve KIASA Live Desk under Your devices, then sign in here again.";

const answer = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** KIASA Live Desk, the admins' Windows app, signs in here. It is the site's own sign-in for an
 * admin: the same limits on tries, and the same rule that an admin's account works only on its
 * approved devices, the app being one (it keeps the device cookie as a browser would). What it
 * gets is a sign-in of its own, recorded like a browser's; from there on it talks to Supabase. */
export async function POST(request: Request) {
  if (!accountsLive) return answer({ error: RETRY }, 503);
  const sent = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = String(sent?.email ?? "").trim().slice(0, 254).toLowerCase();
  const password = String(sent?.password ?? "").slice(0, 200);
  if (!email || !password) return answer({ error: "Please give your email and password." }, 400);

  // The same counts as the site's sign-in page: having two ways in gives no more guesses.
  const from = await visitorAddress();
  const [busy, guessing] = await Promise.all([tooMany("sign-in", from, 15, 30), tooMany("sign-in-wrong", `${from} ${email}`, 15, 8)]);
  if (busy || guessing) return answer({ error: TOO_MANY }, 429);
  after(() => noteAttempt("sign-in", from));

  // Not the visitor's cookies: the app holds its own sign-in, and this answer carries it.
  const visitor = createClient(publicSupabase.url, publicSupabase.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await visitor.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) {
    await noteAttempt("sign-in-wrong", `${from} ${email}`);
    return answer({ error: "That email and password do not match an account." }, 401);
  }

  const admin = await siteClient().from("admins").select("name").eq("user_id", data.user.id).maybeSingle();
  if (!admin.data) {
    await visitor.auth.signOut({ scope: "local" });
    return answer({ error: "KIASA Live Desk is for KIASA's admins." }, 403);
  }

  const trust = await trustSignIn(data.user.id, sessionOf(data.session.access_token));
  if (trust === "asked" || trust === "failed") {
    await visitor.auth.signOut({ scope: "local" });
    return trust === "asked" ? answer({ error: ASKED, asked: true }, 403) : answer({ error: RETRY }, 503);
  }
  // The token is made again, now that this sign-in is approved (the database's access token hook).
  let session = data.session;
  if (trust !== "off") {
    const again = await visitor.auth.refreshSession();
    if (again.error || !again.data.session) return answer({ error: RETRY }, 503);
    session = again.data.session;
  }
  return answer({
    url: publicSupabase.url,
    key: publicSupabase.key,
    id: data.user.id,
    name: admin.data.name,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
}
