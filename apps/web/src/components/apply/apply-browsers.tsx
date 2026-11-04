"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { Confirm } from "../chat/chat-dialog";
import { BROWSER_VERSION } from "./apply-setup";

type Agent = {
  id: string; owner: string; owner_name: string; name: string; computer: string | null; version: string | null;
  state: "new" | "idle" | "working" | "waiting" | "paused" | "error"; detail: string | null; seen_at: string | null; created_at: string;
};

const COLUMNS = "id, owner, owner_name, name, computer, version, state, detail, seen_at, created_at";
/** A browser checks in every few seconds; not heard from in a minute, it is off. */
const ONLINE_MS = 60_000;
/** How long the app has to show up after Start before the page suggests installing it. */
const ANSWER_MS = 20_000;
/** The link that opens the app on this PC, which its Setup registers. */
const APP_LINK = "kiasa-browser://start";
/** On the local test site it opens the local test build, because the real one only ever
 * connects to KIASA's own database. */
const appLink = () => window.location.hostname === "127.0.0.1" ? "kiasa-browser-local://start" : APP_LINK;
const STATES: Record<Agent["state"], string> = {
  new: "Not started yet", idle: "KIASA agent is running", working: "Applying", waiting: "Needs you", paused: "Paused", error: "Problem",
};

/** What opens the app with: where KIASA's database is, its public key (the one every
 * page has), and the browser's own secret. The member never sees it. */
