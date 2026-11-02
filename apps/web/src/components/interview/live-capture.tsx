"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { Words } from "./live-words";
import { useLiveSession } from "./use-live-session";

/** The KIASA Live Script app on this PC (apps/live-script): a small service that
 * turns what the PC plays into text. This provider sits in the root layout, so
 * once the member turns the live script on it keeps running as they move around
 * KIASA (to the Job desk and back), not only on the Interview page. While it is
 * on, a KIASA admin can read it, and the bar below says so on every page. */
const PORT = process.env.NEXT_PUBLIC_LIVE_SCRIPT_PORT || "8765";
const SERVICE = `ws://127.0.0.1:${PORT}/ws`;
const APP_LINK = "kiasa-live://start";
const DOWNLOAD = "https://github.com/KIASA-Org/KIASA/releases/download/live-script-1.0.0/KIASA-Live-Script.zip";
/** How long the app has to answer before the page offers the download. */
const ANSWER_MS = 8000;
const RETRY_MS = 800;
/** After this long with no app, a silent resume gives up (a reload with no app running). */
const RESUME_GIVE_UP_MS = 20000;
/** The live script stays on across reloads and page changes in this browser tab, until turned off or the tab closes. */
const RESUMING = "kiasa-live-capturing";
const rememberOn = (on: boolean) => { try { if (on) sessionStorage.setItem(RESUMING, "1"); else sessionStorage.removeItem(RESUMING); } catch { /* fine */ } };
const wasOn = () => { try { return sessionStorage.getItem(RESUMING) === "1"; } catch { return false; } };

export type Phase = "off" | "looking" | "loading" | "ready" | "listening" | "failed";

/** Chrome asks before a website may reach this PC (Local Network Access); if the member said no, no connection can work. */
export const BLOCKED = "Your browser is blocking KIASA from reaching the app on this PC. Click the icon left of the address, open Site settings, allow KIASA to reach this PC (it may say Local network), then reload this page.";
export const DOWNLOAD_URL = DOWNLOAD;
export const OPEN_APP = APP_LINK;

async function blocked() {
  for (const name of ["loopback-network", "local-network-access"]) {
    try { return (await navigator.permissions.query({ name: name as PermissionName })).state === "denied"; } catch { /* Not this browser's name for it. */ }
  }
  return false;
}

type Capture = {
  phase: Phase; detail: string; problem: string; missing: boolean; hasText: boolean; on: boolean;
  /** How far the first-run speech model download has got, 0–1, while it is going. */
  progress: number | null;
  turnOn: () => void; turnOff: () => void; dismissSetup: () => void;
  attachBox: (el: HTMLDivElement | null) => void;
  scriptText: () => string;
};
const CaptureContext = createContext<Capture | null>(null);

/** The Interview page reads the capture through this. */
export function useLiveCapture(): Capture {
  const context = useContext(CaptureContext);
  if (!context) throw new Error("useLiveCapture must be used inside LiveCaptureProvider");
  return context;
}

/** Only a signed-in member's browser carries a Supabase auth cookie; without one
 * (a signed-out visitor on the public site) the provider does nothing at all. */
function hasAuthCookie() {
  try { return /\bsb-[^=]+-auth-token=/.test(document.cookie); } catch { return false; }
}

