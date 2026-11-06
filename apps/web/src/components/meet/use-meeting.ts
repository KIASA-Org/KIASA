"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { MeetStart } from "@/lib/meetings/types";
import { clearVoice, gathered, VOICE_BITRATE } from "./rtc";

/** What each person in the meeting says about themselves, on the meeting's
 * channel: who they are, and whether their microphone, camera, shared screen
 * (its stream's id), raised hand and recording are on. */
export type PeerState = { user: string; name: string; mic: boolean; cam: boolean; screen: string | null; hand: number | null; recording: boolean; joined: string };
/** Someone else in the meeting, as this browser has them: their state, and what they send. */
/** `link`, `signaling` and `trouble`: how the connection to them stands, and the last thing that went wrong with it. */
export type Remote = PeerState & { peer: string; streams: MediaStream[]; link: RTCPeerConnectionState; signaling: RTCSignalingState; trouble: string };
export type Connection = "connecting" | "live" | "paused";
/** How a connection is doing, for looking into a problem: by which way it goes,
 * and how much has come and gone over it (bytes); `level`, how loud their sound is now (0–1). */
export type LinkDetails = {
  route: "relay" | "same network" | "internet" | "none yet"; heard: number; level: number | null; seen: number; sent: number;
  /** One's own microphone: its name, and whether sound comes from it ("no sound from it": the device gives none). */
  micName: string | null; micState: "working" | "no sound from it" | "off" | "stopped" | "none";
};

/** `user`: who sends it, so a browser answers only those it may connect to. */
/** `candidate`: a way to reach the sender found after its offer or answer went out. */
type Signal = { from: string; to: string; user: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
/** What is shared (its picture, and its sound if it has one) sent to one more person. */
function sendScreen(link: Link, shared: MediaStream) {
  link.screen = undefined;
  link.screenAudio = undefined;
  for (const track of shared.getTracks()) {
    const sender = link.pc.addTrack(track, shared);
    if (track.kind === "video") link.screen = sender;
    else link.screenAudio = sender;
  }
}
type Link = {
  pc: RTCPeerConnection; polite: boolean; makingOffer: boolean; ignoreOffer: boolean;
  cam?: RTCRtpSender; screen?: RTCRtpSender; screenAudio?: RTCRtpSender; voice?: RTCRtpSender; queue: Promise<void>;
  /** Makes and sends an offer. */
  offer?: () => Promise<void>;
  /** Which offer is the newest: an older one still gathering is not sent. */
  offers: number;
  /** An answer is being made; `owed`: an offer is to follow it. */
  answering: boolean; owed: boolean;
  /** Seen in the meeting's list of who is here: from then on, gone from it means gone. */
  seen: boolean;
  /** This side's offer or answer has gone out: ways to reach it found later go on their own. */
  described: boolean;
};

// A camera picture good enough for a face, light enough to send to five others at once.
const CAMERA: MediaTrackConstraints = { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } };
const VOICE: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const CAMERA_BITRATE = 700_000, SCREEN_BITRATE = 1_800_000;

/** The live server closes the channel of anyone who says what they are doing a
 * 6th time within 30 s (CLIENT_PRESENCE_MAX_CALLS), and the page then stays cut
 * off from the meeting. So: never more than 4, with a little room to spare. */
const SAY_MOST = 4, SAY_WINDOW = 31_000;

