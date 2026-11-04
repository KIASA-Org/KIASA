"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyFromLink, parseLinks } from "@/lib/jobs/links";
import type { JobBot } from "@/lib/jobs/types";
import { LeafMark } from "../site/brand";
import { Close, Send } from "../site/icons";
import { Confirm } from "../chat/chat-dialog";
import { linkLabel } from "./jobs-format";

/** One paste (links saved, nothing more) or one Send (links handed to the
 * Jobright bot, whose browser reads each one), and how it went. */
type Run = {
  id: string; mode: "paste" | "send"; found: number; skipped: number;
  state: "empty" | "saving" | "saved" | "failed";
  links: { id: string; url: string }[]; saved: string[]; again: number; undone: boolean;
};
/** A link waiting for the Jobright bot, or read by it. */
type Read = { job_id: string; state: "waiting" | "reading" | "done" | "failed"; found: string | null; message: string | null; ended_at: string | null };
type Bot = Pick<JobBot, "id" | "name" | "computer" | "version" | "state" | "seen_at">;

const READ_COLUMNS = "job_id, state, found, message, ended_at";
/** A bot checks in every few seconds; not heard from in a minute, it is offline. */
const ONLINE_MS = 60_000;

// The bot's work lives here, not in the page's tab: it goes on, and is still
// there, when the admin looks at another tab and comes back.
let runs: Run[] = [];
let reads: Record<string, Read> = {};
const NO_RUNS: Run[] = [];
const NO_READS: Record<string, Read> = {};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const announce = () => { for (const listener of listeners) listener(); };
const tell = (next: Run[]) => { runs = next; announce(); };
const tellReads = (next: Record<string, Read>) => { reads = next; announce(); };
const change = (id: string, edit: Partial<Run>) => tell(runs.map(run => run.id === id ? { ...run, ...edit } : run));

const begin = (mode: Run["mode"], found: number, skipped: number) => {
  const run: Run = { id: crypto.randomUUID(), mode, found, skipped, state: found ? "saving" : "empty", links: [], saved: [], again: 0, undone: false };
  tell([...runs, run]);
  return run.id;
};

/** A paste: every link in it saved at once (each link once), as it is. Nothing
 * is read until the admin presses Send. */
async function save(supabase: SupabaseClient, text: string, onPosted: () => void) {
  const { jobs, skipped } = parseLinks(text);
  const id = begin("paste", jobs.length, skipped);
  if (!jobs.length) return;
  const { data, error } = await supabase.from("jobs")
    .upsert(jobs.map(job => ({ url: job.url, title: job.title, company: job.company })), { onConflict: "url", ignoreDuplicates: true })
    .select("id, url");
  if (error) return change(id, { state: "failed" });
  const links = (data ?? []) as { id: string; url: string }[];
  change(id, { state: "saved", links, saved: links.map(job => job.id), again: jobs.length - links.length });
  onPosted();
}

/** Send: the links (saved first, those not yet on the list) go to the Jobright
 * bot, whose browser reads each one. False when they did not get there. */
