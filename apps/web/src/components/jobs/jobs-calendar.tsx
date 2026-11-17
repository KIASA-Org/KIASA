"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Interview, InterviewOutcome, Job, JobsMe, TeamPerson } from "@/lib/jobs/types";
import { Avatar } from "../site/avatar";
import { ArrowLeft, ChevronDown, Plus } from "../site/icons";
import { InterviewDialog, type InterviewForm } from "./jobs-dialogs";
import { addDays, clockIn, dayIn, dayName, initialsOf, instantIn, partsIn, shortDay, weekStart, weekdayOf } from "./jobs-format";

const HOUR = 52;
const OUTCOMES: { id: InterviewOutcome; label: string }[] = [
  { id: "scheduled", label: "Scheduled" }, { id: "done", label: "Done" }, { id: "passed", label: "Passed" }, { id: "failed", label: "Not passed" }, { id: "cancelled", label: "Cancelled" },
];
const KIND: Record<Interview["kind"], string> = { video: "Video call", phone: "Phone call", technical: "Technical", onsite: "On site", other: "Interview" };
const whatOf = (interview: Interview) => [interview.job?.title ?? interview.title, interview.job?.company ?? interview.company].filter(Boolean).join(" · ") || "Interview";

/** The calendar's time zone as this member chose it, kept in this browser (none: the team's). */
const ZONE_KEY = "kiasa.jobs.calendar-zone";
const zoneHeard = new Set<() => void>();
const onZone = (heard: () => void) => {
  zoneHeard.add(heard);
  window.addEventListener("storage", heard);
  return () => { zoneHeard.delete(heard); window.removeEventListener("storage", heard); };
};
const storedZone = () => { try { return localStorage.getItem(ZONE_KEY); } catch { return null; } };
const keepZone = (zone: string | null) => {
  try { if (zone) localStorage.setItem(ZONE_KEY, zone); else localStorage.removeItem(ZONE_KEY); } catch { /* not kept */ }
  zoneHeard.forEach(heard => heard());
};
const realZone = (zone: string | null): zone is string => {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
};

/** The time now, to the second (0 on the server, so the page renders the same). */
const everySecond = (tick: () => void) => { const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); };
const useSecond = () => useSyncExternalStore(everySecond, () => Math.floor(Date.now() / 1000) * 1000, () => 0);

