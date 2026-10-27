"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJobs, type JobReading } from "@/lib/jobs/actions";
import { parseLinks } from "@/lib/jobs/links";
import { LeafMark } from "../site/brand";
import { Send } from "../site/icons";
import { Confirm } from "../chat/chat-dialog";
import { linkLabel } from "./jobs-format";

/** One paste, and what the bot did with it. */
type Run = {
  id: string; found: number; skipped: number;
  state: "empty" | "saving" | "reading" | "done" | "failed";
  saved: { id: string; url: string }[]; again: number;
  readings: JobReading[]; undone: boolean;
};

// The bot's work lives here, not in the page's tab: it goes on, and is still
// there, when the admin looks at another tab and comes back.
let runs: Run[] = [];
const NONE: Run[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const tell = (next: Run[]) => { runs = next; for (const listener of listeners) listener(); };
const change = (id: string, edit: (run: Run) => Partial<Run>) => tell(runs.map(run => run.id === id ? { ...run, ...edit(run) } : run));

/** A paste: every link in it saved at once (each link once), then each page
 * read for its title, company and place, thirty at a time. */
async function work(supabase: SupabaseClient, text: string, onPosted: () => void) {
  const { jobs, skipped } = parseLinks(text);
  const id = crypto.randomUUID();
  const run: Run = { id, found: jobs.length, skipped, state: jobs.length ? "saving" : "empty", saved: [], again: 0, readings: [], undone: false };
  tell([...runs, run]);
  if (!jobs.length) return;
  const { data, error } = await supabase.from("jobs")
    .upsert(jobs.map(job => ({ url: job.url, title: job.title, company: job.company })), { onConflict: "url", ignoreDuplicates: true })
    .select("id, url");
  if (error) return change(id, () => ({ state: "failed" }));
  const saved = (data ?? []) as { id: string; url: string }[];
  change(id, () => ({ state: saved.length ? "reading" : "done", saved, again: jobs.length - saved.length }));
  onPosted();
  for (let at = 0; at < saved.length; at += 30) {
    const batch = saved.slice(at, at + 30).map(job => job.id);
    const readings = await readJobs(batch).catch(() => batch.map(job => ({ id: job, title: null, company: null, location: null, read: false })));
    change(id, current => ({ readings: [...current.readings, ...readings] }));
  }
  change(id, () => ({ state: "done" }));
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function Says({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return <div className="jobs-bot-says" data-tone={tone}>{children}</div>;
}

/** The jobs bot: the admins paste the day's links, in any text, and it saves
 * them at once, with no button, then reads each posting and says how it went. */
export function JobsBot({ supabase, onPosted }: { supabase: SupabaseClient; onPosted: () => void }) {
  const all = useSyncExternalStore(subscribe, () => runs, () => NONE);
  const [text, setText] = useState("");
  const [undoing, setUndoing] = useState<Run | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [all]);

  const working = all.find(run => run.state === "saving" || run.state === "reading");
  const send = (value: string) => {
    if (!value.trim()) return;
    setText("");
    void work(supabase, value, onPosted);
  };
  // Links pasted are saved at once; anything else waits for Enter.
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const value = event.clipboardData.getData("text/plain");
    if (!/https?:\/\//i.test(value)) return;
    event.preventDefault();
    send(text.trim() ? `${text}\n${value}` : value);
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
          {working ? working.state === "saving" ? "Saving…" : `Reading the postings: ${working.readings.length} of ${working.saved.length}` : "Ready for links"}
        </p>
      </div>
    </header>
    <div className="jobs-bot-log" ref={log} role="log" aria-label="What the jobs bot did">
      <Says>Paste the day&apos;s job links here, as many as you have, in any text: I save each one at once and read its page for the title, company and place. Members see them the moment they are saved.</Says>
      {all.map(run => <RunView key={run.id} run={run} onUndo={() => setUndoing(run)} />)}
    </div>
    <div className="jobs-bot-input">
      <textarea value={text} onChange={event => setText(event.target.value)} onPaste={paste} onKeyDown={keys} rows={1}
        aria-label="Paste job links" placeholder="Paste job links: they are saved at once" />
      <button type="button" className="chat-send" aria-label="Send" title="Send" aria-disabled={!text.trim() || undefined} onClick={() => send(text)}><Send /></button>
    </div>
    {undoing && <Confirm title={`Take back ${plural(undoing.saved.length, "job")}?`} confirm="Take them back"
      text="They leave everyone's list, with anything the team has marked on them."
      onClose={() => setUndoing(null)} onConfirm={async () => {
        const { error } = await supabase.from("jobs").delete().in("id", undoing.saved.map(job => job.id));
        if (error) return "That did not work. Please try again.";
        change(undoing.id, () => ({ undone: true }));
        return null;
      }} />}
  </section>;
}

function RunView({ run, onUndo }: { run: Run; onUndo: () => void }) {
  const read = run.readings.filter(reading => reading.read);
  const missed = run.readings.filter(reading => !reading.read);
  const url = (id: string) => run.saved.find(job => job.id === id)?.url ?? "";
  const line = (reading: JobReading) => [reading.title ?? linkLabel(url(reading.id)), reading.company, reading.location].filter(Boolean).join(" · ");
  return <>
    <p className="jobs-bot-you">{run.found ? `${plural(run.found, "link")} pasted` : "Pasted"}{run.skipped ? ` · ${plural(run.skipped, "line")} without one` : ""}</p>
    {run.state === "empty" && <Says tone="warn">I found no link in that. Paste the job links themselves (https://…).</Says>}
    {run.state === "failed" && <Says tone="warn">The jobs could not be saved. Please paste them again.</Says>}
    {run.state === "saving" && <Says><span className="jobs-bot-dots" aria-hidden="true" /> Saving {plural(run.found, "job")}…</Says>}
    {(run.state === "reading" || run.state === "done") && (run.undone
      ? <Says>Taken back: those {plural(run.saved.length, "job")} left the list.</Says>
      : run.saved.length
        ? <Says>
          <span>Saved <strong>{plural(run.saved.length, "job")}</strong> for today{run.again ? `; ${run.again} already on the list, left out` : ""}. Members see them now.</span>
          <button type="button" className="jobs-link jobs-bot-undo" onClick={onUndo}>Undo</button>
        </Says>
        : <Says>{run.again === 1 ? "That one is" : `All ${run.again} are`} already on the list: nothing new to save.</Says>)}
    {run.saved.length > 0 && !run.undone && <Says>
      <span className="jobs-bot-reading">
        {run.state === "reading"
          ? <>Reading the postings: {run.readings.length} of {run.saved.length}</>
          : <>Done: {plural(read.length, "job")} named{missed.length ? `; ${plural(missed.length, "page")} I could not read (the site would not say), so ${missed.length === 1 ? "that job is" : "those jobs are"} on the list with just ${missed.length === 1 ? "its" : "their"} link: name ${missed.length === 1 ? "it" : "them"} with ✎.` : "."}</>}
      </span>
      <span className="jobs-bot-bar" aria-hidden="true"><span style={{ width: `${(run.readings.length / run.saved.length) * 100}%` }} /></span>
      <ul className="jobs-bot-items">
        {(run.state === "reading" ? run.readings.slice(-5) : missed.slice(0, 8)).map(reading =>
          <li key={reading.id} data-read={reading.read || undefined}><span aria-hidden="true">{reading.read ? "✓" : "!"}</span>{line(reading)}</li>)}
      </ul>
    </Says>}
  </>;
}
