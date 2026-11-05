"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { soundIce } from "@/lib/sound/actions";
import { hasAuthCookie, useLiveCapture } from "@/components/interview/live-capture";
import { startClock, tokenFrom } from "@/components/interview/live-link";
import { iceFrom, SoundListener, SoundSender, type HeardState, type SoundAccess } from "./sound-link";

/** A member's computer sound, shared with KIASA's admins, any time. It sits in the root
 * layout, so both ends keep going as people move around KIASA. While a member shares, the
 * bar below tells them so on every page. */

const BEAT_MS = 15_000;
const WAS_SHARING = "kiasa-sound-sharing";
const NO_SOUND = "No sound was shared. Click Share sound again, choose Entire screen (or a browser tab), and turn on “Also share system audio” (or “Also share tab audio”). The whole computer's sound needs Chrome or Edge on Windows.";
const NO_BROWSER = "This browser cannot share sound. Chrome or Edge on a computer can.";
const NOT_READY = "Sharing sound is not set up in the database yet: an admin runs supabase/migrations/20261105120000_sound_shares.sql in Supabase's SQL Editor.";
const NOT_ALLOWED = "Your account cannot share sound. Please ask an admin.";
const RETRY = "That did not work just now. Please try again.";
const RELOADED = "Sharing your sound stopped, because this page was reloaded or opened again. Click Share sound to share it again.";
const QUIET_AFTER_MS = 2_000;

const remember = (on: boolean) => { try { if (on) sessionStorage.setItem(WAS_SHARING, "1"); else sessionStorage.removeItem(WAS_SHARING); } catch { /* fine */ } };
const remembered = () => { try { return sessionStorage.getItem(WAS_SHARING) === "1"; } catch { return false; } };
const missing = (code?: string) => code === "42P01" || code === "PGRST205";

export type Listening = { member: string; name: string; state: HeardState };
type Sound = {
  sharing: boolean; starting: boolean; share: () => void; stopSharing: () => void;
  listening: Listening | null; loud: boolean; listen: (member: string, name: string) => void; stopListening: () => void;
};
const SoundContext = createContext<Sound | null>(null);

/** Null where sharing is not available at all (no accounts connected). */
export const useSound = () => useContext(SoundContext);

