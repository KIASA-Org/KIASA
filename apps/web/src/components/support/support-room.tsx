"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { supportRelay } from "@/lib/support/actions";
import { SupportReceiver, type Figures, type MemberSays, type SupportState } from "./support-link";

const STATE_TEXT: Record<SupportState, string> = {
  connecting: "Connecting to the member's computer…",
  live: "Live",
  degraded: "Poor connection: the picture may be slow; voice comes first",
  reconnecting: "Reconnecting…",
  paused: "The member paused their screen",
  ended: "Ended",
};

type Fit = "fit" | "actual" | "zoom";

/** The manager's view of a live support session: the member's screen and sound, the
 * manager's own microphone, the connection's figures, and End. */
export function SupportRoom({ session, member, realtime }: { session: string; member: string; realtime: { url: string; key: string } }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [state, setState] = useState<SupportState>("connecting");
  const [why, setWhy] = useState("");
  const [says, setSays] = useState<MemberSays | null>(null);
  const [figures, setFigures] = useState<Figures | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState(false);
  const [micProblem, setMicProblem] = useState("");
  const [fit, setFit] = useState<Fit>("fit");
  const [zoom, setZoom] = useState(1.5);
  const [details, setDetails] = useState(false);
  const receiver = useRef<SupportReceiver | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const relayOnly = new URLSearchParams(window.location.search).get("relay") === "1";
    let ice: RTCIceServer[] | null = null;
    let at = 0;
    const getIce = async () => {
      // Fresh relay passwords when the last ones are over an hour old (they last two).
      if (ice && Date.now() - at < 3_600_000) return ice;
      const answer = await supportRelay(session).catch(() => ({ error: "unreachable" }));
      ice = "ice" in answer && answer.ice.length ? answer.ice : [{ urls: ["stun:stun.l.google.com:19302"] }];
      at = "ice" in answer ? Date.now() : 0;
      return ice;
    };
    const made = new SupportReceiver(supabase, session, getIce, relayOnly, {
      stream: setStream,
      state: (next, reason) => { setState(next); if (reason) setWhy(reason); if (next === "ended") setStream(null); },
      says: setSays,
      figures: setFigures,
    });
    receiver.current = made;
    void made.start();
    const away = () => made.leaving();
    window.addEventListener("pagehide", away);
    return () => {
      window.removeEventListener("pagehide", away);
      made.leaving();
      made.stop();
    };
  }, [supabase, session]);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    if (audio.current) audio.current.srcObject = stream;
  }, [stream]);

  const toggleMic = async () => {
    const problem = await receiver.current?.setMic(!mic);
    if (problem) { setMicProblem(problem); return; }
    setMicProblem("");
    setMic(!mic);
  };

  if (state === "ended") return <div className="meet meet-outside">
    <main className="meet-outside-main">
      <div className="meet-message" data-support-ended="">
        <h1>Support session ended</h1>
        <p>{why || "This session has ended."} Nothing was recorded.</p>
        <Link className="admin-approve" href="/support">Back to support</Link>
      </div>
    </main>
  </div>;

  const screenWord = !says ? "…" : says.screen === "live" ? "on" : says.screen === "paused" ? "paused" : says.screen === "lost" ? "display lost" : "off";
  return <div className="support-room" data-state={state}>
    <header className="support-top">
      <div>
        <p className="eyebrow">Support session</p>
        <h1 className="support-title">{member}&apos;s screen</h1>
      </div>
      <p className="support-state" role="status" data-support-state={state}><span aria-hidden="true" />{STATE_TEXT[state]}</p>
      <div className="support-actions">
        <div className="support-fit" role="group" aria-label="Picture size">
          {(["fit", "actual", "zoom"] as Fit[]).map(choice => <button key={choice} type="button" aria-pressed={fit === choice} onClick={() => setFit(choice)}>
            {choice === "fit" ? "Fit" : choice === "actual" ? "100%" : "Zoom"}</button>)}
          {fit === "zoom" && <input type="range" min={1.25} max={3} step={0.25} value={zoom} aria-label="Zoom" onChange={event => setZoom(Number(event.target.value))} />}
        </div>
        <button type="button" className="account-button" aria-pressed={mic} onClick={() => void toggleMic()}>{mic ? "Mute my microphone" : "Talk (turn on my microphone)"}</button>
        <button type="button" className="account-button" aria-expanded={details} onClick={() => setDetails(!details)}>Details</button>
        <button type="button" className="admin-decline" onClick={() => void receiver.current?.end()}>End session</button>
      </div>
    </header>
    <p className="support-sources" data-support-sources="">
      Member shares: screen <b>{screenWord}</b>{says?.detail ? ` (${says.detail})` : ""} · computer sound <b>{says ? (says.system ? "on" : "off") : "…"}</b> · microphone <b>{says ? (says.mic ? "on" : "off") : "…"}</b>
      {says?.mode ? ` · ${says.mode}` : ""}
    </p>
    {micProblem && <p className="b-form-error" role="alert">{micProblem}</p>}
    <div className="support-stage" data-fit={fit} style={{ "--zoom": zoom } as React.CSSProperties}>
      <video ref={video} className="support-video" autoPlay playsInline muted data-support-video="" />
      {state === "paused" && <div className="support-veil">{says?.screen === "lost" ? "The member's display was disconnected. Their sound continues if it is on." : "The member paused their screen. Their sound continues if it is on."}</div>}
      {(state === "connecting" || state === "reconnecting") && <div className="support-veil">{STATE_TEXT[state]}</div>}
    </div>
    <audio ref={audio} autoPlay data-support-audio="" />
    {details && figures && <dl className="support-details" data-support-details="">
      <dt>Route</dt><dd data-route={figures.route}>{figures.route} ({figures.local} → {figures.remote}, {figures.protocol})</dd>
      <dt>Round trip</dt><dd>{figures.rtt ?? "-"} ms</dd>
      <dt>Picture</dt><dd>{figures.width ?? "—"}×{figures.height ?? "—"}, {figures.fps ?? "—"} fps, {figures.videoKbps} kbit/s, {Math.round(figures.videoLoss * 100)}% lost, {figures.freezes} freezes</dd>
      <dt>Sound</dt><dd>{figures.audioKbps} kbit/s, {Math.round(figures.audioLoss * 100)}% lost, jitter {figures.jitter ?? "—"} ms</dd>
      {says?.kbps ? <><dt>Sender</dt><dd>{says.width ? `${says.width}×${says.height} ` : ""}at {says.fps} fps, aiming at {says.kbps} kbit/s{says.version ? ` · app v${says.version}` : ""}</dd></> : null}
    </dl>}
  </div>;
}
