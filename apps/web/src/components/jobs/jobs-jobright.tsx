"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotRun, BotStep, JobBot } from "@/lib/jobs/types";
import { LeafMark } from "../site/brand";
import { Copy, Gear, Play, Plus } from "../site/icons";
import { Confirm } from "../chat/chat-dialog";
import { FormDialog } from "./jobs-dialogs";
import { ago, clockIn, dayName, partsIn } from "./jobs-format";

const BOT_COLUMNS = "id, name, computer, version, state, detail, seen_at, daily_cap, schedule_at, schedule_cards, schedule_days, created_at";
/** A bot checks in every few seconds; not heard from in a minute, it is offline. */
const ONLINE_MS = 60_000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ORIGINS: Record<BotRun["origin"], string> = { admin: "Asked here", schedule: "On schedule", computer: "Started on the computer" };
const ENDINGS: Record<BotRun["state"], string> = { waiting: "Waiting", running: "Running", done: "Done", stopped: "Stopped", failed: "Failed", missed: "Not run" };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const isOpen = (run: BotRun) => run.state === "waiting" || run.state === "running";
const byAsked = (a: BotRun, b: BotRun) => b.asked_at.localeCompare(a.asked_at);
const put = <T extends { id: string | number }>(list: T[], row: T) => list.some(item => item.id === row.id) ? list.map(item => item.id === row.id ? row : item) : [...list, row];

/** The code a computer is connected with: where KIASA's database is, its public
 * key (the one every page has), and the bot's own secret. */
