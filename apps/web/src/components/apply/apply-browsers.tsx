"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { Confirm } from "../chat/chat-dialog";
import { FormDialog } from "../jobs/jobs-dialogs";
import { Copy, Plus } from "../site/icons";

type Agent = {
  id: string; owner: string; owner_name: string; name: string; computer: string | null; version: string | null;
  state: "new" | "idle" | "working" | "waiting" | "paused" | "error"; detail: string | null; seen_at: string | null; created_at: string;
};

const COLUMNS = "id, owner, owner_name, name, computer, version, state, detail, seen_at, created_at";
/** A browser checks in every few seconds; not heard from in a minute, it is offline. */
const ONLINE_MS = 60_000;
const STATES: Record<Agent["state"], string> = {
  new: "Not started yet", idle: "Ready", working: "Applying", waiting: "Needs you", paused: "Paused", error: "Problem",
};

/** The code a browser is connected with: where KIASA's database is, its public
 * key (the one every page has), and the browser's own secret. */
function connectionCode(url: string, key: string, secret: string) {
  const packed = btoa(JSON.stringify({ u: url, k: key, s: secret })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `KIASA-APP1.${packed}`;
}

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

/** The KIASA Browsers connected to this account, live: yours, or, for an admin,
 * everyone's. Working status only; no page is ever shown. */
export function ApplyBrowsers({ realtime, admin, me }: { realtime: { url: string; key: string }; admin: boolean; me: string }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [naming, setNaming] = useState(false);
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const [rekeying, setRekeying] = useState<Agent | null>(null);
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

  const connect = async (name: string, existing: string | null) => {
    const { data, error } = await supabase.rpc("browser_agent_connect", { agent_name: name, existing });
    if (error || typeof data !== "string") return error?.code === "54000" ? "Ten browsers are connected already. Remove one first." : "That did not work. Please try again.";
    setCode({ name, code: connectionCode(realtime.url, realtime.key, data) });
    void reload.current();
    return null;
  };

  const mine = agents?.filter(agent => agent.owner === me) ?? [];
  const others = admin ? agents?.filter(agent => agent.owner !== me) ?? [] : [];
  const online = (agent: Agent) => !!agent.seen_at && now - new Date(agent.seen_at).getTime() < ONLINE_MS;
  const row = (agent: Agent, showOwner: boolean, editable: boolean) => {
    const live = online(agent);
    const state = live ? agent.state : "offline";
    return <li key={agent.id} className="apply-row" data-state={state}>
      <span className="apply-dot" aria-hidden="true" />
      <div className="apply-main">
        <p className="apply-name">{agent.name}{showOwner && agent.owner_name && <span className="apply-owner"> · {agent.owner_name}</span>}</p>
        <p className="apply-detail">
          {live ? STATES[agent.state] : agent.state === "new" ? "Waiting for the browser to connect" : "Offline"}
          {live && agent.detail ? ` · ${agent.detail}` : ""}
        </p>
        <p className="apply-meta">{[agent.computer, agent.version && `version ${agent.version}`, `seen ${seenText(agent.seen_at, now)}`].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="apply-actions">
        {editable && <button type="button" className="chat-pill" onClick={() => setRekeying(agent)}>New code</button>}
        <button type="button" className="chat-pill" onClick={() => setRemoving(agent)}>Disconnect</button>
      </div>
    </li>;
  };

  return <section className="jobs-card apply-browsers" aria-labelledby="apply-browsers-title">
    <header className="jobs-card-head">
      <div>
        <h2 id="apply-browsers-title" className="jobs-card-title">Your browsers</h2>
        <p className="jobs-card-sub">{agents === null ? "Loading…" : mine.length ? `${mine.length} connected` : "None connected yet"}</p>
      </div>
      <button type="button" className="chat-pill" onClick={() => setNaming(true)}><Plus /> Connect this PC</button>
    </header>
    {agents && mine.length === 0 && <p className="jobs-form-hint">After you install the KIASA Browser, press <b>Connect this PC</b> to get a code, and paste it in the browser&apos;s settings. It then shows here, live.</p>}
    {mine.length > 0 && <ul className="apply-list">{mine.map(agent => row(agent, false, true))}</ul>}

    {admin && <>
      <h2 className="jobs-card-title apply-all-title">Everyone&apos;s browsers</h2>
      <p className="jobs-card-sub">{agents === null ? "Loading…" : others.length ? `${others.filter(online).length} online of ${others.length}` : "No one else has connected a browser yet"}</p>
      {others.length > 0 && <ul className="apply-list">{others.map(agent => row(agent, true, false))}</ul>}
    </>}

    {naming && <FormDialog title="Connect this PC" action="Make its code" busyAction="Making…" onClose={() => setNaming(false)} onSubmit={async form => {
      const name = String(form.get("name") ?? "").trim();
      if (!name) return "Give it a name, such as Home laptop.";
      return connect(name, null);
    }}>
      <label className="chat-field"><span>Name</span><input name="name" maxLength={60} placeholder="Home laptop" required /></label>
      <p className="jobs-form-hint">Next you get a code to paste in the KIASA Browser on that PC.</p>
    </FormDialog>}
    {code && <CodeDialog name={code.name} code={code.code} onClose={() => setCode(null)} />}
    {rekeying && <Confirm title={`A new code for ${rekeying.name}?`} confirm="Make a new code"
      text="The code it has now stops working at once. Paste the new one in the KIASA Browser's settings on that PC."
      onClose={() => setRekeying(null)} onConfirm={() => connect(rekeying.name, rekeying.id)} />}
    {removing && <Confirm title={`Disconnect ${removing.name}?`} confirm="Disconnect"
      text="Its code stops working and it leaves this list. You can connect the PC again with a new code."
      onClose={() => setRemoving(null)} onConfirm={async () => {
        const { error } = await supabase.from("browser_agents").delete().eq("id", removing.id);
        if (error) return "That did not work. Please try again.";
        setAgents(list => list?.filter(item => item.id !== removing.id) ?? list);
        return null;
      }} />}
  </section>;
}

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
      <li>On that PC, open the <b>KIASA Browser</b> settings.</li>
      <li>Paste this code in <b>KIASA connection</b> and press <b>Save</b>.</li>
    </ol>
    <textarea className="jobright-code" readOnly value={code} rows={4} aria-label="Connection code" onFocus={event => event.currentTarget.select()} />
    <p className="jobs-form-hint">It is shown only now. Whoever has it can report as this browser: send it to no one. Lost it? Make a new one.</p>
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={() => void copy()}><Copy /> {copied ? "Copied" : "Copy the code"}</button>
      <button type="button" className="chat-dialog-button" onClick={onClose}>Done</button>
    </div>
  </dialog>;
}
