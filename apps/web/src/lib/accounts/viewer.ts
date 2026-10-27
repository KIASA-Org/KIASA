/** A small cookie that only names who is signed in, so the header on every page
 * (rendered ahead of time, before anyone signs in) can show them without asking
 * the server. It grants nothing: every private page and every action checks the
 * real session with Supabase. */
export const VIEWER_COOKIE = "kiasa-viewer";

/** A badge on someone's photo: `owner`, one of KIASA's admins (the leaf and a
 * crown); `top`, a top manager in no team yet (the leaf). */
export type Rank = "owner" | "top";
/** A team: its name and colour make its shield badge. */
export type Team = { id: string; name: string; color: string };
/** The mark someone wears on their photo: an admin's, a top manager's, or
 * their team's shield (`lead`: they manage the team; the shield has a gold rim). */
export type Mark = { kind: Rank } | { kind: "team"; name: string; color: string; lead: boolean };
/** Who wears what: admins' and top managers' user ids, the teams, and who is in which (user id → team id). */
export type Ranks = { owners: string[]; top: string[]; teams?: Team[]; placed?: Record<string, string> };

/** The mark someone wears, from who wears what. */
export function markOf(ranks: Ranks, id: string): Mark | null {
  if (ranks.owners.includes(id)) return { kind: "owner" };
  const team = ranks.teams?.find(entry => entry.id === ranks.placed?.[id]);
  if (team) return { kind: "team", name: team.name, color: team.color, lead: ranks.top.includes(id) };
  return ranks.top.includes(id) ? { kind: "top" } : null;
}
/** The same mark, as one string (to tell whether the badge cookie still says it). */
export const markKey = (mark: Mark | null | undefined) => !mark ? "" : mark.kind === "team" ? `team:${mark.name}:${mark.color}:${mark.lead}` : mark.kind;

/** `photo`: the address of their profile photo, if they have set one; `mark`, the badge on it. */
export type ViewerBadge = { name: string; initials: string; href: string; photo?: string; mark?: Mark };

export const initialsOf = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
};

/** Where a profile photo is: Supabase's public "avatars" folder, under a name
 * that is never reused, so a browser may keep it for good. */
export const photoUrl = (supabaseUrl: string, path: string) => `${supabaseUrl}/storage/v1/object/public/avatars/${path}`;
const PHOTO = /^https?:\/\/[^\s"'<>]+\/storage\/v1\/object\/public\/avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/;

const wellFormed = (mark: unknown): mark is Mark => {
  const value = mark as Partial<{ kind: string; name: string; color: string; lead: boolean }> | null;
  if (!value || typeof value !== "object") return false;
  if (value.kind === "owner" || value.kind === "top") return true;
  return value.kind === "team" && typeof value.name === "string" && value.name.length <= 40 && typeof value.color === "string" && /^#[0-9a-f]{6}$/.test(value.color) && typeof value.lead === "boolean";
};

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
      mark: wellFormed(badge.mark) ? badge.mark : undefined,
    };
  } catch {
    return null;
  }
}
