import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciInit } from "undici";
import { reasons, type Account, type AccountStatus, type Reason } from "@/content/accounts";
import { photoUrl } from "./viewer";

// The server's calls to Supabase go over connections kept open a minute between
// pages. Node lets one go after four idle seconds, and far from Supabase a new
// one costs as long as the call itself, or longer (measured: 0.35 s a call kept,
// 0.8 to 2 s on a new one). (No form data passes this way: undici's own fetch
// would not know the global FormData.)
// One pool for the server's life: in development, where this file is run again
// after every change, too (it would otherwise start from no connections each time).
const shared = globalThis as typeof globalThis & { kiasaSupabasePool?: Agent };
const kept = (shared.kiasaSupabasePool ??= new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000 }));
const keptFetch = ((input: string, init?: UndiciInit) => undiciFetch(input, { ...init, dispatcher: kept })) as unknown as typeof fetch;

// Under the names Vercel's Supabase integration gives them, or the older ones.
const env = process.env;
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "";
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";

/** Accounts are real once Supabase's address and both its keys are set (see
 * `.env.example`). Until then the account pages show their sample design, and
 * the forms say that nothing was sent. */
export const accountsLive = Boolean(url && publicKey && secretKey);

/** What a browser needs to hear about changes: the project's address and its
 * publishable key, both public by design (what they allow is decided by the
 * database's rules). Handed to the page, so they need no special names. */
export const publicSupabase = { url, key: publicKey };

/** Supabase as the visitor: their session, read from and written to cookies. */
export async function visitorClient() {
  const store = await cookies();
  return createServerClient(url, publicKey, {
    global: { fetch: keptFetch },
    cookies: {
      getAll: () => store.getAll(),
      setAll: entries => {
        // A page cannot set cookies while it renders; the proxy (src/proxy.ts)
        // has refreshed the session before then. Server actions can set them.
        try {
          for (const { name, value, options } of entries) store.set(name, value, options);
        } catch {}
      },
    },
  });
}

/** Supabase as the site itself, for every write, made only after the site has
 * checked who is asking. Its key never leaves the server. */
export function siteClient() {
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: keptFetch } });
}

type ProfileRow = {
  id: string; email: string; name: string; organization: string | null; reason: string; digest: boolean;
  status: AccountStatus; asked_at: string; decided_at: string | null; last_sign_in_at: string | null;
};
export type Member = Account & { digest: boolean };

const toMember = (row: ProfileRow): Member => ({
  id: row.id,
  name: row.name,
  email: row.email,
  organization: row.organization ?? undefined,
  reason: (reasons as readonly string[]).includes(row.reason) ? (row.reason as Reason) : "Something else",
  asked: row.asked_at,
  status: row.status,
  decided: row.decided_at ?? undefined,
  lastSignIn: row.last_sign_in_at ?? undefined,
  digest: row.digest,
});

/** `photo`: the address of their profile photo, if they have set one. */
export type Viewer = { id: string; email: string; admin: { name: string } | null; member: Member | null; photo: string | null };

/** Who is signed in, as far as their sign-in itself says: its signature is
 * checked here, against Supabase's published key, rather than the cookie being
 * taken on trust, and without a round trip to Supabase. */
export const signedIn = cache(async (): Promise<{ id: string; email: string } | null> => {
  if (!accountsLive) return null;
  const { data } = await (await visitorClient()).auth.getClaims();
  const id = data?.claims.sub, email = data?.claims.email;
  return id && typeof email === "string" ? { id, email: email.toLowerCase() } : null;
});

/** Who is signed in; whether they are one of KIASA's admins; their request, if
 * any; and their photo. Asked once per request however many parts of the page need it. */
export const currentViewer = cache(async (): Promise<Viewer | null> => {
  const person = await signedIn();
  if (!person) return null;
  const { id, email } = person;
  const site = siteClient();
  const [admin, profile, avatar] = await Promise.all([
    site.from("admins").select("name").eq("email", email).maybeSingle(),
    site.from("profiles").select("*").eq("id", id).maybeSingle(),
    site.from("avatars").select("path").eq("user_id", id).maybeSingle(),
  ]);
  return {
    id,
    email,
    admin: admin.data ? { name: admin.data.name as string } : null,
    member: profile.data ? toMember(profile.data as ProfileRow) : null,
    photo: avatar.data ? photoUrl(url, avatar.data.path as string) : null,
  };
});

/** Everyone who has asked for an account, newest first. For the admin page only. */
export async function everyone(): Promise<Member[]> {
  const { data, error } = await siteClient().from("profiles").select("*").order("asked_at", { ascending: false });
  if (error) throw new Error(`The requests could not be read: ${error.message}`);
  return (data as ProfileRow[]).map(toMember);
}