const formats = new Map<string, Intl.DateTimeFormat>();
const OPTIONS = {
  clock: { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" },
  day: { weekday: "short", month: "short", day: "numeric" },
  offset: { timeZoneName: "shortOffset" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;
const formatIn = (zone: string, kind: keyof typeof OPTIONS) => {
  const key = `${kind}|${zone}`;
  let format = formats.get(key);
  if (!format) formats.set(key, format = new Intl.DateTimeFormat(kind === "clock" ? "en-GB" : "en-US", { timeZone: zone, ...OPTIONS[kind] }));
  return format;
};
/** "UTC−8", "UTC+5:30", "UTC". */
const offsetOf = (zone: string, at: number) => {
  const name = formatIn(zone, "offset").formatToParts(at).find(part => part.type === "timeZoneName")?.value ?? "GMT";
  return name.replace(/^GMT/, "UTC").replace(/^UTC[+-]0$/, "UTC").replace("-", "−");
};
const zoneName = (zone: string) => zone.replace(/_/g, " ");

/** Interviews on a week's calendar, live: a member's own, or for an admin
 * everyone's (or one member's). Each opens to its details and outcome. */
export function CalendarView({ me, supabase, zone: teamZone, today: teamToday, team, version, onInterview }: {
  me: JobsMe; supabase: SupabaseClient; zone: string; today: string; team: TeamPerson[]; version: number;
  onInterview: (job: Job | null, form: InterviewForm) => Promise<string | null>;
}) {
  // Shown in the zone this member chose here (kept in this browser), else the team's.
  const stored = useSyncExternalStore(onZone, storedZone, () => null);
  const chosen = realZone(stored);
  const zone = chosen ? stored : teamZone;
  const second = useSecond();
  const today = second ? dayIn(zone, new Date(second)) : teamToday;
  const [week, setWeek] = useState<string | null>(null);
  const start = week ?? weekStart(today);
  const [interviews, setInterviews] = useState<Interview[] | null>(null);
  const [who, setWho] = useState<string>("all");
  const [adding, setAdding] = useState<Pick<Job, "id" | "title" | "company" | "url">[] | null>(null);
  const [open, setOpen] = useState<Interview | null>(null);
  const [local, setLocal] = useState(0);
  useEffect(() => {
    let stopped = false;
    void supabase.from("interviews").select("*, job:jobs(title, company, url)")
      .gte("starts_at", instantIn(zone, start, "00:00")).lt("starts_at", instantIn(zone, addDays(start, 7), "00:00")).order("starts_at")
      .then(({ data }) => { if (!stopped) setInterviews((data ?? []) as Interview[]); });
    return () => { stopped = true; };
  }, [supabase, zone, start, version, local]);

  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const shown = (interviews ?? []).filter(interview => who === "all" || interview.user_id === who);
  const placed = shown.map(interview => ({ interview, ...partsIn(zone, interview.starts_at) }));
  const first = Math.min(8, ...placed.map(entry => entry.hour));
  const last = Math.max(20, ...placed.map(entry => Math.min(24, Math.ceil(entry.hour + (entry.minute + entry.interview.minutes) / 60))));
  const person = (id: string) => team.find(entry => entry.id === id);
  // A line across today at this minute.
  const nowAt = second ? partsIn(zone, new Date(second).toISOString()) : null;
  const nowTop = nowAt && nowAt.hour >= first && nowAt.hour < last ? (nowAt.hour * 60 + nowAt.minute - first * 60) / 60 * HOUR : null;
  const startAdding = async () => {
    const { data } = await supabase.from("applications").select("job:jobs(id, title, company, url)").eq("user_id", me.id).neq("status", "skipped")
      .order("updated_at", { ascending: false }).limit(200);
    setAdding(((data ?? []) as unknown as { job: Pick<Job, "id" | "title" | "company" | "url"> | null }[]).map(row => row.job).filter((job): job is Pick<Job, "id" | "title" | "company" | "url"> => !!job));
  };

  return <div className="jobs-view">
    <section className="jobs-card" aria-labelledby="jobs-calendar-title">
      <div className="jobs-card-head">
        <div className="jobs-day-nav">
          <button type="button" className="chat-icon" aria-label="The week before" onClick={() => setWeek(addDays(start, -7))}><ArrowLeft /></button>
          <h2 id="jobs-calendar-title" className="jobs-card-title">{start === weekStart(today) ? "This week" : `Week of ${shortDay(start)}`}</h2>
          <button type="button" className="chat-icon jobs-next" aria-label="The week after" onClick={() => setWeek(addDays(start, 7) === weekStart(today) ? null : addDays(start, 7))}><ArrowLeft /></button>
          {start !== weekStart(today) && <button type="button" className="chat-pill" onClick={() => setWeek(null)}>This week</button>}
        </div>
        <div className="jobs-calendar-tools">
          {me.admin && <label className="jobs-resume-pick"><span>Showing</span>
            <select value={who} onChange={event => setWho(event.target.value)}>
              <option value="all">Every member</option>
              {team.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>}
          {me.member && <button type="button" className="jobs-button" data-primary="" onClick={() => void startAdding()}><Plus /> Add an interview</button>}
        </div>
      </div>
      <div className="jobs-calendar-bar">
        <p className="jobs-card-sub">{interviews ? `${shown.length === 1 ? "1 interview" : `${shown.length} interviews`} this week · times in ${zoneName(zone)}` : "Loading…"}</p>
        <ZoneClock zone={zone} team={teamZone} chosen={chosen} second={second} />
      </div>

      <div className="jobs-week" style={{ ["--hours" as string]: last - first }}>
        <div className="jobs-week-head" aria-hidden="true">
          <span />
          {days.map(day => <span key={day} data-today={day === today || undefined}><b>{weekdayOf(day)}</b> {day.slice(8).replace(/^0/, "")}</span>)}
        </div>
        <div className="jobs-week-body" style={{ height: (last - first) * HOUR }}>
          <div className="jobs-week-hours" aria-hidden="true">
            {Array.from({ length: last - first }, (_, index) => <span key={index} style={{ top: index * HOUR }}>{String(first + index).padStart(2, "0")}:00</span>)}
          </div>
          {days.map(day => {
            const mine = placed.filter(entry => entry.day === day).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
            // Side by side where they overlap.
            const lanes: number[] = [];
            const laid = mine.map(entry => {
              const begin = entry.hour * 60 + entry.minute, end = begin + entry.interview.minutes;
              let lane = lanes.findIndex(free => free <= begin);
              if (lane < 0) { lane = lanes.length; lanes.push(end); } else lanes[lane] = end;
              return { ...entry, begin, lane };
            });
            return <div key={day} className="jobs-week-day" data-today={day === today || undefined} aria-label={dayName(day, today)}>
              {day === today && nowTop !== null && <span className="jobs-week-now" style={{ top: nowTop }} aria-hidden="true" />}
              {laid.map(entry => {
                const height = Math.max(24, entry.interview.minutes / 60 * HOUR - 3);
                const who = person(entry.interview.user_id)?.name ?? "A member";
                // A short one keeps to a line: its time, and who (for an admin) or what.
                const short = height < 40;
                return <button key={entry.interview.id} type="button" className="jobs-event" data-outcome={entry.interview.outcome} data-short={short || undefined}
                  style={{
                    top: (entry.begin - first * 60) / 60 * HOUR, height,
                    left: `calc(${(entry.lane / Math.max(1, lanes.length)) * 100}% + 2px)`, width: `calc(${100 / Math.max(1, lanes.length)}% - 4px)`,
                  }}
                  aria-label={`${clockIn(zone, entry.interview.starts_at)}, ${whatOf(entry.interview)}${me.admin ? `, ${who}` : ""}`}
                  onClick={() => setOpen(entry.interview)}>
                  <span className="jobs-event-time">{clockIn(zone, entry.interview.starts_at)}</span>
                  {short && me.admin
                    ? <span className="jobs-event-what">{who}</span>
                    : <span className="jobs-event-what">{whatOf(entry.interview)}</span>}
                  {me.admin && !short && <span className="jobs-event-who">{who}</span>}
                </button>;
              })}
            </div>;
          })}
        </div>
      </div>

      <ol className="jobs-agenda" aria-label="This week's interviews">
        {days.map(day => {
          const mine = placed.filter(entry => entry.day === day);
          return <li key={day} data-today={day === today || undefined}>
            <p className="jobs-agenda-day">{dayName(day, today)}</p>
            {mine.length ? <ul>{mine.map(entry => <li key={entry.interview.id}>
              <button type="button" className="jobs-agenda-item" data-outcome={entry.interview.outcome} onClick={() => setOpen(entry.interview)}>
                <span className="jobs-event-time">{clockIn(zone, entry.interview.starts_at)}</span>
                <span>{whatOf(entry.interview)}{me.admin && ` — ${person(entry.interview.user_id)?.name ?? "a member"}`}</span>
              </button>
            </li>)}</ul> : <p className="jobs-quiet">No interviews</p>}
          </li>;
        })}
      </ol>
    </section>
    {adding && <InterviewDialog job={null} jobs={adding} zone={zone} today={today} onClose={() => setAdding(null)}
      onSave={async form => { const failed = await onInterview(form.job ? { id: form.job } as Job : null, { ...form, zone }); if (!failed) setLocal(value => value + 1); return failed; }} />}
    {open && <InterviewCard interview={open} me={me} zone={zone} today={today} person={person(open.user_id)} supabase={supabase}
      onClose={() => setOpen(null)} onChanged={() => setLocal(value => value + 1)} />}
  </div>;
}

/** The time now in the calendar's zone, ticking, and where to choose that zone
 * (ZonePicker); the team's time beside it when they differ. */
function ZoneClock({ zone, team, chosen, second }: { zone: string; team: string; chosen: boolean; second: number }) {
  const up = second > 0;
  const clock = up ? formatIn(zone, "clock").format(second) : "--:--:--";
  return <div className="jobs-clock">
    <div className="jobs-clock-face" role="timer" aria-label={up ? `Now ${clock.slice(0, 5)} in ${zoneName(zone)}` : "Clock"}>
      <time className="jobs-clock-time">{clock}</time>
      <span className="jobs-clock-day">{up ? `${formatIn(zone, "day").format(second)} · ${offsetOf(zone, second)}` : ""}</span>
      {up && zone !== team && <span className="jobs-clock-team">Team time {formatIn(team, "clock").format(second).slice(0, 5)} · {zoneName(team)}</span>}
    </div>
    <ZonePicker zone={zone} team={team} chosen={chosen} second={second} />
  </div>;
}

/** Names people search by that a zone's own name does not hold: its country. */
const COUNTRIES: Record<string, string> = {
  "Asia/Kolkata": "India Calcutta", "Asia/Calcutta": "India Kolkata", "Asia/Shanghai": "China", "Asia/Hong_Kong": "Hong Kong China",
  "Asia/Tokyo": "Japan", "Asia/Seoul": "Korea South Korea", "Asia/Manila": "Philippines", "Asia/Karachi": "Pakistan",
  "Asia/Dhaka": "Bangladesh", "Asia/Ho_Chi_Minh": "Vietnam Saigon", "Asia/Saigon": "Vietnam Ho Chi Minh", "Asia/Bangkok": "Thailand",
  "Asia/Jakarta": "Indonesia", "Asia/Singapore": "Singapore", "Asia/Kuala_Lumpur": "Malaysia", "Asia/Dubai": "UAE Emirates",
  "Asia/Riyadh": "Saudi Arabia", "Asia/Jerusalem": "Israel", "Asia/Taipei": "Taiwan", "Asia/Kathmandu": "Nepal",
  "Asia/Colombo": "Sri Lanka", "Asia/Tehran": "Iran", "Europe/London": "UK England Britain", "Europe/Dublin": "Ireland",
  "Europe/Paris": "France", "Europe/Berlin": "Germany", "Europe/Madrid": "Spain", "Europe/Rome": "Italy",
  "Europe/Amsterdam": "Netherlands Holland", "Europe/Warsaw": "Poland", "Europe/Kyiv": "Ukraine Kiev", "Europe/Kiev": "Ukraine Kyiv",
  "Europe/Istanbul": "Turkey", "Europe/Moscow": "Russia", "Europe/Lisbon": "Portugal", "Europe/Stockholm": "Sweden",
  "Africa/Lagos": "Nigeria", "Africa/Cairo": "Egypt", "Africa/Nairobi": "Kenya", "Africa/Johannesburg": "South Africa",
  "America/New_York": "USA US East Eastern", "America/Chicago": "USA US Central", "America/Denver": "USA US Mountain",
  "America/Los_Angeles": "USA US West Pacific California", "America/Phoenix": "USA US Arizona", "America/Anchorage": "USA US Alaska",
  "Pacific/Honolulu": "USA US Hawaii", "America/Toronto": "Canada", "America/Vancouver": "Canada", "America/Mexico_City": "Mexico",
  "America/Sao_Paulo": "Brazil", "America/Argentina/Buenos_Aires": "Argentina", "America/Bogota": "Colombia", "America/Lima": "Peru",
  "Australia/Sydney": "Australia", "Australia/Melbourne": "Australia", "Australia/Perth": "Australia", "Pacific/Auckland": "New Zealand",
};
const longFormats = new Map<string, Intl.DateTimeFormat>();
/** "Pacific Standard Time" and the like, for searching by. */
const longName = (zone: string, at: number) => {
  let format = longFormats.get(zone);
  if (!format) longFormats.set(zone, format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" }));
  return format.formatToParts(at).find(part => part.type === "timeZoneName")?.value ?? "";
};

type ZoneChoice = { value: string; zone: string; label: string; offset: string; shift: string; find: string; city: string; country: string; group: "quick" | "all" };

/** An offset as typed ("UTC+5:30", "gmt-8", "+05:30", "+0530") made one way ("+5:30", "-8"); null when it is no offset. */
function shiftOf(text: string): string | null {
  const found = /^(?:utc|gmt)?([+-])0?(\d{1,2})(?::?(\d{2}))?$/.exec(text.toLowerCase().replace(/\u2212/g, "-"));
  if (!found) return /^(utc|gmt)$/i.test(text) ? "+0" : null;
  const minutes = found[3] && found[3] !== "00" ? `:${found[3]}` : "";
  return found[2] === "0" && !minutes ? "+0" : `${found[1]}${Number(found[2])}${minutes}`;
}
/** Whether `word` is a whole word of `text`. */
const wordIn = (word: string, text: string) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
/** How well a zone answers a search: 0 its city or country by that word (India before Indiana),
 * 1 a city starting so, 2 a word found elsewhere (its long name, its region). */
const rankOf = (choice: ZoneChoice, words: string[]) =>
  words.some(word => wordIn(word, choice.city) || wordIn(word, choice.country)) ? 0 : words.some(word => choice.city.startsWith(word)) ? 1 : 2;

/** Choosing the calendar's zone: a button, and a list with a search box (a
 * city, a country, "pacific", "UTC+5:30" …), worked by mouse or keyboard. */
function ZonePicker({ zone, team, chosen, second }: { zone: string; team: string; chosen: boolean; second: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Under the keys (null: the zone shown now, until a key or a search moves it).
  const [moved, setActive] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hour = Math.floor(second / 3_600_000) * 3_600_000;
  const listId = "jobs-zone-list";

  // Every zone, with its offset and long name now: worked out when the list opens (and each hour).
  const choices = useMemo<ZoneChoice[]>(() => {
    if (!open || !hour) return [];
    const at = hour;
    const make = (value: string, name: string, label: string, group: ZoneChoice["group"]): ZoneChoice => {
      const offset = offsetOf(name, at);
      const find = [name, zoneName(name), label, longName(name, at), COUNTRIES[name] ?? ""].join(" ").toLowerCase();
      const city = zoneName(name.split("/").pop() ?? name).toLowerCase();
      return { value, zone: name, label, offset, shift: shiftOf(offset) ?? "+0", find, city, country: (COUNTRIES[name] ?? "").toLowerCase(), group };
    };
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const names = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [
      make("team", team, `Team time · ${zoneName(team)}`, "quick"),
      ...(here && here !== team ? [make(here, here, `This computer · ${zoneName(here)}`, "quick")] : []),
      ...(names.includes(zone) ? names : [zone, ...names]).map(name => make(name, name, zoneName(name), "all")),
    ];
  }, [open, hour, team, zone]);

  // Each word found in the zone's names, or an offset the zone has now exactly (so "UTC+1" is not "UTC+10").
  // Its city or country first: "india" is India before Indiana.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = !words.length ? choices : choices
    .filter(choice => words.every(word => { const shift = shiftOf(word); return shift ? choice.shift === shift : choice.find.includes(word); }))
    .map((choice, index) => ({ choice, index, rank: rankOf(choice, words.filter(word => !shiftOf(word))) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.choice);
  const current = chosen ? zone : "team";
  const active = moved ?? (words.length ? 0 : Math.max(0, shown.findIndex(choice => choice.value === current)));

  const close = (focus = true) => { setOpen(false); setQuery(""); if (focus) button.current?.focus(); };
  const pick = (choice: ZoneChoice) => { keepZone(choice.value === "team" ? null : choice.value); close(); };

  // A click outside closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  // The one chosen (or under the keys) kept in sight.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, choices.length]);

  const openList = () => {
    setOpen(true);
    setQuery("");
    setActive(null);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const by = (step: number) => { event.preventDefault(); setActive(Math.max(0, Math.min(shown.length - 1, active + step))); };
    if (event.key === "ArrowDown") by(1);
    else if (event.key === "ArrowUp") by(-1);
    else if (event.key === "PageDown") by(8);
    else if (event.key === "PageUp") by(-8);
    else if (event.key === "Enter") { event.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") close(false);
  };

  const label = chosen ? `${zoneName(zone)}${second ? ` (${offsetOf(zone, second)})` : ""}` : `Team time · ${zoneName(team)}`;
  return <div className="jobs-zone-pick" ref={root}>
    <span className="jobs-zone-label" id="jobs-zone-label">Time zone</span>
    <button type="button" ref={button} className="jobs-zone-button" aria-haspopup="listbox" aria-expanded={open}
      aria-labelledby="jobs-zone-label jobs-zone-current" onClick={() => open ? close() : openList()}>
      <span id="jobs-zone-current">{label}</span><ChevronDown />
    </button>
    {open && <div className="jobs-zone-pop">
      <input className="jobs-zone-search" type="search" autoFocus value={query} placeholder="Search a city, country or UTC+5:30"
        role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label="Search time zones"
        aria-activedescendant={shown[active] ? `jobs-zone-${active}` : undefined}
        onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKey} />
      <ul className="jobs-zone-list" id={listId} role="listbox" ref={list} aria-label="Time zones">
        {shown.length === 0 && <li className="jobs-zone-none">No time zone matches “{query}”.</li>}
        {shown.map((choice, index) => <li key={`${choice.group}-${choice.value}`} id={`jobs-zone-${index}`} data-index={index}
          role="option" aria-selected={choice.value === current} data-active={index === active || undefined}
          data-first={(index === 0 || shown[index - 1].group !== choice.group) ? choice.group : undefined}
          onPointerMove={() => setActive(index)} onClick={() => pick(choice)}>
          <span>{choice.label}</span><span className="jobs-zone-offset">{choice.offset}</span>
        </li>)}
      </ul>
    </div>}
  </div>;
}

/** One interview: what, when, where; its outcome a click away; removable by its member or an admin. */
function InterviewCard({ interview, me, zone, today, person, supabase, onClose, onChanged }: {
  interview: Interview; me: JobsMe; zone: string; today: string; person: TeamPerson | undefined; supabase: SupabaseClient;
  onClose: () => void; onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [outcome, setOutcome] = useState(interview.outcome);
  const [error, setError] = useState("");
  useEffect(() => { const box = dialog.current; if (box && !box.open) box.showModal(); }, []);
  const when = partsIn(zone, interview.starts_at);
  const link = interview.place && /^https?:\/\//i.test(interview.place) ? interview.place : null;
  const set = async (next: InterviewOutcome) => {
    setOutcome(next);
    const { error: failed } = await supabase.from("interviews").update({ outcome: next }).eq("id", interview.id);
    if (failed) { setOutcome(interview.outcome); setError("That did not save. Please try again."); } else onChanged();
  };
  const remove = async () => {
    const { error: failed } = await supabase.from("interviews").delete().eq("id", interview.id);
    if (failed) return setError("That did not work. Please try again.");
    onChanged();
    onClose();
  };
  return <dialog ref={dialog} className="chat-dialog jobs-dialog" aria-label={whatOf(interview)} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <p className="chat-dialog-title">{whatOf(interview)}</p>
    {person && me.admin && <p className="jobs-person jobs-card-who"><Avatar initials={initialsOf(person.name)} photo={person.photo} className="jobs-avatar" who={person.id} />{person.name}</p>}
    <dl className="jobs-facts">
      <div><dt>When</dt><dd>{dayName(when.day, today)}, {clockIn(zone, interview.starts_at)} · {interview.minutes < 60 ? `${interview.minutes} min` : `${interview.minutes / 60} h`} ({zone})</dd></div>
      <div><dt>Kind</dt><dd>{KIND[interview.kind]}{interview.stage ? ` · ${interview.stage}` : ""}</dd></div>
      {interview.place && <div><dt>Where</dt><dd>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{link}</a> : interview.place}</dd></div>}
      {interview.job?.url && <div><dt>The job</dt><dd><a href={interview.job.url} target="_blank" rel="noopener noreferrer">Open the posting</a></dd></div>}
      {interview.note && <div><dt>Note</dt><dd>{interview.note}</dd></div>}
    </dl>
    <div className="jobs-filters" role="group" aria-label="Outcome">
      {OUTCOMES.map(entry => <button key={entry.id} type="button" className="jobs-filter" aria-pressed={outcome === entry.id} onClick={() => void set(entry.id)}>{entry.label}</button>)}
    </div>
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" data-danger="" onClick={() => void remove()}>Remove</button>
      <button type="button" className="chat-dialog-button" onClick={onClose} autoFocus>Close</button>
    </div>
  </dialog>;
}