function connectionCode(url: string, key: string, secret: string) {
  const packed = btoa(JSON.stringify({ u: url, k: key, s: secret })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `KIASA-APP1.${packed}`;
}

const timeNow = () => Date.now();

/** Whether a version is older than another, as in 1.2.0 and 1.10.0. Unknown ones are not. */
function isOlder(version: string | null, than: string) {
  const parts = (text: string) => text.split(".").map(Number);
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [a, b] = [parts(version), parts(than)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** Closing, the app says "paused" one last time, and nothing else says it yet. */
const isOn = (agent: Agent, now: number) => !!agent.seen_at && agent.state !== "paused" && now - new Date(agent.seen_at).getTime() < ONLINE_MS;

/** Which browser belongs to this PC is remembered here, so a member with two PCs has two. */
const pcKey = (me: string) => `kiasa-browser-id:${me}`;
const rememberedId = (me: string) => { try { return localStorage.getItem(pcKey(me)); } catch { return null; } };
const remember = (me: string, id: string) => { try { localStorage.setItem(pcKey(me), id); } catch { /* It then makes a new one next time. */ } };

function seenText(iso: string | null, now: number) {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

const put = (list: Agent[], row: Agent) => list.some(item => item.id === row.id) ? list.map(item => item.id === row.id ? row : item) : [...list, row];

/** One line for each computer: the same PC can have an older entry, from another Chrome profile. */
function latestByComputer(list: Agent[]) {
  const latest = new Map<string, Agent>();
  for (const agent of list) {
    const key = agent.computer ? `${agent.owner}|${agent.computer}` : agent.id;
    const best = latest.get(key);
    if (!best || (agent.seen_at ?? "") > (best.seen_at ?? "")) latest.set(key, agent);
  }
  return [...latest.values()];
}

/** Start the browser on this PC and see that it is on, live. Admins also see everyone's.
 * Working status only; no page is ever shown. */
export function ApplyBrowsers({ realtime, admin, me }: { realtime: { url: string; key: string }; admin: boolean; me: string }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pressedAt, setPressedAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Agent | null>(null);
  const reload = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let stopped = false;
    const load = reload.current = async () => {
      const { data } = await supabase.from("browser_agents").select(COLUMNS).order("created_at");
      if (!stopped) setAgents((data ?? []) as Agent[]);
    };
    const channel = supabase.channel(`browser-agents:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "browser_agents" }, payload => {
        if (payload.eventType === "DELETE") setAgents(list => list?.filter(item => item.id !== (payload.old as Agent).id) ?? list);
        else {
          const row = payload.new as Agent;
          // An admin sees everyone's; a member only their own (the database already filters).
          setAgents(list => put(list ?? [], row));
        }
      })
      // On joining, and on joining again after a drop: what happened meanwhile.
      .subscribe(status => { if (status === "SUBSCRIBED") void load(); });
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => { stopped = true; clearInterval(tick); void supabase.removeChannel(channel); };
  }, [supabase]);

  const mine = agents?.filter(agent => agent.owner === me) ?? [];
  const on = mine.filter(agent => isOn(agent, now));
  // Heard from since Start was pressed: it opened, even if it has been closed again.
  const answered = pressedAt !== null && mine.some(agent => !!agent.seen_at && new Date(agent.seen_at).getTime() >= pressedAt);
  const opening = pressedAt !== null && !answered && on.length === 0;
  const missing = opening && now - pressedAt > ANSWER_MS;
  // While it starts, the app says which step it is on; once open, it says nothing more.
  const starting = on.some(agent => agent.state === "idle" && !!agent.detail);
  const running = on.some(agent => agent.state !== "error");
  const agentRunning = running && !starting;
  const waiting = starting || (opening && !missing);
  const others = admin ? latestByComputer(agents?.filter(agent => agent.owner !== me) ?? []) : [];
  // Versions before 1.3.0 cannot update themselves, so this says what to do, once.
  const outdated = on.find(agent => isOlder(agent.version, "1.3.0") && isOlder(agent.version, BROWSER_VERSION));

  /** Opens the app with a new code for this PC's browser, so a member never handles
   * one. It can only be pressed while none of theirs is running. */
  const start = async () => {
    const clock = timeNow();
    setProblem(null);
    setNow(clock);
    setPressedAt(clock);
    let target = mine.find(agent => agent.id === rememberedId(me))?.id ?? null;
    let { data, error } = await supabase.rpc("browser_agent_connect", { agent_name: "My browser", existing: target });
    if (error?.code === "54000") {
      // The most a member may have: one that is off is used again.
      target = mine.find(agent => !isOn(agent, clock))?.id ?? null;
      if (target) ({ data, error } = await supabase.rpc("browser_agent_connect", { agent_name: "My browser", existing: target }));
    }
    if (error || typeof data !== "string") {
      setProblem("That did not work. Please try again.");
      setPressedAt(null);
      return;
    }
    const withCode = `${appLink()}?code=${encodeURIComponent(connectionCode(realtime.url, realtime.key, data))}`;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- it opens the app, not a page
    window.location.assign(withCode);
    if (!target) {
      const { data: newest } = await supabase.from("browser_agents").select("id").eq("owner", me).order("created_at", { ascending: false }).limit(1).maybeSingle();
      target = newest?.id ?? null;
    }
    if (target) remember(me, target);
    void reload.current();
  };

  /** An admin stops a member's agent. Their browser stays open, and finishes the job in hand. */
  const stopAgent = async (owner: string) => {
    const { error } = await supabase.from("apply_control").upsert({ user_id: owner, mode: "off" }, { onConflict: "user_id" });
    setProblem(error ? "That did not work. Please try again." : null);
  };

  return <section className="jobs-card apply-browsers" aria-labelledby="apply-browsers-title">
    <header className="jobs-card-head">
      <div>
        <h2 id="apply-browsers-title" className="jobs-card-title">Your browser</h2>
        <p className="jobs-card-sub" role="status">{agents === null ? "Loading…" : running ? "On" : on.length ? "Problem" : opening ? "Opening…" : "Off"}</p>
      </div>
      {agentRunning
        ? <button type="button" className="jobs-button" data-running="" disabled>KIASA agent is running</button>
        : <button type="button" className="jobs-button" data-primary="" disabled={agents === null || waiting} onClick={() => void start()}>{waiting ? "Opening…" : "Start the KIASA Browser"}</button>}
    </header>
    {on.length > 0 && <ul className="apply-list">{on.map(agent => <li key={agent.id} className="apply-row" data-state={agent.state}>
      <span className="apply-dot" aria-hidden="true" />
      <div className="apply-main">
        <p className="apply-name">{agent.computer ?? agent.name}</p>
        {/* Once open, the button above says it is running. */}
        {(agent.detail || agent.state !== "idle") && <p className="apply-detail">{agent.detail || STATES[agent.state]}</p>}
      </div>
    </li>)}</ul>}
    {problem && <p className="jobs-form-hint" role="alert">{problem}</p>}
    {outdated && <p className="jobs-form-hint" role="status">This browser is version {outdated.version}. Download the newest one with the steps above, just this once: from then on it updates by itself.</p>}
    {missing && <p className="jobs-form-hint" role="alert">Nothing opened? Install the newest KIASA Browser with the steps above, then press <b>Start the KIASA Browser</b> again. If Chrome asks to open it, choose <b>Open</b>.</p>}
    <p className="jobs-form-hint">KIASA admins can see whether your browser is on and what it is doing, but never your pages.</p>

    {admin && <>
      <h2 className="jobs-card-title apply-all-title">Everyone&apos;s browsers</h2>
      <p className="jobs-card-sub">{agents === null ? "Loading…" : others.length ? `${others.filter(agent => isOn(agent, now)).length} on, of ${others.length}` : "No one else has started a browser yet"}</p>
      {others.length > 0 && <ul className="apply-list">{others.map(agent => {
        const live = isOn(agent, now);
        return <li key={agent.id} className="apply-row" data-state={live ? agent.state : "offline"}>
          <span className="apply-dot" aria-hidden="true" />
          <div className="apply-main">
            <p className="apply-name">{agent.owner_name || agent.name}</p>
            <p className="apply-detail">{live ? agent.detail || STATES[agent.state] : agent.seen_at ? "Off" : "Not started yet"}</p>
            <p className="apply-meta">{[agent.computer, agent.version && `version ${agent.version}`, `seen ${seenText(agent.seen_at, now)}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="apply-actions">
            <button type="button" className="chat-pill" onClick={() => void stopAgent(agent.owner)}>Stop agent</button>
            <button type="button" className="chat-pill" onClick={() => setRemoving(agent)}>Disconnect</button>
          </div>
        </li>;
      })}</ul>}
    </>}

    {removing && <Confirm title={`Disconnect ${removing.owner_name || removing.name}'s browser?`} confirm="Disconnect"
      text="If it is open, it closes on that PC, and it leaves this list. It comes back the next time they press Start."
      onClose={() => setRemoving(null)} onConfirm={async () => {
        const { error } = await supabase.from("browser_agents").delete().eq("id", removing.id);
        if (error) return "That did not work. Please try again.";
        setAgents(list => list?.filter(item => item.id !== removing.id) ?? list);
        return null;
      }} />}
  </section>;
}
