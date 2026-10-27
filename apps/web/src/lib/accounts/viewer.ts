/** A small cookie that only names who is signed in, so the header on every page
 * (rendered ahead of time, before anyone signs in) can show them without asking
 * the server. It grants nothing: every private page and every action checks the
 * real session with Supabase. */
export const VIEWER_COOKIE = "kiasa-viewer";

/** A badge on someone's photo: `owner`, one of KIASA's admins (the leaf and a
 * crown); `top`, a top manager (the leaf). */
export type Rank = "owner" | "top";
/** Who wears one: admins' and top managers' user ids. */
export type Ranks = { owners: string[]; top: string[] };

/** `photo`: the address of their profile photo, if they have set one; `rank`, the badge on it. */
export type ViewerBadge = { name: string; initials: string; href: string; photo?: string; rank?: Rank };

export const initialsOf = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
};

/** Where a profile photo is: Supabase's public "avatars" folder, under a name
 * that is never reused, so a browser may keep it for good. */
export const photoUrl = (supabaseUrl: string, path: string) => `${supabaseUrl}/storage/v1/object/public/avatars/${path}`;
const PHOTO = /^https?:\/\/[^\s"'<>]+\/storage\/v1\/object\/public\/avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/;

/** The badge in a `document.cookie` string, if there is a well-formed one. */
export function readBadge(cookies: string): ViewerBadge | null {
  const raw = cookies.split("; ").find(entry => entry.startsWith(`${VIEWER_COOKIE}=`))?.slice(VIEWER_COOKIE.length + 1);
  if (!raw) return null;
  try {
    // Encoded once; older badges were encoded twice.
    let text = decodeURIComponent(raw);
    if (text.startsWith("%")) text = decodeURIComponent(text);
    const badge = JSON.parse(text) as Partial<ViewerBadge>;
    if (typeof badge.name !== "string" || typeof badge.initials !== "string" || (badge.href !== "/account" && badge.href !== "/admin")) return null;
    return {
      name: badge.name, initials: badge.initials, href: badge.href, photo: typeof badge.photo === "string" && PHOTO.test(badge.photo) ? badge.photo : undefined,
      rank: badge.rank === "owner" || badge.rank === "top" ? badge.rank : undefined,
    };
  } catch {
    return null;
  }
}
