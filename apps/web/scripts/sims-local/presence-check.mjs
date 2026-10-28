// A check of how simulated members on "auto" come and go: 60 of them with the
// same hours (09:00–18:00, Monday to Friday), minute by minute over a week.
// They must not all arrive or leave at once; outside their hours 30–40% of
// those not at work must be online at every moment, taking turns (no one on
// all the time, everyone some of the time). Prints PASS/FAIL. Usage, from
// apps/web: node scripts/sims-local/presence-check.mjs
import { onlineNow, OFF_HOURS_SHARE } from "../../src/lib/sims/hours.ts";

const zone = "Asia/Manila";
const hours = { from: "09:00", to: "18:00", days: [1, 2, 3, 4, 5], paused: false, zone, presence: "auto" };
const sims = Array.from({ length: 60 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, hours }));
// Monday 2026-11-02, 00:00 in Manila.
const monday = Date.parse("2026-11-01T16:00:00Z");
const results = [];
const check = (name, ok, detail) => results.push(`${ok ? "PASS" : "FAIL"}  ${name} (${detail})`);
const clock = at => new Date(at).toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const inHours = at => {
  const local = new Date(at).toLocaleString("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [day, time] = local.split(" ");
  return !["Sat", "Sun"].includes(day.replace(",", "")) && time >= "09:00" && time < "18:00";
};

let offShares = [], workShares = [], biggestJump = 0, before = null;
const onlineMinutesOff = new Map(sims.map(sim => [sim.id, 0]));
const longestOn = new Map(sims.map(sim => [sim.id, 0]));
const runOn = new Map(sims.map(sim => [sim.id, 0]));
const arrivals = [], departures = [];
for (let minute = 0; minute < 7 * 24 * 60; minute++) {
  const at = monday + minute * 60_000;
  const online = onlineNow(sims, at);
  const share = online.size / sims.length;
  if (inHours(at)) workShares.push(share); else offShares.push(share);
  if (before) {
    biggestJump = Math.max(biggestJump, Math.abs(online.size - before.size));
    // On Monday: when each first comes in for the day, and when each leaves it.
    if (minute < 24 * 60) for (const sim of sims) {
      const time = clock(at);
      if (!before.has(sim.id) && online.has(sim.id) && time >= "07:30" && time < "10:30") arrivals.push(time);
      if (before.has(sim.id) && !online.has(sim.id) && time >= "16:30" && time < "20:00") departures.push(time);
    }
  }
  for (const sim of sims) {
    if (online.has(sim.id)) {
      if (!inHours(at)) onlineMinutesOff.set(sim.id, onlineMinutesOff.get(sim.id) + 1);
      // A stretch of turns, at night (when no one is at work), counted on its own.
      const time = clock(at);
      if (time >= "22:00" || time < "06:00") {
        runOn.set(sim.id, runOn.get(sim.id) + 1);
        longestOn.set(sim.id, Math.max(longestOn.get(sim.id), runOn.get(sim.id)));
      } else runOn.set(sim.id, 0);
    } else runOn.set(sim.id, 0);
  }
  before = online;
}
const pct = value => `${Math.round(value * 100)}%`;
const lowest = Math.min(...offShares), highest = Math.max(...offShares);
// At night everyone is off work: the share is of all of them.
const night = [];
for (let minute = 0; minute < 7 * 24 * 60; minute += 1) {
  const at = monday + minute * 60_000;
  const time = clock(at);
  if (time >= "22:00" || time < "06:00") night.push(onlineNow(sims, at).size / sims.length);
}
check("at night, between 30% and 40% are online at every moment", Math.min(...night) >= OFF_HOURS_SHARE[0] - 0.02 && Math.max(...night) <= OFF_HOURS_SHARE[1] + 0.02,
  `${pct(Math.min(...night))}–${pct(Math.max(...night))}`);
// (Around 09:00 and 18:00 the early and late ones are at work as well: more show then.)
check("outside working hours, never fewer than 30% online, and never everyone", lowest >= OFF_HOURS_SHARE[0] - 0.02 && highest < 0.9, `${pct(lowest)}–${pct(highest)}`);
const workAverage = workShares.reduce((a, b) => a + b, 0) / workShares.length;
check("in working hours, most are online (breaks aside)", workAverage > 0.75 && workAverage < 0.97, `on average ${pct(workAverage)}`);
check("no sudden switch: at most a few change in any one minute", biggestJump <= 6, `at most ${biggestJump} in a minute`);
const spread = list => list.length ? `${list.sort()[0]}–${list[list.length - 1]}` : "none";
const span = list => { if (!list.length) return 0; const m = list.map(t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))); return Math.max(...m) - Math.min(...m); };
check("they come in over an hour or more, not at once", span(arrivals) >= 60, `arrivals ${spread(arrivals)}`);
check("they leave over an hour or more, not at once", span(departures) >= 60, `departures ${spread(departures)}`);
const offTotals = [...onlineMinutesOff.values()];
check("everyone takes turns outside their hours: no one never, no one always", Math.min(...offTotals) > 0 && Math.max(...longestOn.values()) < 5 * 60,
  `each online ${Math.round(Math.min(...offTotals) / 60)}–${Math.round(Math.max(...offTotals) / 60)} hours off-hours over the week; longest stretch at night ${Math.max(...longestOn.values())} min; typical ${[...longestOn.values()].sort((a, b) => a - b)[30]} min`);
console.log(results.join("\n"));
process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
