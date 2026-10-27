/** A simulated member's working hours, as the admin sets them, in the team's
 * time zone: from and to ("09:00"), on these days (1 Monday … 7 Sunday); and
 * whether it shows online: set so by the admin, or "auto", coming and going as
 * a person does (see `onlineAt`). */
export type Presence = "auto" | "online" | "offline";
export type SimHours = { from: string; to: string; days: number[]; paused: boolean; zone: string; presence: Presence };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The longest it is ever away during its working hours, in minutes. */
export const LONGEST_BREAK = 120;

/** The day, weekday and minute of the day it is at a moment, in a time zone. */
function localAt(zone: string, at: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day: DAYS.indexOf(parts.weekday) + 1, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Whether it is at work at a moment: within its hours, on one of its days, and not paused. */
export function atWork(hours: SimHours, at: number): boolean {
  if (hours.paused) return false;
  const now = localAt(hours.zone, at);
  return hours.days.includes(now.day) && now.minute >= minutesOf(hours.from) && now.minute < minutesOf(hours.to);
}

/** Numbers that look random but are the same for one person on one day, everywhere. */
function seeded(text: string) {
  let state = 2166136261;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}
const between = (random: () => number, low: number, high: number) => Math.round(low + random() * (high - low));

/** When it is online on a day, as minutes of the day [from, to): a person's day.
 * On a working day: in a little after its start and out a little around its
 * end, away for one to three short breaks between (a lunch among them, none
 * longer than LONGEST_BREAK), and perhaps back for a few minutes in the
 * evening. On a day off: a short visit or two, or none. */
export function onlineSpans(id: string, hours: SimHours, date: string, workday: boolean): [number, number][] {
  const random = seeded(`${id}:${date}`);
  const spans: [number, number][] = [];
  if (workday) {
    const start = minutesOf(hours.from) + between(random, -10, 20);
    const end = Math.min(24 * 60, minutesOf(hours.to) + between(random, -20, 15));
    const breaks: [number, number][] = [];
    const count = between(random, 1, 3);
    for (let n = 0; n < count && end - start > 120; n++) {
      // One of them is lunch, a little longer, around the middle of the day.
      const length = n === 0 ? between(random, 30, 75) : between(random, 8, 40);
      const middle = n === 0 ? (start + end) / 2 + between(random, -60, 60) : between(random, start + 30, end - 30);
      const from = Math.max(start + 20, Math.round(middle - length / 2));
      breaks.push([from, Math.min(end - 20, from + Math.min(length, LONGEST_BREAK))]);
    }
    breaks.sort((a, b) => a[0] - b[0]);
    let at = start;
    for (const [from, to] of breaks) {
      if (from > at) spans.push([at, from]);
      at = Math.max(at, to);
    }
    if (end > at) spans.push([at, end]);
    // Breaks that ran into each other are still never longer than LONGEST_BREAK.
    for (let n = 1; n < spans.length; n++) {
      if (spans[n][0] - spans[n - 1][1] > LONGEST_BREAK) spans[n - 1][1] = spans[n][0] - LONGEST_BREAK;
    }
    // An evening look in, some days.
    if (random() < 0.45) {
      const from = between(random, end + 60, Math.max(end + 60, 22 * 60));
      spans.push([from, Math.min(24 * 60, from + between(random, 5, 25))]);
    }
  } else {
    const visits = between(random, 0, 2);
    for (let n = 0; n < visits; n++) {
      const from = between(random, 10 * 60, 21 * 60);
      spans.push([from, from + between(random, 10, 40)]);
    }
  }
  return spans.filter(([from, to]) => to > from);
}

/** Whether it shows online at a moment: paused, never; otherwise as the admin set it, or, on auto, as its day goes. */
export function onlineAt(id: string, hours: SimHours, at: number): boolean {
  if (hours.paused) return false;
  if (hours.presence !== "auto") return hours.presence === "online";
  const now = localAt(hours.zone, at);
  return onlineSpans(id, hours, now.date, hours.days.includes(now.day)).some(([from, to]) => now.minute >= from && now.minute < to);
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
