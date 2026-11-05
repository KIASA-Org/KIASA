import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { sessionOf, trustSignIn } from "@/lib/accounts/devices";
import { accountsLive, noteAttempt, publicSupabase, siteClient, tooMany, visitorAddress } from "@/lib/accounts/server";

const TOO_MANY = "Too many tries. Please wait 15 minutes, then try again.";
const RETRY = "That did not work just now. Please try again in a minute.";
const ASKED = "This computer has asked to be added. In your browser, open Admin, approve KIASA Say under Your devices, then sign in here again.";

const answer = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** KIASA Say and KIASA Meeting Text, the two Windows apps for typing to a meeting live, sign in here.
 * It is the site's own sign-in with the same limits on tries. An admin (who types) works only on an
 * approved device, as on the site: the app keeps the device cookie as a browser would. A member (who
 * reads) must be approved. What the app gets is a sign-in of its own; from there it talks to Supabase,
 * and the database decides which meetings it may hear. */
export async function POST(request: Request) {
  if (!accountsLive) return answer({ error: RETRY }, 503);
  const sent = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = String(sent?.email ?? "").trim().slice(0, 254).toLowerCase();
  const password = String(sent?.password ?? "").slice(0, 200);
  if (!email || !password) return answer({ error: "Please give your email and password." }, 400);

  // The same counts as the site's sign-in page: having more ways in gives no more guesses.
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

  const site = siteClient();
  const [admin, profile] = await Promise.all([
    site.from("admins").select("name").eq("user_id", data.user.id).maybeSingle(),
    site.from("profiles").select("name, status").eq("id", data.user.id).maybeSingle(),
  ]);
  if (!admin.data && profile.data?.status !== "approved") {
    await visitor.auth.signOut({ scope: "local" });
    return answer({ error: profile.data ? "Your KIASA account has not been approved yet." : "That email and password do not match an account." }, 403);
  }

  // The token is made again, now that this sign-in is approved (the database's access token hook).
  let session = data.session;
  if (admin.data) {
    const trust = await trustSignIn(data.user.id, sessionOf(data.session.access_token));
    if (trust === "asked" || trust === "failed") {
      await visitor.auth.signOut({ scope: "local" });
      return trust === "asked" ? answer({ error: ASKED, asked: true }, 403) : answer({ error: RETRY }, 503);
    }
    if (trust !== "off") {
      const again = await visitor.auth.refreshSession();
      if (again.error || !again.data.session) return answer({ error: RETRY }, 503);
      session = again.data.session;
    }
  }
  return answer({
    url: publicSupabase.url,
    key: publicSupabase.key,
    id: data.user.id,
    name: (admin.data?.name ?? profile.data?.name) as string,
    admin: !!admin.data,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
}