/** Why the microphone could not be had, in words that say what to do. */
function micTrouble(error: unknown): string {
  const name = (error as DOMException | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "The microphone is blocked for kiasa.tech. Allow it from the icon left of the address (Site settings → Microphone), and in Windows (Settings → Privacy & security → Microphone), then click the microphone button again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this computer. Plug one in (or a headset), then click the microphone button again.";
  if (name === "NotReadableError" || name === "AbortError") return "Another app is using the microphone (Zoom, Teams, Google Meet…). Close it, then click the microphone button again.";
  return "The microphone could not be started. Please click the microphone button again.";
}


/** A meeting, as one browser takes part in it. Each person's browser connects
 * straight to each other's (WebRTC), finding them on the meeting's private
 * live channel ("meet:<id>"): who is there (presence), and their offers to
 * connect (broadcast), each kept to the two it is meant for. Until `joined`,
 * it only listens, so the waiting screen shows who is already in. Each
 * connection follows the "perfect negotiation" pattern, so two browsers
 * offering at once settle it without anyone losing their place. `allowed`:
 * whom this browser connects to (admins, and the people an admin let in).
 * `devices`: whether this page may hold the camera and microphone at all (the
 * waiting screen or the call); false once the person left or the meeting is over,
 * which lets every device go at once (KIASA-006). */
export function useMeeting({ supabase, start, joined: wantsIn, allowed, devices: wantsDevices = true, over = false }: { supabase: SupabaseClient; start: MeetStart; joined: boolean; allowed: string[]; devices?: boolean; over?: boolean }) {
  const { meeting, me, ice } = start;
  const relayed = ice.some(server => [server.urls].flat().some(url => url.startsWith("turn")));
  // This tab, in the meeting: the same person may be in it from two tabs.
  const [peerId] = useState(() => crypto.randomUUID());
  const [connection, setConnection] = useState<Connection>("connecting");
  const [present, setPresent] = useState<(PeerState & { peer: string })[]>([]);
  const [remotes, setRemotes] = useState<Record<string, Remote>>({});
  const [ended, setEnded] = useState(false);
  // Never in a meeting that is over, nor holding a device for it.
  const joined = wantsIn && !ended && !over;
  const devices = wantsDevices && !ended && !over;
  // Mine: the camera and microphone, the shared screen, and what I say about them.
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [hand, setHand] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState("");

  const channel = useRef<RealtimeChannel | null>(null);
  const links = useRef(new Map<string, Link>());
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  /** When I last said what I am doing (see SAY_MOST). */
  const said = useRef<number[]>([]);
  const joinedAt = useRef(new Date().toISOString());

  // What I tell the others goes one message at a time, in order: the live
  // connection refuses messages sent faster than about ten a second ("rate
  // limited"), and a refused one is sent again a moment later.
  const outbox = useRef(Promise.resolve());
  const send = (to: string, signal: Omit<Signal, "from" | "to" | "user">) => {
    outbox.current = outbox.current.then(async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const sent = await channel.current?.send({ type: "broadcast", event: "signal", payload: { from: peerId, to, user: me.id, ...signal } });
        if (sent === undefined || sent === "ok") return;
        await new Promise(resolve => window.setTimeout(resolve, 120 + attempt * 60));
      }
    }).catch(() => {});
  };
  const patchRemote = (peer: string, change: (remote: Remote) => Partial<Remote>) =>
    setRemotes(current => current[peer] ? { ...current, [peer]: { ...current[peer], ...change(current[peer]) } } : current);

  // Each send at a sensible rate: faces lighter, a shared screen sharper; and
  // the voice first: while a new connection is still finding how much it can
  // carry, the pictures give way to it.
  const limit = async (sender: RTCRtpSender | undefined, bitrate: number, first = false) => {
    if (!sender) return;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return;
    parameters.encodings[0].maxBitrate = bitrate;
    if (first) Object.assign(parameters.encodings[0], { priority: "high", networkPriority: "high" });
    await sender.setParameters(parameters).catch(() => {});
  };

  /** A connection to someone else in the meeting, sending them what I send everyone. */
  const connect = (peer: string, state?: PeerState): Link => {
    const pc = new RTCPeerConnection({ iceServers: ice });
    const link: Link = { pc, polite: peerId > peer, makingOffer: false, ignoreOffer: false, queue: Promise.resolve(), seen: false, described: false, answering: false, owed: false, offers: 0 };
    links.current.set(peer, link);
    const mine = localRef.current;
    for (const track of mine?.getTracks() ?? []) {
      const sender = pc.addTrack(track, mine!);
      if (track.kind === "video") link.cam = sender;
      else link.voice = sender;
    }
    const shared = screenRef.current;
    if (shared) sendScreen(link, shared);
    // A way to reach this side found after its offer or answer went out (a relay
    // far away can take seconds): sent on its own, so it is never lost.
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && link.described) send(peer, { candidate: candidate.toJSON() });
    };
    link.offer = async () => {
      const round = ++link.offers;
      try {
        link.makingOffer = true;
        link.described = false;
        await pc.setLocalDescription();
      } catch (error) {
        patchRemote(peer, () => ({ trouble: `offer: ${(error as Error).message}`.slice(0, 200) }));
        return;
      } finally { link.makingOffer = false; }
      await gathered(pc, relayed);
      // Set aside meanwhile, for an offer from the other side (and perhaps a newer one of mine): nothing to send.
      if (round === link.offers && pc.signalingState === "have-local-offer") {
        send(peer, { description: clearVoice(pc.localDescription!.toJSON()) });
        link.described = true;
      }
    };
    // While I am still answering, an offer of mine would take the answer's place
    // before it goes out, and each side would wait for the other for ever: it waits.
    pc.onnegotiationneeded = () => {
      if (link.answering) link.owed = true;
      else void link.offer?.();
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      patchRemote(peer, remote => ({ streams: remote.streams.some(known => known.id === stream.id) ? [...remote.streams] : [...remote.streams, stream] }));
    };
    pc.onsignalingstatechange = () => patchRemote(peer, () => ({ signaling: pc.signalingState }));
    pc.onconnectionstatechange = () => {
      patchRemote(peer, () => ({ link: pc.connectionState }));
      if (pc.connectionState === "connected") { void limit(link.voice, VOICE_BITRATE, true); void limit(link.cam, CAMERA_BITRATE); void limit(link.screen, SCREEN_BITRATE); }
      if (pc.connectionState === "failed") pc.restartIce();
    };
    setRemotes(current => ({
      ...current,
      [peer]: current[peer] ?? { peer, streams: [], link: "new", signaling: "stable", trouble: "", ...(state ?? { user: "", name: "", mic: false, cam: false, screen: null, hand: null, recording: false, joined: "" }) },
    }));
    return link;
  };

  const disconnect = (peer: string) => {
    links.current.get(peer)?.pc.close();
    links.current.delete(peer);
    setRemotes(current => {
      const rest = { ...current };
      delete rest[peer];
      return rest;
    });
  };

  const handle = async (signal: Signal) => {
    let link = links.current.get(signal.from);
    if (!link) link = connect(signal.from);
    const { pc } = link;
    if (signal.candidate) {
      // One for an offer set aside (or already known) is let go.
      try { await pc.addIceCandidate(signal.candidate); } catch { /* not for the offer or answer now in hand */ }
      return;
    }
    if (signal.description) {
      const collision = signal.description.type === "offer" && (link.makingOffer || pc.signalingState !== "stable");
      link.ignoreOffer = !link.polite && collision;
      if (link.ignoreOffer) return;
      const answering = signal.description.type === "offer";
      link.answering = answering;
      try {
        await pc.setRemoteDescription(signal.description);
        if (answering) {
          link.described = false;
          await pc.setLocalDescription();
          await gathered(pc, relayed);
          send(signal.from, { description: clearVoice(pc.localDescription!.toJSON()) });
          link.described = true;
        }
      } finally {
        link.answering = false;
        // Answered: now what I have to add that this exchange did not cover.
        if (link.owed) {
          link.owed = false;
          void link.offer?.();
        }
      }
    }
  };

  // Who is here, from the channel: new people are connected to, people gone let go.
  const synced = useEffectEvent(() => {
    const state = channel.current?.presenceState<PeerState>() ?? {};
    const here = Object.entries(state).flatMap(([peer, entries]) => entries[0] ? [{ ...(entries[0] as unknown as PeerState), peer }] : []);
    setPresent(here);
    if (!joined) return;
    const others = here.filter(entry => entry.peer !== peerId && allowed.includes(entry.user));
    for (const entry of others) {
      const link = links.current.get(entry.peer) ?? connect(entry.peer, entry);
      link.seen = true;
      patchRemote(entry.peer, () => ({ ...entry }));
    }
    // Someone whose offer came before the list showed them is not gone: only
    // someone the list showed, and no longer does, has left.
    for (const [peer, link] of [...links.current]) if (link.seen && !others.some(entry => entry.peer === peer)) disconnect(peer);
  });
  const signalled = useEffectEvent((signal: Signal) => {
    if (signal.to !== peerId || !joined || !allowed.includes(signal.user)) return;
    const link = links.current.get(signal.from) ?? connect(signal.from);
    // One at a time per connection, in the order they came.
    link.queue = link.queue.then(() => handle(signal)).catch((error: Error) => patchRemote(signal.from, () => ({ trouble: `${error.name}: ${error.message}`.slice(0, 200) })));
  });
  // Over only if the meeting itself says so: anyone on the channel could say it.
  const endedHere = useEffectEvent(async () => {
    const { data } = await supabase.from("meetings").select("ended_at").eq("id", meeting.id).maybeSingle();
    if (data?.ended_at) setEnded(true);
  });

  // The meeting's channel, from the first moment: the waiting screen shows who
  // is in. Only those in the meeting may send on it, and the live server asks
  // as a browser joins the channel: so whoever is let in joins it again (once
  // the old one is closed, as the same channel cannot be had twice at once).
  const closing = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let stopped = false;
    let opened: RealtimeChannel | null = null;
    (async () => {
      await closing.current;
      await supabase.realtime.setAuth();
      if (stopped) return;
      setConnection("connecting");
      opened = supabase.channel(`meet:${meeting.id}`, { config: { private: true, broadcast: { self: false }, presence: { key: peerId } } });
      channel.current = opened;
      opened
        .on("presence", { event: "sync" }, () => synced())
        .on("broadcast", { event: "signal" }, ({ payload }) => signalled(payload as Signal))
        .on("broadcast", { event: "ended" }, () => void endedHere())
        .subscribe(status => { if (!stopped) setConnection(status === "SUBSCRIBED" ? "live" : status === "CLOSED" ? "paused" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "paused" : "connecting"); });
    })().catch(() => { if (!stopped) setConnection("paused"); });
    return () => {
      stopped = true;
      channel.current = null;
      if (opened) closing.current = supabase.removeChannel(opened);
    };
  }, [supabase, meeting.id, peerId, joined]);

  // What I say about myself, whenever it changes (only once in).
  useEffect(() => {
    if (!joined || connection !== "live") return;
    const state = { user: me.id, name: me.name, mic, cam, screen: screen?.id ?? null, hand, recording, joined: joinedAt.current } satisfies PeerState;
    const say = () => {
      said.current = [...said.current.filter(at => Date.now() - at < SAY_WINDOW), Date.now()];
      void channel.current?.track(state);
    };
    // Said at once, unless that is too many lately: then the newest news goes when
    // it may (a change meanwhile comes here again, and replaces it).
    const lately = said.current.filter(at => Date.now() - at < SAY_WINDOW);
    if (lately.length < SAY_MOST) return say();
    const timer = window.setTimeout(say, lately[0] + SAY_WINDOW - Date.now());
    return () => window.clearTimeout(timer);
  }, [joined, connection, me.id, me.name, mic, cam, screen, hand, recording]);

  // Someone let in while I am here: connected to at once.
  const allowedKey = allowed.join(",");
  useEffect(() => { if (joined) synced(); }, [joined, allowedKey]);

  // Once in: connected to everyone already here. Leaving: every connection let go.
  useEffect(() => {
    if (!joined) return;
    synced();
    const open = links.current;
    return () => {
      void channel.current?.untrack();
      for (const link of open.values()) link.pc.close();
      open.clear();
      setRemotes({});
    };
  }, [joined]);

  /** Every device this page holds, let go: camera, microphone and any shared screen.
   * A screen is never sent again without being chosen again. */
  const release = () => {
    localRef.current?.getTracks().forEach(track => track.stop());
    localRef.current = null;
    stopScreen();
    setLocal(null);
  };

  // The camera and microphone, asked for on the waiting screen (again after a Leave,
  // only when the person comes back), and let go when they leave or the meeting ends.
  useEffect(() => {
    if (!devices) return;
    let stopped = false;
    setMic(true);
    setCam(true);
    (async () => {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE, video: CAMERA });
      } catch {
        // No camera, or it was refused: the microphone alone; no microphone: the camera alone; then nothing.
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE }); setCam(false); } catch (micError) {
          setMic(false);
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: CAMERA });
            setProblem(micTrouble(micError));
          } catch {
            setCam(false);
            setProblem("This browser was not allowed to use your camera or microphone. You can still join, and see and hear the others; allow them from the lock beside the address to be seen and heard.");
          }
        }
      }
      if (stopped) { stream?.getTracks().forEach(track => track.stop()); return; }
      // Tuned for talking, not music.
      for (const track of stream?.getAudioTracks() ?? []) track.contentHint = "speech";
      localRef.current = stream ?? new MediaStream();
      setLocal(localRef.current);
    })();
    return () => {
      stopped = true;
      release();
    };
    // `release` works on refs only; the devices are asked for and let go only as `devices` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  /** A connection's details, from the browser's own figures. */
  const details = async (peer: string): Promise<LinkDetails | null> => {
    const pc = links.current.get(peer)?.pc;
    if (!pc) return null;
    const all = new Map<string, Record<string, unknown>>();
    let chosen: string | undefined;
    (await pc.getStats()).forEach((stat: Record<string, unknown>) => {
      all.set(stat.id as string, stat);
      if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") chosen = stat.selectedCandidatePairId;
    });
    if (!chosen) for (const stat of all.values()) if (stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") chosen = stat.id as string;
    const pair = chosen ? all.get(chosen) : undefined;
    const ends = [pair && all.get(pair.localCandidateId as string)?.candidateType, pair && all.get(pair.remoteCandidateId as string)?.candidateType];
    const route = !pair ? "none yet" : ends.includes("relay") ? "relay" : ends.every(type => type === "host") ? "same network" : "internet";
    let heard = 0, seen = 0, sent = 0, level: number | null = null;
    for (const stat of all.values()) {
      if (stat.type === "inbound-rtp" && stat.kind === "audio") {
        heard += Number(stat.bytesReceived ?? 0);
        if (typeof stat.audioLevel === "number") level = Math.max(level ?? 0, stat.audioLevel);
      }
      if (stat.type === "inbound-rtp" && stat.kind === "video") seen += Number(stat.bytesReceived ?? 0);
      if (stat.type === "outbound-rtp" && stat.kind === "audio") sent += Number(stat.bytesSent ?? 0);
    }
    const track = localRef.current?.getAudioTracks()[0];
    const micState = !track ? "none" : track.readyState === "ended" ? "stopped" : !track.enabled ? "off" : track.muted ? "no sound from it" : "working";
    return { route, heard, level, seen, sent, micName: track?.label || null, micState };
  };

  /** The microphones on this computer, by name (once the browser has let the page use one). */
  const microphones = async () => (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput" && device.deviceId);

  /** Another microphone, chosen by hand (as in Google Meet): in the old one's
   * place, for everyone already here; and on. */
  const chooseMic = async (deviceId: string) => {
    try {
      const [fresh] = (await navigator.mediaDevices.getUserMedia({ audio: { ...VOICE, deviceId: { exact: deviceId } } })).getAudioTracks();
      fresh.contentHint = "speech";
      const stream = localRef.current ?? new MediaStream();
      for (const old of stream.getAudioTracks()) { old.stop(); stream.removeTrack(old); }
      stream.addTrack(fresh);
      localRef.current = stream;
      for (const link of links.current.values()) {
        if (link.voice) await link.voice.replaceTrack(fresh);
        else link.voice = link.pc.addTrack(fresh, stream);
      }
      setMic(true);
      setProblem("");
      setLocal(new MediaStream(stream.getTracks()));
    } catch (error) {
      setProblem(micTrouble(error));
    }
  };

  /** The microphone on or off; with none yet (refused, missing or busy when the meeting opened), asked for again. */
  const toggleMic = async () => {
    const stream = localRef.current;
    const track = stream?.getAudioTracks()[0];
    if (track) {
      track.enabled = !mic;
      setMic(!mic);
      return;
    }
    try {
      const [fresh] = (await navigator.mediaDevices.getUserMedia({ audio: VOICE })).getAudioTracks();
      fresh.contentHint = "speech";
      const into = stream ?? new MediaStream();
      into.addTrack(fresh);
      localRef.current = into;
      // To everyone already here: in its place, or newly sent (each connection asks the other again).
      for (const link of links.current.values()) {
        if (link.voice) await link.voice.replaceTrack(fresh);
        else link.voice = link.pc.addTrack(fresh, into);
      }
      setMic(true);
      setProblem("");
      setLocal(new MediaStream(into.getTracks()));
    } catch (error) {
      setProblem(micTrouble(error));
    }
  };

  /** Camera off lets the camera go (its light goes out); on, a new picture is sent to everyone. */
  const toggleCam = async () => {
    const stream = localRef.current;
    if (!stream) return;
    if (cam) {
      for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track); }
      for (const link of links.current.values()) await link.cam?.replaceTrack(null);
      setCam(false);
      setLocal(new MediaStream(stream.getTracks()));
      return;
    }
    try {
      const [track] = (await navigator.mediaDevices.getUserMedia({ video: CAMERA })).getVideoTracks();
      stream.addTrack(track);
      for (const link of links.current.values()) {
        if (link.cam) await link.cam.replaceTrack(track);
        else link.cam = link.pc.addTrack(track, stream);
      }
      setCam(true);
      setLocal(new MediaStream(stream.getTracks()));
    } catch {
      setProblem("The camera could not be started. Is another program using it?");
    }
  };

  const stopScreen = () => {
    const shared = screenRef.current;
    if (!shared) return;
    shared.getTracks().forEach(track => track.stop());
    for (const link of links.current.values()) {
      for (const sender of [link.screen, link.screenAudio]) if (sender) { try { link.pc.removeTrack(sender); } catch {} }
      link.screen = undefined;
      link.screenAudio = undefined;
    }
    screenRef.current = null;
    setScreen(null);
  };

  /** The screen, with its sound when the person turns that on in the browser's picker. */
  const shareScreen = async () => {
    if (screenRef.current) return stopScreen();
    try {
      // The meeting's own tab is not offered: sharing it only shows the meeting to itself.
      // Its own sound is left out of what is shared, so no one hears themselves back,
      // and the sound is left as it is: cleaning meant for a voice spoils music.
      const shared = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
        systemAudio: "include", selfBrowserSurface: "exclude",
      } as DisplayMediaStreamOptions);
      const [video] = shared.getVideoTracks();
      video.contentHint = "detail";
      // Stopped from the browser's own "Stop sharing" bar, too.
      video.addEventListener("ended", stopScreen);
      screenRef.current = shared;
      for (const link of links.current.values()) sendScreen(link, shared);
      setScreen(shared);
    } catch { /* the person chose not to share */ }
  };

  /** Everyone is told the meeting is over (the admin who ended it). */
  const announceEnd = () => { void channel.current?.send({ type: "broadcast", event: "ended", payload: {} }); };

  return {
    // Whether a relay is set up for calls that cannot go direct; and a connection's details.
    relayed, details, microphones, chooseMic,
    peerId, connection, present, remotes: Object.values(remotes), ended, problem, setProblem,
    local, screen, mic, cam, hand, recording,
    toggleMic, toggleCam, shareScreen, stopScreen,
    raiseHand: () => setHand(hand ? null : Date.now()),
    setRecording, announceEnd,
  };
}
