import type { Period, Plan } from "@/lib/jobs/types";

/** Days are kept as "YYYY-MM-DD", in the team's time zone, and counted on as plain dates. */
export const dayIn = (zone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const asDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, count: number) => { const date = asDate(day); date.setUTCDate(date.getUTCDate() + count); return asDay(date); };
export const addMonths = (day: string, count: number) => { const date = asDate(`${day.slice(0, 7)}-01`); date.setUTCMonth(date.getUTCMonth() + count); return asDay(date); };
/** The Monday a week starts on. */
export const weekStart = (day: string) => addDays(day, -((asDate(day).getUTCDay() + 6) % 7));
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
export const periodStart = (period: Period, day: string) => period === "day" ? day : period === "week" ? weekStart(day) : monthStart(day);
export const nextPeriod = (period: Period, start: string, count: number) =>
  period === "day" ? addDays(start, count) : period === "week" ? addDays(start, 7 * count) : addMonths(start, count);

const SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });

/** "Today", "Yesterday", or "Mon, Oct 26". */
export function dayName(day: string, today: string) {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day === addDays(today, 1)) return "Tomorrow";
  return SHORT.format(asDate(day));
}
export const shortDay = (day: string) => DAY_MONTH.format(asDate(day));
export const weekdayOf = (day: string) => WEEKDAY.format(asDate(day));

/** A period as a person says it: "Today", "This week", "Week of Oct 26", "October 2026". */
export function periodName(period: Period, start: string, today: string) {
  if (period === "day") return dayName(start, today);
  if (period === "week") return start === weekStart(today) ? "This week" : `Week of ${shortDay(start)}`;
  return start === monthStart(today) ? "This month" : MONTH.format(asDate(start));
}

/** An instant's date, hour and minute in a time zone. */
export function partsIn(zone: string, iso: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

/** The instant a date and time ("14:30") mean in a time zone, as ISO. */
export function instantIn(zone: string, day: string, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour || 0, minute || 0);
  // The zone's offset at that moment, found by reading the guess back; twice, for a change of clocks.
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const seen = partsIn(zone, new Date(guess).toISOString());
    const read = Date.UTC(Number(seen.day.slice(0, 4)), Number(seen.day.slice(5, 7)) - 1, Number(seen.day.slice(8, 10)), seen.hour, seen.minute);
    guess += wanted - read;
  }
  return new Date(guess).toISOString();
}

export const clockIn = (zone: string, iso: string) => {
  const { hour, minute } = partsIn(zone, iso);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

/** "just now", "5 min ago", "3 h ago", then the day. */
export function ago(iso: string | null, now: number, zone: string, today: string) {
  if (!iso) return "not yet";
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 12 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return dayName(partsIn(zone, iso).day, today);
}

export const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
};
/** 1,284 / 12.9K / 4.2M, for a figure on its own. */
export const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);

/** What a member's plan is for a period: its targets are the latest set on or
 * before it (they carry on until changed); its note is that period's own. */
export function planFor(plans: Plan[], user: string, period: Period, start: string) {
  const mine = plans.filter(plan => plan.user_id === user && plan.period === period && plan.starts_on <= start)
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const latest = mine[0];
  return {
    applications: latest?.applications ?? null, interviews: latest?.interviews ?? null, offers: latest?.offers ?? null,
    note: latest?.starts_on === start ? latest.note : null, own: latest?.starts_on === start ? latest : null,
  };
}

/** Every member's goal for a day: at least this many applications, unless an
 * admin's plan for them says another number. */
export const DAILY_GOAL = 100;
/** A member's applications goal for a day: their plan's, or the team's daily goal. */
export const dayGoal = (plans: Plan[], user: string, day: string) => planFor(plans, user, "day", day).applications ?? DAILY_GOAL;

/** A link's place, for a job not yet titled: "boards.greenhouse.io/acme/…". */
export function linkLabel(link: string) {
  try {
    const url = new URL(link);
    const path = url.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    return `${url.hostname.replace(/^www\./, "")}${path ? `/${path}` : ""}${url.pathname.split("/").filter(Boolean).length > 2 ? "/…" : ""}`;
  } catch {
    return link;
  }
}

export const initialsOf = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase() || "·";
};