export function SoundProvider({ realtime, children }: { realtime: { url: string; key: string }; children: React.ReactNode }) {
  const { on: scriptOn } = useLiveCapture();
  const [sharing, setSharing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState("");
  const [listening, setListening] = useState<Listening | null>(null);
  const [heard, setHeard] = useState<MediaStream | null>(null);
  const [loud, setLoud] = useState(false);

  const sender = useRef<SoundSender | null>(null);
  const display = useRef<MediaStream | null>(null);
  const stopBeat = useRef<() => void>(() => {});
  const sharer = useRef<string | null>(null);
  const listener = useRef<SoundListener | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  const supabase = useCallback(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const access = useCallback((): SoundAccess => ({ ...realtime, token: tokenFrom(supabase()) }), [realtime, supabase]);
  const ice = useMemo(() => iceFrom(soundIce), []);

  const stopSharing = useCallback(() => {
    const sending = sender.current;
    sender.current = null;
    stopBeat.current();
    stopBeat.current = () => {};
    display.current?.getTracks().forEach(track => track.stop());
    display.current = null;
    remember(false);
    setSharing(false);
    if (!sending) return;
    void sending.stop();
    const member = sharer.current;
    if (member) void supabase().from("sound_shares").delete().eq("user_id", member).then(() => {});
  }, [supabase]);

  const share = useCallback(async () => {
    if (sender.current || starting) return;
    setProblem("");
    setStarting(true);
    const letGo = (shown: MediaStream | null, said: string) => {
      shown?.getTracks().forEach(track => track.stop());
      if (said) setProblem(said);
      setStarting(false);
    };
    // First of all: the browser asks only straight after the click. It will not give
    // sound without a picture, so the picture is asked for and kept here, never sent.
    let shown: MediaStream;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) return letGo(null, NO_BROWSER);
      shown = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" },
        // Left as it is: cleaning meant for a voice spoils music. KIASA's own sounds stay out.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
        systemAudio: "include", selfBrowserSurface: "exclude",
      } as DisplayMediaStreamOptions);
    } catch (error) {
      // Refused or closed: the member chose not to share.
      return letGo(null, (error as Error).name === "NotAllowedError" ? "" : NO_BROWSER);
    }
    const sound = shown.getAudioTracks();
    if (!sound.length) return letGo(shown, NO_SOUND);
    const client = supabase();
    const member = (await client.auth.getUser()).data.user?.id ?? null;
    if (!member) return letGo(shown, RETRY);
    const { error } = await client.from("sound_shares").upsert({ user_id: member });
    if (error) return letGo(shown, missing(error.code) ? NOT_READY : error.code === "42501" ? NOT_ALLOWED : RETRY);

    for (const track of sound) track.contentHint = "music";
    // Stopped from the browser's own "Stop sharing" bar, too.
    for (const track of shown.getTracks()) track.addEventListener("ended", stopSharing);
    display.current = shown;
    sharer.current = member;
    const sending = new SoundSender(access(), member, new MediaStream(sound), ice, () => {
      stopSharing();
      setProblem(NOT_ALLOWED);
    });
    sender.current = sending;
    sending.start();
    // Saying it is still on keeps the sign-in fresh as well. Signed out: over.
    stopBeat.current = startClock(BEAT_MS, () => {
      if (!hasAuthCookie()) return stopSharing();
      sending.tick();
      void client.from("sound_shares").upsert({ user_id: member }).then(({ error: said }) => { if (said?.code === "42501") stopSharing(); });
    });
    remember(true);
    setSharing(true);
    setStarting(false);
  }, [access, ice, starting, stopSharing, supabase]);

  // The page gone (a reload, or a page opened from outside KIASA): the browser has
  // stopped the sound, and only another click can start it. The member is told.
  useEffect(() => {
    if (!remembered()) return;
    remember(false);
    window.setTimeout(() => setProblem(RELOADED), 0);
    void supabase().auth.getUser().then(({ data }) => {
      if (data.user) void supabase().from("sound_shares").delete().eq("user_id", data.user.id).then(() => {});
    });
  }, [supabase]);

  useEffect(() => {
    const leaving = () => sender.current?.leaving();
    window.addEventListener("pagehide", leaving);
    return () => window.removeEventListener("pagehide", leaving);
  }, []);

  const stopListening = useCallback(() => {
    listener.current?.stop();
    listener.current = null;
    setHeard(null);
    setLoud(false);
    setListening(null);
  }, []);

  const listen = useCallback((member: string, name: string) => {
    listener.current?.stop();
    setHeard(null);
    setLoud(false);
    setListening({ member, name, state: "connecting" });
    const client = supabase();
    const stillSharing = async () => {
      const { data, error } = await client.from("sound_shares").select("user_id").eq("user_id", member).maybeSingle();
      return !!data || !!error;  // A look that failed says nothing.
    };
    const hearing: SoundListener = new SoundListener(access(), member, ice, stillSharing, setHeard, state => {
      if (listener.current !== hearing) return;
      setListening(current => current && current.member === member ? { ...current, state } : current);
      if (state === "ended" || state === "refused") {
        listener.current = null;
        setHeard(null);
        setLoud(false);
      }
    });
    listener.current = hearing;
    hearing.start();
  }, [access, ice, supabase]);

  // Signed out while listening: over.
  useEffect(() => {
    if (!listening || listening.state === "ended" || listening.state === "refused") return;
    const tick = window.setInterval(() => { if (!hasAuthCookie()) stopListening(); }, BEAT_MS);
    return () => window.clearInterval(tick);
  }, [listening, stopListening]);

  // What is heard plays here, and is measured, so a quiet computer does not look like a broken line.
  useEffect(() => {
    const audio = player.current;
    if (audio && audio.srcObject !== heard) audio.srcObject = heard;
    if (!heard) return;
    const context = new AudioContext();
    void context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    let source: MediaStreamAudioSourceNode | null = null;
    const data = new Uint8Array(analyser.fftSize);
    let lastLoud = 0;
    const look = window.setInterval(() => {
      if (!source && heard.getAudioTracks().length) {
        source = context.createMediaStreamSource(new MediaStream(heard.getAudioTracks()));
        source.connect(analyser);
      }
      analyser.getByteTimeDomainData(data);
      if (data.some(value => Math.abs(value - 128) > 2)) lastLoud = Date.now();
      setLoud(Date.now() - lastLoud < QUIET_AFTER_MS);
    }, 250);
    return () => {
      window.clearInterval(look);
      void context.close().catch(() => {});
    };
  }, [heard]);

  const value: Sound = { sharing, starting, share: () => void share(), stopSharing, listening, loud, listen, stopListening };
  const below = scriptOn || undefined;

  return <SoundContext.Provider value={value}>
    {children}
    {sharing && <div className="live-watch-bar sound-bar" data-below={below} role="status">
      <span className="live-watch-dot" aria-hidden="true" />
      <span><b>Your computer&apos;s sound is shared.</b> KIASA&apos;s admins can hear it<span className="live-watch-more">; no picture is sent</span>.</span>
      <button type="button" className="live-watch-off" onClick={stopSharing}>Stop</button>
    </div>}
    {!sharing && problem && <div className="live-watch-bar sound-bar" data-below={below} data-problem="" role="alert">
      <span>{problem}</span>
      <button type="button" className="live-watch-off" onClick={() => setProblem("")}>Close</button>
    </div>}
    {listening && <div className="live-watch-bar sound-bar" data-below={below} data-listening="" role="status">
      <span className="live-watch-dot" aria-hidden="true" />
      <span>{listening.state === "ended" ? <><b>{listening.name}</b> stopped sharing their sound.</>
        : listening.state === "refused" ? <>You cannot listen to <b>{listening.name}</b> now.</>
        : listening.state === "connecting" ? <>Connecting to <b>{listening.name}</b>…</>
        : <>Listening to <b>{listening.name}</b>: {loud ? "sound arriving" : "quiet just now"}</>}</span>
      <button type="button" className="live-watch-off" onClick={stopListening}>{listening.state === "ended" || listening.state === "refused" ? "Close" : "Stop"}</button>
    </div>}
    {listening && <audio ref={player} data-sound-heard="" autoPlay hidden />}
  </SoundContext.Provider>;
}
