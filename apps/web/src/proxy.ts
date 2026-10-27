import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Before the private pages render, keeps the visitor's Supabase session fresh:
 * a page cannot write cookies while it renders, so an expired session is renewed
 * here. Only on the pages that read the session, and only once accounts are
 * connected; every other page stays as it was built. */
export async function proxy(request: NextRequest) {
  const env = process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (entries, headers) => {
        for (const { name, value } of entries) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of entries) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });
  // Checks the sign-in's signature on the spot, and renews it if it has expired.
  await supabase.auth.getClaims();
  return response;
}

export const config = { matcher: ["/account", "/admin", "/sign-in", "/chat", "/jobs"] };
