"use client";

import { useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";

type Health = {
  ollama?: boolean; model?: string; installed?: boolean; loaded?: boolean; on_gpu?: number;
  answered?: number; failed?: number; average_seconds?: number;
  last_answer_seconds_ago?: number | null; last_failure_seconds_ago?: number | null;
};
type Person = { member: string; name: string; seconds_ago: number; requests: number };
type Status = { on: boolean; seen_at: string | null; waiting: number; health: Health; people: Person[] };
type Browser = { id: string; owner: string; owner_name: string; name: string; computer: string | null; version: string | null; state: string; seen_at: string | null };

const POLL_MS = 10_000;
/** A browser checks in every few seconds; not heard from in a minute, it is off. */
const ONLINE_MS = 60_000;
/** A failure this recent, with no answer since, is worth an admin's attention. */
const FAILURE_MATTERS_SECONDS = 600;

const timeNow = () => Date.now();

function ago(seconds: number | null | undefined) {
  if (seconds == null) return "never";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
}

/** One word for how the model is, and what to do about it if anything. */
function verdict(status: Status): { key: string; title: string; text: string } {
  const { health } = status;
  if (!status.on) return { key: "off", title: "Off", text: "The model server is not running on its PC. Browsers wait until it is back." };
  if (!health.ollama) return { key: "bad", title: "Ollama is not running", text: "The model server is on, but it cannot reach Ollama on its PC." };
  if (!health.installed) return { key: "bad", title: "The model is not installed", text: `Ollama does not have ${health.model ?? "the model"}. Pull it on the model server's PC.` };
  const failedLately = (health.last_failure_seconds_ago ?? Infinity) < FAILURE_MATTERS_SECONDS;
  const answeredSince = (health.last_answer_seconds_ago ?? Infinity) < (health.last_failure_seconds_ago ?? Infinity);
  if (failedLately && !answeredSince) return { key: "bad", title: "Having trouble", text: `The model failed to answer ${ago(health.last_failure_seconds_ago)}.` };
  return { key: "good", title: "Healthy", text: health.loaded ? `${health.model} is loaded${health.on_gpu != null ? `, ${health.on_gpu}% on the GPU` : ""}.` : `${health.model} is ready, and loads with the next question.` };
}

/** How the model is, and whose browsers are connected to it, by name. For admins only: the
 * database refuses this to anyone else. Only who and how many: no question or answer is shown,
 * or kept. */
export function ModelDesk({ realtime }: { realtime: { url: string; key: string } }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [status, setStatus] = useState<Status | null>(null);
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const [model, agents] = await Promise.all([
        supabase.rpc("model_server_admin_status"),
        supabase.from("browser_agents").select("id, owner, owner_name, name, computer, version, state, seen_at"),
      ]);
      if (stopped) return;
      setFailed(!!model.error);
      if (!model.error && model.data) setStatus(model.data as Status);
      setBrowsers((agents.data ?? []) as Browser[]);
      setNow(timeNow());
    };
    void load();
    const tick = setInterval(() => void load(), POLL_MS);
    return () => { stopped = true; clearInterval(tick); };
  }, [supabase]);

  const isOn = (browser: Browser) => !!browser.seen_at && browser.state !== "paused" && now - new Date(browser.seen_at).getTime() < ONLINE_MS;
  const online = browsers.filter(isOn);
  const computerOf = (member: string) => online.find(browser => browser.owner === member)?.computer ?? browsers.find(browser => browser.owner === member)?.computer ?? null;
  const connected = status?.people ?? [];
  const here = new Set(connected.map(person => person.member));
  // One line for each member: someone may have a browser on two computers.
  const notConnected = [...new Map(online.filter(browser => !here.has(browser.owner)).map(browser => [browser.owner, browser])).values()];
  const state = status && verdict(status);
  const health = status?.health ?? {};

  return <div className="wrap wrap-wide model-desk">
    <h1 className="model-title">Model server</h1>
    {failed && <p className="admin-notice" data-failed="" role="alert">This could not be read. It may be that the database script for it has not been run yet.</p>}

    <section className="model-card" aria-labelledby="model-health-title">
      <h2 id="model-health-title" className="model-card-title">The model</h2>
      {!state ? <p className="model-note" role="status">{failed ? "Not available." : "Loading…"}</p> : <>
        <p className="model-state" data-state={state.key} role="status"><span className="model-dot" aria-hidden="true" />{state.title}</p>
        <p className="model-note">{state.text}</p>
        {status?.on && <dl className="model-facts">
          <div><dt>Model</dt><dd>{health.model ?? "Not known"}</dd></div>
          <div><dt>Waiting now</dt><dd>{status.waiting}</dd></div>
          <div><dt>Jobs answered</dt><dd>{health.answered ?? 0}</dd></div>
          <div><dt>Average time</dt><dd>{health.average_seconds ? `${health.average_seconds} s a job` : "No answers yet"}</dd></div>
          <div><dt>Last answer</dt><dd>{ago(health.last_answer_seconds_ago)}</dd></div>
          <div><dt>Failures</dt><dd>{health.failed ?? 0}</dd></div>
        </dl>}
        <p className="model-note">Numbers count from when the model server last started.</p>
      </>}
    </section>

    <section className="model-card" aria-labelledby="model-people-title">
      <h2 id="model-people-title" className="model-card-title">Connected browsers <span>{connected.length}</span></h2>
      {connected.length === 0
        ? <p className="model-note">{status?.on ? "No browser is connected to the model right now." : "None, because the model server is off."}</p>
        : <ul className="model-list">{connected.map(person => <li key={person.member} className="model-row" data-state="good">
            <span className="model-dot" aria-hidden="true" />
            <div className="model-row-main">
              <p className="model-name">{person.name}</p>
              <p className="model-note">{[computerOf(person.member), `heard from ${ago(person.seconds_ago)}`, `${person.requests} ${person.requests === 1 ? "job" : "jobs"} answered`].filter(Boolean).join(" · ")}</p>
            </div>
          </li>)}</ul>}

      {notConnected.length > 0 && <>
        <h3 className="model-subtitle">Browser on, not connected</h3>
        <p className="model-note">These browsers are open but have not reached the model server. They wait until they can.</p>
        <ul className="model-list">{notConnected.map(browser => <li key={browser.owner} className="model-row" data-state="off">
          <span className="model-dot" aria-hidden="true" />
          <div className="model-row-main">
            <p className="model-name">{browser.owner_name || browser.name}</p>
            <p className="model-note">{[browser.computer, browser.version && `version ${browser.version}`].filter(Boolean).join(" · ")}</p>
          </div>
        </li>)}</ul>
      </>}
    </section>
  </div>;
}