function connectionCode(url: string, key: string, secret: string) {
  const packed = btoa(JSON.stringify({ u: url, k: key, s: secret })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `KIASA-BOT1.${packed}`;
}

/** "Weekdays at 08:00, 30 cards". */
function scheduleText(bot: JobBot) {
  if (!bot.schedule_at) return "No schedule";
  const days = [...bot.schedule_days].sort();
  const which = days.length === 7 ? "Every day" : days.join() === "1,2,3,4,5" ? "Weekdays" : days.map(day => DAYS[day - 1]).join(", ");
  return `${which} at ${bot.schedule_at.slice(0, 5)}, ${plural(bot.schedule_cards, "card")}`;
}

/** The Jobright bot: Job Saving Bot on a KIASA computer works down Jobright's
 * Recommended list, and each job it saves is posted to the day's list. Admins
 * start and stop it here, watch it work, and set it to run on its own each day. */
export function JobrightBots({ supabase, realtime, zone, today }: {
  supabase: SupabaseClient; realtime: { url: string; key: string }; zone: string; today: string;
}) {
  const [bots, setBots] = useState<JobBot[] | null>(null);
  const [runs, setRuns] = useState<BotRun[]>([]);
  const [steps, setSteps] = useState<BotStep[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [naming, setNaming] = useState(false);
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const [settings, setSettings] = useState<JobBot | null>(null);
  const [rekeying, setRekeying] = useState<JobBot | null>(null);
  const [removing, setRemoving] = useState<JobBot | null>(null);
  const reload = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let stopped = false;
    const load = reload.current = async () => {
      const [found, asked] = await Promise.all([
        supabase.from("job_bots").select(BOT_COLUMNS).order("created_at"),
        supabase.from("bot_runs").select("*").order("asked_at", { ascending: false }).limit(40),
      ]);
      if (stopped) return;
      const list = (asked.data ?? []) as BotRun[];
      const latest = [...new Set(list.map(run => run.bot_id))].map(bot => list.find(run => run.bot_id === bot)!.id);
      const lines = latest.length
        ? ((await supabase.from("bot_steps").select("*").in("run_id", latest).order("id", { ascending: false }).limit(120)).data ?? []) as BotStep[]
        : [];
      if (stopped) return;
      setBots((found.data ?? []) as JobBot[]);
      setRuns(list);
      setSteps(lines.reverse());
    };
    const channel = supabase.channel(`job-bots:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_bots" }, payload => {
        if (payload.eventType === "DELETE") setBots(list => list?.filter(bot => bot.id !== (payload.old as JobBot).id) ?? list);
        else setBots(list => put(list ?? [], payload.new as JobBot).sort((a, b) => a.created_at.localeCompare(b.created_at)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_runs" }, payload => {
        if (payload.eventType === "DELETE") setRuns(list => list.filter(run => run.id !== (payload.old as BotRun).id));
        else setRuns(list => put(list, payload.new as BotRun).sort(byAsked));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bot_steps" }, payload => {
        setSteps(list => put(list, payload.new as BotStep).slice(-300));
      })
      // On joining, and on joining again after a drop: what happened meanwhile.
      .subscribe(status => { if (status === "SUBSCRIBED") void load(); });
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => { stopped = true; clearInterval(tick); void supabase.removeChannel(channel); };
  }, [supabase]);

  const connect = async (name: string, existing: string | null) => {
    const { data, error } = await supabase.rpc("job_bot_connect", { bot_name: name, existing });
    if (error || typeof data !== "string") return "That did not work. Please try again.";
    setCode({ name, code: connectionCode(realtime.url, realtime.key, data) });
    void reload.current();
    return null;
  };

  const first = bots?.[0];
  return <section className="jobs-card jobs-bot jobright" aria-labelledby="jobright-title">
    <header className="jobs-bot-head">
      <span className="jobs-bot-face" data-kind="jobright" aria-hidden="true"><LeafMark weight={2.4} /></span>
      <div>
        <h2 id="jobright-title" className="jobs-card-title">Jobright bot</h2>
        <p className="jobs-card-sub">{bots === null ? "Loading…" : !first ? "Not connected" : `Job Saving Bot on ${bots.length === 1 ? first.computer ?? first.name : plural(bots.length, "computer")}`}</p>
      </div>
      {bots && bots.length > 0 && <button type="button" className="chat-pill jobright-add" onClick={() => setNaming(true)}><Plus /> Another computer</button>}
    </header>

    {bots?.length === 0 && <div className="jobright-intro">
      <p>Job Saving Bot works down your Jobright <b>Recommended</b> list on a KIASA computer, and every job it saves is posted here for the team. Connect that computer once; then start it, stop it and set it to run each day from here.</p>
      <button type="button" className="chat-pill" onClick={() => setNaming(true)}><Plus /> Connect a computer</button>
    </div>}

    {bots?.map(bot => <BotPanel key={bot.id} supabase={supabase} bot={bot} runs={runs.filter(run => run.bot_id === bot.id)} steps={steps}
      now={now} zone={zone} today={today} onSettings={() => setSettings(bot)} />)}

    {naming && <FormDialog title="Connect a computer" action="Make its code" busyAction="Making…" onClose={() => setNaming(false)} onSubmit={async form => {
      const name = String(form.get("name") ?? "").trim();
      if (!name) return "Give it a name, such as Office PC.";
      return connect(name, null);
    }}>
      <label className="chat-field"><span>Name</span><input name="name" maxLength={60} placeholder="Office PC" required /></label>
      <p className="jobs-form-hint">Next you get a code to paste in Job Saving Bot on that computer.</p>
    </FormDialog>}
    {code && <CodeDialog name={code.name} code={code.code} onClose={() => setCode(null)} />}
    {settings && <SettingsDialog supabase={supabase} bot={settings} onClose={() => setSettings(null)}
      onNewCode={() => { setRekeying(settings); setSettings(null); }} onRemove={() => { setRemoving(settings); setSettings(null); }} />}
    {rekeying && <Confirm title={`A new code for ${rekeying.name}?`} confirm="Make a new code"
      text="The code it has now stops working at once. Paste the new one in Job Saving Bot's box 4 – KIASA on that computer."
      onClose={() => setRekeying(null)} onConfirm={() => connect(rekeying.name, rekeying.id)} />}
    {removing && <Confirm title={`Disconnect ${removing.name}?`} confirm="Disconnect"
      text="Its code stops working, and its runs leave this page. The jobs it posted stay on the list."
      onClose={() => setRemoving(null)} onConfirm={async () => {
        const { error } = await supabase.from("job_bots").delete().eq("id", removing.id);
        return error ? "That did not work. Please try again." : null;
      }} />}
  </section>;
}

/** One computer: how it is, its run (start, watch, stop), today's count and its schedule, and earlier runs. */
function BotPanel({ supabase, bot, runs, steps, now, zone, today, onSettings }: {
  supabase: SupabaseClient; bot: JobBot; runs: BotRun[]; steps: BotStep[]; now: number; zone: string; today: string; onSettings: () => void;
}) {
  const [cards, setCards] = useState(String(bot.schedule_cards || 20));
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const feed = useRef<HTMLOListElement>(null);
  const online = !!bot.seen_at && now - Date.parse(bot.seen_at) < ONLINE_MS;
  const current = runs.find(isOpen);
  const last = current ?? runs[0];
  const lines = last ? steps.filter(step => step.run_id === last.id) : [];
  const doneToday = runs.filter(run => run.started_at && partsIn(zone, run.started_at).day === today).reduce((sum, run) => sum + run.processed, 0);
  const at = (iso: string) => `${dayName(partsIn(zone, iso).day, today)} ${clockIn(zone, iso)}`;
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }); }, [lines.length]);

  const where = bot.computer ?? "the computer";
  const [status, tone] = !bot.seen_at
    ? ["Waiting for the computer: paste its code in Job Saving Bot, box 4 – KIASA.", "wait"]
    : !online
      ? [`Offline since ${ago(bot.seen_at, now, zone, today)}: ${where} is off, asleep, or Job Saving Bot is closed.`, "warn"]
      : bot.state === "sign_in"
        ? [`Jobright wants signing in again on ${where}. Sign in there (Chrome Remote Desktop works from anywhere), then press Start.`, "warn"]
        : bot.state === "setup" || bot.state === "error"
          ? [bot.detail ?? `Job Saving Bot needs a hand on ${where}.`, "warn"]
          : bot.state === "busy"
            ? [current?.state === "running" ? `Working: card ${Math.min(current.processed + 1, current.cards)} of ${current.cards}` : "Busy on the computer", "on"]
            : [`Online${bot.detail ? `. ${bot.detail}` : ", ready"}`, "on"];

  const start = async () => {
    const count = Math.round(Number(cards));
    if (!(count >= 1 && count <= 500)) return setProblem("Choose 1 to 500 cards.");
    setBusy(true);
    setProblem("");
    const { error } = await supabase.from("bot_runs").insert({ bot_id: bot.id, cards: count });
    setBusy(false);
    if (error) setProblem(error.code === "23505" ? "A run is already waiting or running." : "That did not start. Please try again.");
  };
  const stop = async (run: BotRun) => {
    const { error } = await supabase.from("bot_runs").update({ stop_asked: true }).eq("id", run.id);
    if (error) setProblem("That did not stop it. Please try again.");
  };

  return <div className="jobright-bot" data-online={online || undefined}>
    <div className="jobright-top">
      <p className="jobright-status" data-tone={tone} role="status"><span className="jobright-dot" aria-hidden="true" />{status}</p>
      <button type="button" className="chat-icon" aria-label={`Schedule and settings of ${bot.name}`} title="Schedule and settings" onClick={onSettings}><Gear /></button>
    </div>

    {current ? <div className="jobright-run">
      <div className="jobright-run-head">
        <span>{current.state === "waiting"
          ? online ? `Starting a run of ${plural(current.cards, "card")}…` : `A run of ${plural(current.cards, "card")} waits for ${where} to come online.`
          : `${ORIGINS[current.origin]}: ${current.processed} of ${plural(current.cards, "card")}`}</span>
        {current.stop_asked
          ? <span className="jobright-quiet">Stopping…</span>
          : <button type="button" className="chat-pill" data-danger="" onClick={() => void stop(current)}>Stop</button>}
      </div>
      <span className="jobs-bot-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (current.processed / current.cards) * 100)}%` }} /></span>
      <Counts run={current} />
    </div> : <div className="jobright-start">
      <label className="jobright-cards"><span>Cards</span>
        <input type="number" inputMode="numeric" min={1} max={500} value={cards} onChange={event => setCards(event.target.value)} aria-label="How many cards" />
      </label>
      <button type="button" className="chat-pill jobright-go" disabled={busy || !bot.seen_at} onClick={() => void start()}><Play /> {busy ? "Starting…" : "Start"}</button>
      {!online && bot.seen_at && <span className="jobright-quiet">It starts when {where} is back online.</span>}
    </div>}
    {problem && <p className="b-form-error" role="alert">{problem}</p>}

    {last && <div className="jobright-feed-box">
      <p className="jobright-feed-title">
        {isOpen(last) ? "Now" : `Last run · ${at(last.started_at ?? last.asked_at)} · ${ORIGINS[last.origin]} · ${ENDINGS[last.state]}`}
      </p>
      {!isOpen(last) && <Counts run={last} />}
      {!isOpen(last) && last.message && <p className="jobright-message">{last.message}</p>}
      {lines.length > 0 && <ol className="jobright-feed" ref={feed} aria-label="What the bot did">
        {lines.map(line => <li key={line.id} data-level={line.level}><time>{clockIn(zone, line.at)}</time><span>{line.text}</span></li>)}
      </ol>}
    </div>}

    <p className="jobright-foot">
      <span>Today: {doneToday} of {bot.daily_cap} cards</span>
      <span>{scheduleText(bot)}</span>
      {bot.version && <span>Version {bot.version}</span>}
    </p>

    {runs.length > 1 && <details className="jobright-earlier">
      <summary>Earlier runs</summary>
      <ul>
        {runs.filter(run => run.id !== last?.id).slice(0, 10).map(run => <li key={run.id}>
          <span>{at(run.started_at ?? run.asked_at)}</span>
          <span>{ORIGINS[run.origin]}</span>
          <span>{run.processed} of {plural(run.cards, "card")}</span>
          <span>{run.saved} saved</span>
          <span className="jobright-ending" data-state={run.state} title={run.message ?? undefined}>{ENDINGS[run.state]}</span>
        </li>)}
      </ul>
    </details>}
  </div>;
}

