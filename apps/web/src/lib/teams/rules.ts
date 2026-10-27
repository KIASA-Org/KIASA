import type { Ranks } from "@/lib/accounts/viewer";
import type { ContactRequest } from "@/lib/chat/types";

/** Whether one may message someone directly: freely; only once the admin
 * approves ("ask"); or with a request already waiting for the admin. */
export type Reach = "free" | "ask" | "waiting";

/** The same rule as the database's own (may_talk, in
 * supabase/migrations/20261027210000_team_chats.sql), so the page can say so
 * before anyone tries: KIASA's admins talk with anyone; people in one team
 * talk freely, its manager included; one top manager and another, or people
 * of different teams (or of none), need the admin's approval. */
export function reachOf(me: string, other: string, ranks: Ranks, requests: ContactRequest[]): Reach {
  if (me === other || ranks.owners.includes(me) || ranks.owners.includes(other)) return "free";
  const placed = ranks.placed ?? {};
  const both = (request: ContactRequest) => (request.from_user === me && request.to_user === other) || (request.from_user === other && request.to_user === me);
  if (placed[me] && placed[me] === placed[other] && !(ranks.top.includes(me) && ranks.top.includes(other))) return "free";
  if (requests.some(request => request.status === "approved" && both(request))) return "free";
  return requests.some(request => request.status === "waiting" && both(request)) ? "waiting" : "ask";
}

/** The team a person leads, if they are a top manager in one. */
export const teamLedBy = (person: string, ranks: Ranks) => ranks.top.includes(person) ? ranks.placed?.[person] ?? null : null;

/** Why messaging someone needs the admin's approval, in words, as a warning. */
export function whyAsk(me: string, other: { id: string; name: string }, ranks: Ranks): string {
  const first = other.name.split(" ")[0];
  const teamName = (id: string) => ranks.teams?.find(team => team.id === ranks.placed?.[id])?.name;
  if (ranks.top.includes(me) && ranks.top.includes(other.id)) return `${first} is a manager too. Managers message each other once the admin approves it.`;
  const theirs = teamName(other.id);
  if (!ranks.placed?.[me]) return `You are not in a team yet, so messaging ${first} needs the admin's approval.`;
  if (ranks.top.includes(me)) return `${first} is ${theirs ? `in ${theirs}, ` : ""}not in your team. Managers message another team's people once the admin approves it.`;
  return `${first} is ${theirs ? `in ${theirs}, ` : ""}not in your team. You can message people outside your team once the admin approves it.`;
}
