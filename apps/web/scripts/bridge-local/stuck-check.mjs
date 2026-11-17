// Checks how KIASA's page handles ChatGPT getting stuck (askChatGPT in
// src/components/jobs/jobs-bridge.ts), against a stand-in bridge on a clock
// moved by hand (minutes in milliseconds): stuck, failing, slow, silent,
// at its limit, and stopped by the member. Run: npm run bridge:stuck:check
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, n) { try { return n(s, c); } catch (e) { if (s.startsWith(".")) return n(s + ".ts", c); throw e; } } });
// A fake clock: timers run as time is moved on.
let now = 0; const timers = new Map(); let nextId = 1;
const add = (fn, ms, every) => { const id = nextId++; timers.set(id, { at: now + ms, fn, every }); return id; };
const clear = id => timers.delete(id);
Date.now = () => now;
const listeners = new Set();
globalThis.window = {
  setTimeout: (fn, ms) => add(fn, ms, 0), clearTimeout: clear, setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: clear,
  addEventListener: (t, f) => listeners.add(f), removeEventListener: (t, f) => listeners.delete(f),
  postMessage: data => queueMicrotask(() => { for (const f of [...listeners]) f({ source: globalThis.window, data }); }),
  location: { origin: "http://localhost:3000" },
};
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
async function advance(ms) {
  const end = now + ms;
  while (true) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    const [id, t] = due; now = Math.max(now, t.at);
    if (t.every) t.at += t.every; else timers.delete(id);
    t.fn(); await flush();
  }
  now = end; await flush();
}
const { askChatGPT, STUCK_MINUTES, ASK_TRIES } = await import("../../src/components/jobs/jobs-bridge.ts");

// A fake bridge: each ask behaves as the scenario says for that try.
let script = [], asks = 0, stops = 0;
const reply = (id, m) => window.postMessage({ source: "kiasa-bridge", id, ...m });
listeners.add(event => {
  const d = event.data; if (d?.source !== "kiasa-page") return;
  if (d.type === "stop") { stops++; const run = runs.get(d.id); if (run && !run.deaf) { run.stop(); reply(d.id, { type: "error", error: "Stopped." }); } return; }
  if (d.type !== "ask") return;
  const how = script[asks++] ?? "answer";
  const id = d.id; const run = { deaf: how === "silent", ticks: [] , stop() { this.ticks.forEach(clear); } };
  runs.set(id, run);
  if (how === "silent") return;
  reply(id, { type: "progress", step: "sent" });
  if (how === "stuck") run.ticks.push(window.setInterval(() => reply(id, { type: "progress", step: "thinking", seconds: 1, chars: 0 }), 5000));
  if (how === "answer") window.setTimeout(() => reply(id, { type: "answer", answer: "```json\n{}\n```" }), 60_000);
  if (how === "slow") { let c = 0; run.ticks.push(window.setInterval(() => reply(id, { type: "progress", step: "thinking", chars: c += 50 }), 5000)); window.setTimeout(() => { run.stop(); reply(id, { type: "answer", answer: "slow done" }); }, 12 * 60_000); }
  if (how === "error") window.setTimeout(() => reply(id, { type: "error", error: "ChatGPT answered with an error: “Something went wrong”" }), 10_000);
  if (how === "limit") window.setTimeout(() => reply(id, { type: "error", error: "ChatGPT's usage limit is reached (“You've hit your limit”)." }), 10_000);
});
const runs = new Map();
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok ? "  " + detail : ""}`); };
async function run(plan, minutes, abortAt) {
  script = plan; asks = 0; stops = 0; runs.clear(); timers.clear(); now = 0;
  const seen = []; const control = new AbortController();
  let result, error;
  const p = askChatGPT("question", pr => { if (pr.step === "retrying") seen.push(pr); }, control.signal).then(r => result = r, e => error = e);
  if (abortAt) { await advance(abortAt); control.abort(); }
  await advance(minutes * 60_000);
  await p;
  return { result, error: error?.message, seen, asks, stops };
}
let r = await run(["stuck", "stuck", "answer"], 40);
check(`stuck twice (no answer for ${STUCK_MINUTES} min), then answers on the third try`, r.result?.includes("json") && r.asks === 3 && r.stops === 2 && r.seen.length === 2 && /no answer 6 minutes/.test(r.seen[0].why), JSON.stringify(r));
r = await run(["stuck", "stuck", "stuck"], 60);
check(`stuck ${ASK_TRIES} times: gives up, saying so`, r.error?.includes("seemed stuck") && r.error.includes(`tried ${ASK_TRIES} times`) && r.asks === 3, JSON.stringify(r));
r = await run(["error", "answer"], 10);
check("ChatGPT's error: asked again in a new chat at once", r.result && r.asks === 2 && /answered with an error/.test(r.seen[0]?.why), JSON.stringify(r));
r = await run(["limit"], 10);
check("its usage limit is not retried here (Auto mode waits it out)", /usage limit/.test(r.error) && r.asks === 1, JSON.stringify(r));
r = await run(["slow"], 20);
check("a slow answer that keeps growing (12 min) is not cut off", r.result === "slow done" && r.asks === 1, JSON.stringify(r));
r = await run(["silent", "answer"], 20);
check("a bridge that says nothing: stopped after 4 min (30 s for a stop it ignores), then asked again", r.result && r.asks === 2 && /No word from the bridge/.test(r.seen[0]?.why), JSON.stringify(r));
r = await run(["stuck"], 5, 2 * 60_000);
check("the member's Stop ends it, without a retry", r.error === "Stopped." && r.asks === 1 && r.seen.length === 0, JSON.stringify(r));
console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
