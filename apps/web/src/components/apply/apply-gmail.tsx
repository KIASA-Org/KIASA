"use client";

import { useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";

type State = { email: string | null; connected_at: string | null; want_connect: boolean; want_disconnect: boolean };

/** Lets a member connect their own Gmail so the agent can read a verification code when a form
 * emails one to finish applying. Read-only: the agent can only read mail, never send or change it.
 * The member presses Connect here; their KIASA Browser opens Google's Allow page on their PC. */
export function ApplyGmail({ realtime, me }: { realtime: { url: string; key: string }; me: string }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [state, setState] = useState<State | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const { data } = await supabase.from("apply_gmail").select("email, connected_at, want_connect, want_disconnect").eq("user_id", me).maybeSingle();
      if (!stopped) setState((data as State | null) ?? null);
    };
    const channel = supabase.channel(`apply-gmail:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "apply_gmail", filter: `user_id=eq.${me}` }, () => void load())
      .subscribe(status => { if (status === "SUBSCRIBED") void load(); });
    return () => { stopped = true; void supabase.removeChannel(channel); };
  }, [supabase, me]);

  const request = async (connect: boolean) => {
    setBusy(true);
    setProblem(null);
    const { error } = await supabase.rpc("apply_gmail_request", { connect });
    setBusy(false);
    if (error) setProblem("That did not work. Please try again.");
    else setState(now => ({ email: connect ? now?.email ?? null : null, connected_at: now?.connected_at ?? null, want_connect: connect, want_disconnect: !connect }));
  };

  const connected = !!state?.email;
  const waiting = !connected && !!state?.want_connect;
  const sub = state === undefined ? "Loading…" : connected ? `Connected: ${state?.email}` : waiting ? "Waiting for you to allow it" : "Not connected";

  return <section className="jobs-card apply-gmail" aria-labelledby="apply-gmail-title">
    <header className="jobs-card-head">
      <div>
        <h2 id="apply-gmail-title" className="jobs-card-title">Gmail for verification codes</h2>
        <p className="jobs-card-sub" role="status">{sub}</p>
      </div>
      {state !== undefined && (connected
        ? <button type="button" className="chat-pill" disabled={busy} onClick={() => void request(false)}>Disconnect</button>
        : <button type="button" className="jobs-button" data-primary="" disabled={busy || waiting} onClick={() => void request(true)}>{waiting ? "Waiting…" : "Connect Gmail"}</button>)}
    </header>

    <p className="jobs-form-hint">Some job sites email you a code to confirm it is you before an application is sent. With your Gmail connected, the agent reads just that code and types it in. It can only <b>read</b> your mail — never send, change or delete anything — and KIASA never sees your mail, only that you are connected.</p>

    {waiting && <p className="jobs-form-hint" role="status">Now open your KIASA Browser (press <b>Start the KIASA Browser</b> above if it is closed). A Google <b>Allow</b> page will appear in it — sign in and approve read-only access. If Google warns the app is unverified, choose <b>Advanced → Go to KIASA</b>.</p>}
    {connected && <p className="jobs-form-hint">You may need to reconnect about once a week, because the access is kept in a limited mode to stay free.</p>}
    {problem && <p className="jobs-form-hint" role="alert">{problem}</p>}
  </section>;
}