function Counts({ run }: { run: BotRun }) {
  return <p className="jobright-counts">
    <span data-kind="saved">Saved {run.saved}</span>
    <span data-kind="removed">Removed {run.removed}</span>
    <span data-kind="skipped">Skipped {run.skipped}</span>
    <span data-kind="failed">Failed {run.failed}</span>
  </p>;
}

/** The code, shown once, with what to do with it. */
function CodeDialog({ name, code, onClose }: { name: string; code: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const box = dialog.current; if (box && !box.open) box.showModal(); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };
  return <dialog ref={dialog} className="chat-dialog jobs-dialog" data-wide="" aria-label={`The code for ${name}`} onClose={onClose}>
    <p className="chat-dialog-title">The code for {name}</p>
    <ol className="jobright-steps">
      <li>On that computer, open <b>Job Saving Bot</b>.</li>
      <li>In box <b>4 – KIASA</b>, paste this code and press <b>Connect</b>.</li>
      <li>Tick <b>Start with Windows</b> there, so it is always ready.</li>
    </ol>
    <textarea className="jobright-code" readOnly value={code} rows={4} aria-label="Connection code" onFocus={event => event.currentTarget.select()} />
    <p className="jobs-form-hint">It is shown only now. Whoever has it can post jobs as this bot: send it to no one. Lost it? Make a new one under the bot&apos;s settings.</p>
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={() => void copy()}><Copy /> {copied ? "Copied" : "Copy the code"}</button>
      <button type="button" className="chat-dialog-button" onClick={onClose}>Done</button>
    </div>
  </dialog>;
}