export function LiveCaptureProvider({ realtime, children }: { realtime: { url: string; key: string }; children: React.ReactNode }) {
  const [me, setMe] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("off");
  const [detail, setDetail] = useState("");
  const [problem, setProblem] = useState("");
  const [missing, setMissing] = useState(false);
  const [hasText, setHasText] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const wantsStart = useRef(false);
  const opened = useRef(false);
  const deadline = useRef(0);
  const retry = useRef<number>(0);
  const again = useRef<() => void>(() => {});
  const resuming = useRef(false);
  const [words] = useState(() => new Words());

  const on = phase === "listening";
  const scriptText = useCallback(() => words.target, [words]);
  const session = useLiveSession(me ?? "", realtime, scriptText, on && !!me);
  const sessionChanged = session.changed;

  // A signed-in member only: find out who they are, so their script can be streamed.
  useEffect(() => {
    if (!hasAuthCookie()) return;
    const supabase = browserClient(realtime.url, realtime.key);
    let stopped = false;
    void supabase.auth.getUser().then(({ data }) => { if (!stopped) setMe(data.user?.id ?? null); });
    return () => { stopped = true; };
  }, [realtime.url, realtime.key]);

  const connect = useCallback(() => {
    if (socket.current) return;
    const ws = new WebSocket(SERVICE);
    socket.current = ws;
    ws.onmessage = event => {
      const message = JSON.parse(event.data as string);
      if (message.type === "text") {
        words.set(message.text);
        setHasText(!!message.text);
        sessionChanged();
      } else if (message.type === "error") {
        wantsStart.current = false;
        setProblem(`Something went wrong: ${message.message}`);
      } else if (message.type === "state") {
        setPhase(message.state);
        setDetail(message.detail);
        setProgress(typeof message.progress === "number" ? message.progress : null);
        // Reconnecting (a reload) to an app that is already capturing: just follow it.
        if (message.state === "listening") { resuming.current = false; wantsStart.current = false; }
        if (message.state === "ready" && wantsStart.current) {
          wantsStart.current = false;
          setProblem("");
          ws.send(JSON.stringify({ action: "start" }));
        }
      }
    };
    ws.onclose = () => {
      if (socket.current === ws) socket.current = null;
      if (!wantsStart.current) {
        setPhase("off");
        return;
      }
      void blocked().then(no => {
        if (!wantsStart.current) return;
        if (no) {
          wantsStart.current = false;
          setMissing(false);
          setPhase("off");
          setProblem(BLOCKED);
          return;
        }
        if (!opened.current) {
          opened.current = true;
          window.location.href = APP_LINK;
        }
        if (Date.now() > deadline.current) setMissing(true);
        // A silent resume (reload with the app gone) stops trying after a while, instead of forever.
        if (resuming.current && Date.now() > deadline.current + RESUME_GIVE_UP_MS) {
          wantsStart.current = false;
          setPhase("off");
          return;
        }
        retry.current = window.setTimeout(() => again.current(), RETRY_MS);
      });
    };
  }, [words, sessionChanged]);

  useEffect(() => { again.current = connect; }, [connect]);

  const turnOn = useCallback(() => {
    rememberOn(true);
    setProblem("");
    setMissing(false);
    wantsStart.current = true;
    opened.current = false;
    deadline.current = Date.now() + ANSWER_MS;
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN && phase === "ready") {
      wantsStart.current = false;
      ws.send(JSON.stringify({ action: "start" }));
    } else if (ws?.readyState === WebSocket.OPEN && phase === "failed") {
      ws.send(JSON.stringify({ action: "start" }));
    } else if (!ws || ws.readyState !== WebSocket.OPEN) {
      setPhase("looking");
      window.clearTimeout(retry.current);
      connect();
    }
  }, [phase, connect]);

  const turnOff = useCallback(() => {
    rememberOn(false);
    resuming.current = false;
    wantsStart.current = false;
    window.clearTimeout(retry.current);
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "stop" }));
    // Let the app idle and quit: close our connection once it is off.
    socket.current = null;
    if (ws) { ws.onclose = null; ws.close(); }
    setPhase("off");
    setHasText(false);
    words.set("");
  }, [words]);

  const dismissSetup = useCallback(() => {
    rememberOn(false);
    resuming.current = false;
    wantsStart.current = false;
    window.clearTimeout(retry.current);
    setMissing(false);
    setPhase("off");
  }, []);

  // On a reload or a fresh page, resume the live script if it was on in this tab.
  const turnOnRef = useRef(turnOn);
  useEffect(() => { turnOnRef.current = turnOn; }, [turnOn]);
  useEffect(() => {
    if (hasAuthCookie() && wasOn()) {
      resuming.current = true;
      turnOnRef.current();
    }
  }, []);

  const attachBox = useCallback((el: HTMLDivElement | null) => { words.attach(el); }, [words]);

  useEffect(() => () => {
    window.clearTimeout(retry.current);
    words.stop();
    const ws = socket.current;
    socket.current = null;
    if (ws) { ws.onclose = null; ws.close(); }
  }, [words]);

  const value: Capture = { phase, detail, problem, missing, hasText, on, progress, turnOn, turnOff, dismissSetup, attachBox, scriptText };

  return <CaptureContext.Provider value={value}>
    {children}
    {on && <div className="live-watch-bar" role="status">
      <span className="live-watch-dot" aria-hidden="true" />
      <span><b>Your live script is on.</b> A KIASA admin can read it, word by word, while it is.</span>
      <button type="button" className="live-watch-off" onClick={turnOff}>Turn off</button>
    </div>}
  </CaptureContext.Provider>;
}
