/** A simulated member's working hours, as the admin sets them, in the team's
 * time zone: from and to ("09:00"), on these days (1 Monday … 7 Sunday). */
export type SimHours = { from: string; to: string; days: number[]; paused: boolean; zone: string };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Whether it is at work at a moment: within its hours, on one of its days, and not paused. */
export function atWork(hours: SimHours, at: number): boolean {
  if (hours.paused) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: hours.zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  const day = DAYS.indexOf(parts.weekday) + 1;
  const now = `${parts.hour}:${parts.minute}`;
  return hours.days.includes(day) && now >= hours.from.slice(0, 5) && now < hours.to.slice(0, 5);
}

/** Its days in words: "Mon–Fri", "Every day", or each one ("Mon, Wed, Sat"). */
export function daysInWords(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "Every day";
  const run = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  if (run && sorted.length > 2) return `${DAYS[sorted[0] - 1]}–${DAYS[sorted[sorted.length - 1] - 1]}`;
  return sorted.map(day => DAYS[day - 1]).join(", ");
}

export const DAY_NAMES = DAYS;