/** A bot's name, its daily limit and its schedule; a new code, or disconnecting it. */
function SettingsDialog({ supabase, bot, onClose, onNewCode, onRemove }: {
  supabase: SupabaseClient; bot: JobBot; onClose: () => void; onNewCode: () => void; onRemove: () => void;
}) {
  const [scheduled, setScheduled] = useState(!!bot.schedule_at);
  return <FormDialog title={bot.name} action="Save" onClose={onClose} wide onSubmit={async form => {
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const days = DAYS.map((_, index) => index + 1).filter(day => form.get(`day-${day}`));
    const cap = Math.round(Number(text("cap")));
    const cards = Math.round(Number(text("cards")));
    if (!text("name")) return "Give it a name.";
    if (!(cap >= 1 && cap <= 1000)) return "The daily limit is 1 to 1000 cards.";
    if (scheduled && !(cards >= 1 && cards <= 500)) return "A scheduled run is 1 to 500 cards.";
    if (scheduled && !days.length) return "Choose at least one day.";
    if (scheduled && !/^\d{2}:\d{2}$/.test(text("at"))) return "Choose the time.";
    const { error } = await supabase.from("job_bots").update({
      name: text("name"), daily_cap: cap,
      schedule_at: scheduled ? text("at") : null,
      ...(scheduled ? { schedule_cards: cards, schedule_days: days } : {}),
    }).eq("id", bot.id);
    return error ? "That did not save. Please try again." : null;
  }}>
    <div className="jobs-form-pair">
      <label className="chat-field"><span>Name</span><input name="name" defaultValue={bot.name} maxLength={60} required /></label>
      <label className="chat-field"><span>Most cards a day</span><input name="cap" type="number" min={1} max={1000} defaultValue={bot.daily_cap} required /></label>
    </div>
    <p className="jobs-form-hint">A limit keeps the bot&apos;s pace like a person&apos;s, so Jobright has less reason to look twice.</p>
    <label className="chat-dialog-check"><input type="checkbox" checked={scheduled} onChange={event => setScheduled(event.target.checked)} /><span>Run on its own</span></label>
    {scheduled && <>
      <div className="jobs-form-pair">
        <label className="chat-field"><span>At (the team&apos;s time)</span><input name="at" type="time" defaultValue={bot.schedule_at?.slice(0, 5) ?? "08:00"} required /></label>
        <label className="chat-field"><span>Cards</span><input name="cards" type="number" min={1} max={500} defaultValue={bot.schedule_cards} required /></label>
      </div>
      <fieldset className="jobright-days">
        <legend>On</legend>
        {DAYS.map((label, index) => <label key={label}>
          <input type="checkbox" name={`day-${index + 1}`} defaultChecked={bot.schedule_days.includes(index + 1)} /><span>{label}</span>
        </label>)}
      </fieldset>
      <p className="jobs-form-hint">If the computer is off at that time, the run starts when it is back, the same day.</p>
    </>}
    <div className="jobright-danger">
      <button type="button" className="chat-pill" onClick={onNewCode}>New code</button>
      <button type="button" className="chat-pill" data-danger="" onClick={onRemove}>Disconnect</button>
    </div>
  </FormDialog>;
}
