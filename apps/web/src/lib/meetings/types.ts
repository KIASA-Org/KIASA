/** KIASA meetings, as the server and the meeting window share them. */

export type Meeting = {
  id: string; chat_id: string | null; title: string; starts_at: string; started_at: string | null; ended_at: string | null; created_by: string | null;
  /** A manager's meeting with people outside their team: waiting for an admin's OK, then allowed or refused. */
  approval?: "waiting" | "allowed" | "refused" | null;
};

/** Someone who may be in the meeting: one of the people invited to it. */
export type MeetPerson = { id: string; name: string; photo: string | null };

/** Someone's ask to join a meeting, and what an admin decided. */
export type Admission = { user_id: string; name: string; status: "waiting" | "admitted" | "denied"; asked_at: string };

/** What the meeting window starts with. `ice`: where browsers find a way to
 * each other (and, when one is set up, a relay for strict networks). */
export type MeetStart = {
  meeting: Meeting; chatTitle: string; people: MeetPerson[];
  /** Who runs it: KIASA's admins and the one who called it (they let people
   * in, and need no letting in); and who has asked. */
  hosts: string[]; admissions: Admission[];
  me: { id: string; name: string; admin: boolean; host: boolean; photo: string | null };
  ice: { urls: string | string[]; username?: string; credential?: string }[];
};

/** How a meeting stands, from its times: planned, live, or over. A live
 * meeting no one ended is taken as over after twelve hours. */
export function meetingState(meeting: Pick<Meeting, "started_at" | "ended_at">, now = Date.now()): "scheduled" | "live" | "ended" {
  if (meeting.ended_at) return "ended";
  if (!meeting.started_at) return "scheduled";
  return now - Date.parse(meeting.started_at) > 12 * 3600_000 ? "ended" : "live";
}

/** Someone one could put in a meeting; `outside`: outside a manager's team, so an admin's OK is needed. */
export type MeetingChoice = { id: string; name: string; detail: string; photo: string | null; outside: boolean };

/** Who is in a meeting (`waiting`: for an admin's OK), and whom else one could add. */
export type MeetingRoster = {
  title: string; over: boolean; manager: boolean;
  people: { id: string; name: string; photo: string | null; waiting: boolean; organizer: boolean }[];
  choices: MeetingChoice[];
};
