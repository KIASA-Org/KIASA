/** A simulated member's working hours, as the admin sets them, in the team's
 * time zone: from and to ("09:00"), on these days (1 Monday … 7 Sunday); and
 * whether it shows online: set so by the admin, or "auto", coming and going as
 * a person does (see `onlineNow`). */
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

/** Each one's own habit, the same every day: some come in early and leave
 * early, some come in late and stay late (minutes, either side of its hours). */
const habitOf = (id: string) => between(seeded(`habit:${id}`), -45, 45);

/** When it is at work on a day, as minutes of the day [from, to): a person's day.
 * In around its start and out around its end, each at its own time (its habit,
 * and the day's own minutes, so they come and go over an hour or two, not all
 * at once), away for one to three short breaks between (a lunch among them,
 * none longer than LONGEST_BREAK). On a day off: none. */
export function onlineSpans(id: string, hours: SimHours, date: string, workday: boolean): [number, number][] {
  const random = seeded(`${id}:${date}`);
  const spans: [number, number][] = [];
  if (workday) {
    const habit = habitOf(id);
    const start = Math.max(0, minutesOf(hours.from) + habit + between(random, -20, 30));
    const end = Math.min(24 * 60, minutesOf(hours.to) + habit + between(random, -40, 60));
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
  }
  return spans.filter(([from, to]) => to > from);
}

/** Whether it is at work at a moment, as its day goes (breaks aside). */
function working(id: string, hours: SimHours, at: number): boolean {
  const now = localAt(hours.zone, at);
  return onlineSpans(id, hours, now.date, hours.days.includes(now.day)).some(([from, to]) => now.minute >= from && now.minute < to);
}

/** Outside their hours, between 30% and 40% of them are online, taking turns. */
export const OFF_HOURS_SHARE = [0.3, 0.4] as const;

/** Where it stands in the queue for a turn online, at a moment: a number that
 * holds through one of its own turns (25 to 90 minutes, starting at its own
 * times) and is drawn anew for the next, so the turns pass from one to another,
 * one by one. One that stood near the front for its last turn goes to the back
 * for this one: a rest, so no one stays on for hours. */
function turnScore(id: string, minute: number): number {
  const own = seeded(`turns:${id}`);
  const length = between(own, 25, 90);
  const phase = Math.floor(own() * length);
  const turn = Math.floor((minute + phase) / length);
  const draw = (n: number) => seeded(`${id}:turn:${n}`)();
  return draw(turn) * (draw(turn - 1) > 0.55 ? 0.25 : 1);
}

/** Who of them shows online at a moment. Paused, none; set online or offline
 * by the admin, so; on auto, each at work as its day goes, and of those not at
 * work (on a break, before or after their hours, or on a day off) between 30%
 * and 40%, whichever stand first in the queue for a turn. The same for everyone
 * who sees them. */
export function onlineNow(sims: { id: string; hours: SimHours }[], at: number): Set<string> {
  const online = new Set<string>();
  const waiting: string[] = [];
  for (const sim of sims) {
    if (sim.hours.paused || sim.hours.presence === "offline") continue;
    if (sim.hours.presence === "online" || working(sim.id, sim.hours, at)) online.add(sim.id);
    else waiting.push(sim.id);
  }
  const minute = Math.floor(at / 60_000);
  // How many take a turn: 30–40%, drifting every hour and a half.
  const share = OFF_HOURS_SHARE[0] + seeded(`share:${Math.floor(minute / 90)}`)() * (OFF_HOURS_SHARE[1] - OFF_HOURS_SHARE[0]);
  const turns = Math.round(share * waiting.length);
  waiting.map(id => ({ id, score: turnScore(id, minute) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, turns).forEach(entry => online.add(entry.id));
  return online;
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
