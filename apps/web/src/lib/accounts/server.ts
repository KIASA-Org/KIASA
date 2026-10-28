import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciInit } from "undici";
import { reasons, type Account, type AccountStatus, type Reason } from "@/content/accounts";
import { markOf, photoUrl, type Mark, type Ranks, type Team } from "./viewer";

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

/** `photo`: the address of their profile photo, if they have set one; `top`: an admin has made them a top manager. */
export type Viewer = { id: string; email: string; admin: { name: string } | null; member: Member | null; photo: string | null; top: boolean; mark: Mark | null };

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
  const [admin, profile, avatar, top, team] = await Promise.all([
    site.from("admins").select("name").eq("email", email).maybeSingle(),
    site.from("profiles").select("*").eq("id", id).maybeSingle(),
    site.from("avatars").select("path").eq("user_id", id).maybeSingle(),
    site.from("top_managers").select("user_id").eq("user_id", id).maybeSingle(),
    site.from("team_members").select("team_id, teams(id, name, color)").eq("user_id", id).maybeSingle(),
  ]);
  const teamOf = (team.data?.teams ?? null) as Team | null;
  return {
    id,
    email,
    admin: admin.data ? { name: admin.data.name as string } : null,
    member: profile.data ? toMember(profile.data as ProfileRow) : null,
    photo: avatar.data ? photoUrl(url, avatar.data.path as string) : null,
    top: !!top.data,
    mark: markOf({ owners: admin.data ? [id] : [], top: top.data ? [id] : [], teams: teamOf ? [teamOf] : [], placed: teamOf ? { [id]: teamOf.id } : {} }, id),
  };
});

/** Every simulated member (accounts the admin makes to fill KIASA while it is
 * built and tested); none before their file has been run. */
export const simIds = cache(async (): Promise<Set<string>> => {
  if (!accountsLive) return new Set();
  const { data, error } = await siteClient().from("sim_members").select("user_id");
  return new Set(error ? [] : (data as { user_id: string }[]).map(row => row.user_id));
});

/** Whether the person signed in sees the simulated members: KIASA's admins,
 * and the testers an admin names. To everyone else they do not exist. */
export const seesSims = cache(async (): Promise<boolean> => {
  const viewer = await currentViewer();
  if (!viewer) return false;
  if (viewer.admin) return true;
  const { data } = await siteClient().from("testers").select("user_id").eq("user_id", viewer.id).maybeSingle();
  return !!data;
});

/** Who is hidden from the person signed in: every simulated member, unless they see them. */
export const hiddenFromViewer = cache(async (): Promise<Set<string>> => {
  const [sims, sees] = await Promise.all([simIds(), seesSims()]);
  return sees ? new Set() : sims;
});

/** Who wears a badge on their photo: KIASA's admins (the leaf and a crown) and
 * the top managers an admin has named (the leaf). Before the top managers'
 * file has been run, there are none. */
export const ranks = cache(async (): Promise<Ranks> => {
  if (!accountsLive) return { owners: [], top: [], teams: [], placed: {} };
  const site = siteClient();
  const [admins, top, teams, placed, hidden] = await Promise.all([
    site.rpc("admin_users"), site.from("top_managers").select("user_id"),
    site.from("teams").select("id, name, color").order("name"), site.from("team_members").select("user_id, team_id"),
    hiddenFromViewer(),
  ]);
  return {
    owners: ((admins.data ?? []) as { id: string }[]).map(admin => admin.id),
    top: ((top.data ?? []) as { user_id: string }[]).map(row => row.user_id).filter(id => !hidden.has(id)),
    teams: (teams.data ?? []) as Team[],
    placed: Object.fromEntries(((placed.data ?? []) as { user_id: string; team_id: string }[]).filter(row => !hidden.has(row.user_id)).map(row => [row.user_id, row.team_id])),
  };
});

/** Everyone who has asked for an account, newest first, whether each is a top
 * manager, and their team. For the admin page only. */
export async function everyone(): Promise<Member[]> {
  const site = siteClient();
  const [{ data, error }, top, placed, faces] = await Promise.all([
    site.from("profiles").select("*").order("asked_at", { ascending: false }),
    site.from("top_managers").select("user_id"),
    site.from("team_members").select("user_id, team_id"),
    site.from("avatars").select("user_id, path"),
  ]);
  if (error) throw new Error(`The requests could not be read: ${error.message}`);
  const managers = new Set(((top.data ?? []) as { user_id: string }[]).map(row => row.user_id));
  const teams = new Map(((placed.data ?? []) as { user_id: string; team_id: string }[]).map(row => [row.user_id, row.team_id]));
  const photos = new Map(((faces.data ?? []) as { user_id: string; path: string }[]).map(row => [row.user_id, photoUrl(url, row.path)]));
  return (data as ProfileRow[]).map(row => ({ ...toMember(row), top: managers.has(row.id), team: teams.get(row.id), photo: photos.get(row.id) ?? null }));
}
