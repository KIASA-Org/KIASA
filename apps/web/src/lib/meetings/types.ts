/** KIASA meetings, as the server and the meeting window share them. */

export type Meeting = {
  id: string; chat_id: string; title: string; starts_at: string; started_at: string | null; ended_at: string | null; created_by: string | null;
};

/** Someone who may be in the meeting: a member of its chat. */
export type MeetPerson = { id: string; name: string; photo: string | null };

/** Someone's ask to join a meeting, and what an admin decided. */
export type Admission = { user_id: string; name: string; status: "waiting" | "admitted" | "denied"; asked_at: string };

/** What the meeting window starts with. `ice`: where browsers find a way to
 * each other (and, when one is set up, a relay for strict networks). */
export type MeetStart = {
  meeting: Meeting; chatTitle: string; people: MeetPerson[];
  /** KIASA's admins (they let people in, and need no letting in), and who has asked. */
  admins: string[]; admissions: Admission[];
  me: { id: string; name: string; admin: boolean; photo: string | null };
  ice: { urls: string | string[]; username?: string; credential?: string }[];
};

/** How a meeting stands, from its times: planned, live, or over. A live
 * meeting no one ended is taken as over after twelve hours. */
export function meetingState(meeting: Pick<Meeting, "started_at" | "ended_at">, now = Date.now()): "scheduled" | "live" | "ended" {
  if (meeting.ended_at) return "ended";
  if (!meeting.started_at) return "scheduled";
  return now - Date.parse(meeting.started_at) > 12 * 3600_000 ? "ended" : "live";
}
