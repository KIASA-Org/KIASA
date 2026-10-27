import { createBrowserClient } from "@supabase/ssr";

/** Supabase in the browser, as the signed-in visitor (their session is in the
 * cookies the server set). Only used to hear about changes as they happen; it
 * holds no secret, and what it may read is decided by the database's rules. */
export const browserClient = (url: string, key: string) => createBrowserClient(url, key);