async function sendToBot(supabase: SupabaseClient, text: string, onPosted: () => void) {
  const { jobs, skipped } = parseLinks(text);
  const id = begin("send", jobs.length, skipped);
  if (!jobs.length) return true;
  const { data, error } = await supabase.rpc("jobs_ask_bot", {
    links: jobs.map(job => ({ ...job, keep_company: !!job.company && job.company !== companyFromLink(job.url) })),
  });
  if (error) { change(id, { state: "failed" }); return false; }
  const links = (data ?? []) as { id: string; url: string; fresh: boolean }[];
  tellReads({ ...reads, ...Object.fromEntries(links.map(job => [job.id, { job_id: job.id, state: "waiting" as const, found: null, message: null, ended_at: null }])) });
  change(id, { state: "saved", links, saved: links.filter(job => job.fresh).map(job => job.id) });
  onPosted();
  return true;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const ended = (read: Read) => read.state === "done" || read.state === "failed";
/** Reading links came with Job Saving Bot 1.4.0. */
const canRead = (version: string | null) => {
  const [major, minor] = (version ?? "").split(".").map(Number);
  return major > 1 || (major === 1 && minor >= 3);
};

/** Why links are still waiting: what the Jobright bot is doing, in a sentence. */
function waitingWord(bots: Bot[] | null, now: number) {
  if (!bots) return "Waiting for the Jobright bot…";
  if (!bots.length) return "No Jobright bot is connected yet. Connect one below: these links wait for it.";
  const online = bots.filter(bot => bot.seen_at && now - new Date(bot.seen_at).getTime() < ONLINE_MS);
  if (!online.length) return "The Jobright bot is offline. These links wait, and it reads them when its computer is back.";
  const able = online.filter(bot => canRead(bot.version));
  if (!able.length) return `The Jobright bot on ${online[0].computer ?? online[0].name} is version ${online[0].version ?? "?"} and cannot read links yet. Restart it on that computer: these links wait for it.`;
  if (able.every(bot => bot.state === "setup")) return "The Job Intelligence extension needs a hand on the bot's computer. These links wait until then.";
  if (able.every(bot => bot.state === "busy")) return "The Jobright bot is on a run. It reads these links as soon as it ends.";
  return "The Jobright bot takes them in a few seconds…";
}

function Says({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return <div className="jobs-bot-says" data-tone={tone}>{children}</div>;
}

/** The jobs bot: a paste saves the links at once, with no button, just as links.
 * Send hands what is in the box to the Jobright bot, whose browser reads each
 * link for its job description, company and details. */
export function JobsBot({ supabase, onPosted }: { supabase: SupabaseClient; onPosted: () => void }) {
  const all = useSyncExternalStore(subscribe, () => runs, () => NO_RUNS);
  const live = useSyncExternalStore(subscribe, () => reads, () => NO_READS);
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [text, setText] = useState("");
  const [undoing, setUndoing] = useState<Run | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [all, live]);

  // The reads and the bots, live; on joining (and joining again): what happened meanwhile.
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const [asked, found] = await Promise.all([
        supabase.from("job_reads").select(READ_COLUMNS).order("asked_at", { ascending: false }).limit(600),
        supabase.from("job_bots").select("id, name, computer, version, state, seen_at").order("created_at"),
      ]);
      if (stopped) return;
      tellReads(Object.fromEntries(((asked.data ?? []) as Read[]).map(read => [read.job_id, read])));
      setBots((found.data ?? []) as Bot[]);
    };
    const channel = supabase.channel(`job-reads:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_reads" }, payload => {
        if (payload.eventType === "DELETE") {
          const next = { ...reads };
          delete next[(payload.old as Read).job_id];
          tellReads(next);
        } else {
          const read = payload.new as Read;
          tellReads({ ...reads, [read.job_id]: read });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "job_bots" }, payload => {
        if (payload.eventType === "DELETE") setBots(list => list?.filter(bot => bot.id !== (payload.old as Bot).id) ?? list);
        else {
          const bot = payload.new as Bot;
          setBots(list => list?.some(item => item.id === bot.id) ? list.map(item => item.id === bot.id ? bot : item) : [...(list ?? []), bot]);
        }
      })
      .subscribe(status => { if (status === "SUBSCRIBED") void load(); });
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => { stopped = true; clearInterval(tick); void supabase.removeChannel(channel); };
  }, [supabase]);

  const saving = all.some(run => run.state === "saving");
  const open = Object.values(live).filter(read => !ended(read)).length;
  const send = (value: string) => {
    if (!value.trim()) return;
    setText("");
    void sendToBot(supabase, value, onPosted).then(sent => { if (!sent) setText(current => current || value); });
  };
  // Links pasted are saved at once, and stay in the box for Send.
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const value = event.clipboardData.getData("text/plain");
    if (!/https?:\/\//i.test(value)) return;
    event.preventDefault();
    setText(current => current.trim() ? `${current}\n${value}` : value);
    void save(supabase, value, onPosted);
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(text); }
  };

  return <section className="jobs-card jobs-bot" aria-labelledby="jobs-bot-title">
    <header className="jobs-bot-head">
      <span className="jobs-bot-face" aria-hidden="true"><LeafMark weight={2.4} /></span>
      <div>
        <h2 id="jobs-bot-title" className="jobs-card-title">Jobs bot</h2>
        <p className="jobs-card-sub" role="status">
          {saving ? "Saving…" : open ? `Jobright bot: ${plural(open, "link")} left to read` : "Ready for links"}
        </p>
      </div>
    </header>
    <div className="jobs-bot-log" ref={log} role="log" aria-label="What the jobs bot did">
      <Says>Paste job links here, as many as you have: I save each one at once, just the link. Press Send, and the Jobright bot opens each link in its browser and saves the job description, company and details.</Says>
      {all.map(run => <RunView key={run.id} run={run} reads={live} waiting={waitingWord(bots, now)} onUndo={() => setUndoing(run)} />)}
    </div>
    <div className="jobs-bot-input">
      <textarea value={text} onChange={event => setText(event.target.value)} onPaste={paste} onKeyDown={keys} rows={Math.min(4, text.split("\n").length)}
        aria-label="Job links" placeholder="Paste job links to save them, then Send to have the bot read them" />
      {text && <button type="button" className="chat-icon" aria-label="Clear the box" title="Clear the box" onClick={() => setText("")}><Close /></button>}
      <button type="button" className="chat-send" aria-label="Send to the Jobright bot" title="Send to the Jobright bot" aria-disabled={!text.trim() || undefined} onClick={() => send(text)}><Send /></button>
    </div>
    {undoing && <Confirm title={`Take back ${plural(undoing.saved.length, "job")}?`} confirm="Take them back"
      text="They leave everyone's list, with anything the team has marked on them."
      onClose={() => setUndoing(null)} onConfirm={async () => {
        const { error } = await supabase.from("jobs").delete().in("id", undoing.saved);
        if (error) return "That did not work. Please try again.";
        change(undoing.id, { undone: true });
        if (undoing.mode === "paste") setText("");
        return null;
      }} />}
  </section>;
}

function RunView({ run, reads: live, waiting, onUndo }: { run: Run; reads: Record<string, Read>; waiting: string; onUndo: () => void }) {
  const sent = run.mode === "send";
  const label = (read: Read) => read.found ?? linkLabel(run.links.find(job => job.id === read.job_id)?.url ?? "");
  // A read that is gone was taken back with its job.
  const mine = sent ? run.links.map(job => live[job.id]).filter((read): read is Read => !!read) : [];
  const finished = mine.filter(ended).sort((a, b) => (a.ended_at ?? "").localeCompare(b.ended_at ?? ""));
  const missed = finished.filter(read => read.state === "failed");
  const started = mine.some(read => read.state === "reading") || finished.length > 0;
  const allDone = mine.length > 0 && finished.length === mine.length;
  return <>
    <p className="jobs-bot-you">{run.found ? `${plural(run.found, "link")} ${sent ? "sent to the Jobright bot" : "pasted"}` : sent ? "Sent" : "Pasted"}{run.skipped ? ` · ${plural(run.skipped, "line")} without one` : ""}</p>
    {run.state === "empty" && <Says tone="warn">I found no link in that. Paste the job links themselves (https://…).</Says>}
    {run.state === "failed" && <Says tone="warn">{sent ? "The links could not be sent. They are back in the box: please press Send again." : "The jobs could not be saved. Please paste them again."}</Says>}
    {run.state === "saving" && <Says><span className="jobs-bot-dots" aria-hidden="true" /> {sent ? `Sending ${plural(run.found, "link")}…` : `Saving ${plural(run.found, "job")}…`}</Says>}
    {run.state === "saved" && (run.undone
      ? <Says>Taken back: those {plural(run.saved.length, "job")} left the list.</Says>
      : run.saved.length
        ? <Says>
          <span>Saved <strong>{plural(run.saved.length, "job")}</strong> for today{run.again ? `; ${run.again} already on the list, left out` : ""}.{sent ? "" : " Just the links for now: press Send and the Jobright bot reads them."}</span>
          <button type="button" className="jobs-link jobs-bot-undo" onClick={onUndo}>Undo</button>
        </Says>
        : !sent && <Says>{run.again === 1 ? "That one is" : `All ${run.again} are`} already on the list: nothing new to save.</Says>)}
    {sent && run.state === "saved" && !run.undone && mine.length > 0 && <Says>
      <span className="jobs-bot-reading">
        {allDone
          ? <>Done: {plural(mine.length - missed.length, "job")} read, with job description and company{missed.length ? `; ${plural(missed.length, "link")} I could not read, so ${missed.length === 1 ? "that job keeps" : "those jobs keep"} what ${missed.length === 1 ? "it has" : "they have"}: name ${missed.length === 1 ? "it" : "them"} with ✎, or send again.` : "."}</>
          : started
            ? <>The Jobright bot is reading the links: {finished.length} of {mine.length}</>
            : waiting}
      </span>
      <span className="jobs-bot-bar" aria-hidden="true"><span style={{ width: `${(finished.length / mine.length) * 100}%` }} /></span>
      <ul className="jobs-bot-items">
        {(allDone ? missed.slice(0, 8) : finished.slice(-5)).map(read =>
          <li key={read.job_id} data-read={read.state === "done" || undefined} title={read.message ?? undefined}><span aria-hidden="true">{read.state === "done" ? "✓" : "!"}</span>{[label(read), read.state === "failed" ? read.message : null].filter(Boolean).join(": ")}</li>)}
      </ul>
    </Says>}
  </>;
}
