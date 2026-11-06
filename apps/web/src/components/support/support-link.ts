import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { gathered } from "@/components/meet/rtc";

/** The manager's end of a support session: receives the member's screen and sound from
 * the KIASA Sound Desk app, and sends the manager's voice back.
 *
 * Signalling runs on the private channel support:<session id>, which the database opens
 * only to the member and the assigned manager while the session is live. The app always
 * offers and the manager always answers. Every opening of this page gets a new seat from
 * the database (support_join); the app answers only the newest seat, so an older tab or a
 * replayed message gets nothing. Each offer carries an epoch; an older epoch is ignored.
 *
 * The session's row is re-read every few seconds (support_beat): ended, expired or revoked
 * closes everything here, whatever the channel says. */

export type SupportState = "connecting" | "live" | "degraded" | "reconnecting" | "paused" | "ended";
export type MemberSays = { screen: "live" | "paused" | "lost" | "off"; system: boolean; mic: boolean; mode?: string; detail?: string; fps?: number; kbps?: number; width?: number; height?: number; version?: string };
export type Figures = {
  route: string; local: string; remote: string; protocol: string; rtt: number | null;
  videoKbps: number; audioKbps: number; fps: number | null; width: number | null; height: number | null;
  videoLoss: number; audioLoss: number; jitter: number | null; framesDecoded: number; freezes: number;
  videoDelay: number | null;   // how far behind live the picture is playing (jitter buffer), ms
};
type Message = {
  kind: "join" | "offer" | "answer" | "candidate" | "state" | "leave" | "ended";
  from?: string; to?: string; seat?: string; epoch?: number; seq?: number;
  sdp?: string; candidate?: RTCIceCandidateInit; says?: MemberSays; reason?: string;
};

const BEAT_MS = 5_000;
const JOIN_MS = 3_000;            // asked again until an offer comes
const RECONNECT_AFTER_MS = 4_000; // "disconnected" this long: ask for a new offer
const GIVE_UP_MS = 120_000;       // reconnecting this long: stop, and say so
const STATS_MS = 2_000;

export class SupportReceiver {
  private id = crypto.randomUUID();
  private seat = "";
  private epoch = -1;
  private seq = -1;
  private pc: RTCPeerConnection | null = null;
  private described = false;
  /** Candidates for the current offer that came before its connection was made (it waits for the relay first). */
  private early: RTCIceCandidateInit[] = [];
  private channel: RealtimeChannel | null = null;
  private joined = false;
  private timers: number[] = [];
  private over = false;
  private lostAt = 0;
  private everLive = false;
  private says: MemberSays | null = null;
  private mic: MediaStreamTrack | null = null;
  private last = new Map<string, { bytes: number; at: number; lost: number; got: number; frames: number; freezes: number; jbDelay: number; jbEmit: number }>();
  private poor = 0;
  private good = 0;
  private degraded = false;
  state: SupportState = "connecting";

  constructor(
    private supabase: SupabaseClient,
    private session: string,
    private ice: () => Promise<RTCIceServer[]>,
    private relayOnly: boolean,
    private on: {
      stream: (stream: MediaStream) => void;
      state: (state: SupportState, why?: string) => void;
      says: (says: MemberSays) => void;
      figures: (figures: Figures) => void;
    },
  ) {}

  async start() {
    const { data, error } = await this.supabase.rpc("support_join", { session: this.session });
    if (error || !data) return this.finish(error?.message.includes("not live") ? "This session has ended." : "You cannot open this session.");
    this.seat = (data as { seat: string }).seat;
    this.open();
    this.every(BEAT_MS, () => void this.beat());
    this.every(JOIN_MS, () => this.tick());
    this.every(STATS_MS, () => void this.stats());
    window.addEventListener("online", this.online);
  }

  private every(ms: number, fn: () => void) { this.timers.push(window.setInterval(fn, ms)); }

  private open() {
    if (this.over) return;
    if (this.channel) void this.supabase.removeChannel(this.channel);
    this.joined = false;
    const channel = this.supabase.channel(`support:${this.session}`, { config: { private: true, broadcast: { self: false, ack: true } } })
      .on("broadcast", { event: "support" }, ({ payload }) => void this.heard(payload as Message));
    this.channel = channel;
    void this.supabase.realtime.setAuth().then(() => channel.subscribe(status => {
      if (this.channel !== channel) return;
      this.joined = status === "SUBSCRIBED";
      if (this.joined) this.ask();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        // Refused, or lost: opened again shortly; the beat says if the session is over.
        window.setTimeout(() => { if (this.channel === channel) this.open(); }, 2_000 + Math.random() * 2_000);
      }
    }));
  }

  private async send(message: Message) {
    const channel = this.channel;
    if (!channel || !this.joined) return false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sent = await channel.send({ type: "broadcast", event: "support", payload: { ...message, from: this.id, seat: this.seat } }).catch(() => "error");
      if (sent === "ok") return true;
      await new Promise(resolve => window.setTimeout(resolve, 200 + attempt * 300));
    }
    return false;
  }

  private ask() { void this.send({ kind: "join" }); }

  private tick() {
    if (this.over) return;
    const live = this.pc?.connectionState === "connected";
    if (!live) {
      this.ask();
      if (this.everLive && this.lostAt && Date.now() - this.lostAt > GIVE_UP_MS) this.finish("The member's computer could not be reached for two minutes.", "connection_lost");
    }
  }

  private online = () => { if (this.pc && this.pc.connectionState !== "connected") this.ask(); };

  private async beat() {
    if (this.over) return;
    const { data, error } = await this.supabase.rpc("support_beat", { session: this.session });
    if (error) {
      if (/not allowed/.test(error.message)) this.finish("You are no longer allowed to see this session.");
      return; // a network blip: the next beat tries again
    }
    const row = data as { status: string; seat: string | null; end_reason: string | null };
    if (row.status === "ended") return this.finish(endedText(row.end_reason));
    // Opened again elsewhere: this tab gives way.
    if (row.seat && row.seat !== this.seat) this.finish("This session was opened in another tab or window.", null);
  }

  private async heard(message: Message) {
    if (this.over) return;
    if (message.kind === "ended") return void this.beat();
    if (message.to && message.to !== this.id) return;
    if (message.seat && message.seat !== this.seat) return;
    if (message.kind === "state" && message.says) {
      if ((message.seq ?? 0) <= this.seq) return;
      this.seq = message.seq ?? 0;
      this.says = message.says;
      this.on.says(message.says);
      this.show();
      return;
    }
    if (message.kind === "candidate" && message.candidate) {
      if (message.epoch !== this.epoch) return;
      if (this.pc?.remoteDescription) void this.pc.addIceCandidate(message.candidate).catch(() => {});
      else this.early.push(message.candidate);
      return;
    }
    if (message.kind !== "offer" || !message.sdp || message.to !== this.id) return;
    const epoch = message.epoch ?? 0;
    if (epoch <= this.epoch) return; // stale or repeated
    this.epoch = epoch;
    this.early = [];
    this.pc?.close();
    const ice = await this.ice();
    if (this.over || this.epoch !== epoch) return;
    const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: this.relayOnly ? "relay" : "all" });
    this.pc = pc;
    this.described = false;
    this.last.clear();
    pc.ontrack = ({ streams, track, receiver }) => {
      // Keep the picture near live. Without this, Chrome's video jitter buffer grows to smooth the
      // freezes that loss causes on a relay (nothing is retransmitted), so the screen drifts seconds
      // behind the voice. Cap it: a lost frame becomes a brief skip to the live edge, not a growing
      // lag. The voice keeps its own shallow buffer and stays live. (Chrome 114+; older ignores it.)
      if (track.kind === "video" && "jitterBufferTarget" in receiver) {
        try { (receiver as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = 200; } catch { /* unsupported */ }
      }
      this.on.stream(streams[0] ?? new MediaStream([track]));
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.described && this.pc === pc) void this.send({ kind: "candidate", to: message.from, epoch, candidate: candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc || this.over) return;
      if (pc.connectionState === "connected") { this.everLive = true; this.lostAt = 0; }
      else if (!this.lostAt && (pc.connectionState === "disconnected" || pc.connectionState === "failed")) {
        this.lostAt = Date.now();
        window.setTimeout(() => { if (this.pc === pc && pc.connectionState !== "connected") this.ask(); },
          pc.connectionState === "failed" ? 0 : RECONNECT_AFTER_MS);
      }
      this.show();
    };
    await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
    for (const candidate of this.early.splice(0)) void pc.addIceCandidate(candidate).catch(() => {});
    // The voice goes back on the same audio line: the microphone, when the manager turns it on.
    const audio = pc.getTransceivers().find(t => t.receiver.track.kind === "audio");
    if (audio) {
      audio.direction = "sendrecv";
      if (this.mic) await audio.sender.replaceTrack(this.mic);
    }
    await pc.setLocalDescription();
    await gathered(pc, ice.some(server => [server.urls].flat().some(url => url.startsWith("turn"))));
    if (this.pc !== pc || this.over) return;
    await this.send({ kind: "answer", to: message.from, epoch, sdp: pc.localDescription!.sdp });
    this.described = true;
    this.show();
  }

  /** The manager's microphone, on or off: no new offer is needed, it rides the line already there. */
  async setMic(on: boolean): Promise<string | null> {
    if (on && !this.mic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.mic = stream.getAudioTracks()[0];
        this.mic.contentHint = "speech";
      } catch {
        return "The microphone could not be used. Allow it for this site, then try again.";
      }
    }
    if (this.mic) this.mic.enabled = on;
    const sender = this.pc?.getTransceivers().find(t => t.receiver.track.kind === "audio")?.sender;
    if (sender && sender.track !== this.mic) await sender.replaceTrack(this.mic).catch(() => {});
    return null;
  }

  private show() {
    if (this.over) return;
    const pc = this.pc;
    let next: SupportState;
    if (!pc || !this.everLive) next = this.lostAt ? "reconnecting" : "connecting";
    else if (pc.connectionState !== "connected") next = "reconnecting";
    else if (this.says?.screen === "paused" || this.says?.screen === "lost") next = "paused";
    else next = this.degraded ? "degraded" : "live";
    if (next !== this.state) { this.state = next; this.on.state(next); }
  }

  /** The browser's own figures, every two seconds: what the manager sees in Details, and
   * whether the picture is good enough to call "live" (with some patience either way). */
  private async stats() {
    const pc = this.pc;
    if (!pc || this.over) return;
    const all = new Map<string, Record<string, unknown>>();
    let chosen: string | undefined;
    (await pc.getStats()).forEach((stat: Record<string, unknown>) => {
      all.set(stat.id as string, stat);
      if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") chosen = stat.selectedCandidatePairId;
    });
    if (!chosen) for (const stat of all.values()) if (stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") chosen = stat.id as string;
    const pair = chosen ? all.get(chosen) : undefined;
    const local = pair ? all.get(pair.localCandidateId as string) : undefined;
    const remote = pair ? all.get(pair.remoteCandidateId as string) : undefined;
    const ends = [local?.candidateType, remote?.candidateType];
    const figures: Figures = {
      route: !pair ? "none yet" : ends.includes("relay") ? "relay" : ends.every(type => type === "host") ? "direct, same network" : "direct, over the internet",
      local: String(local?.candidateType ?? "-"), remote: String(remote?.candidateType ?? "-"),
      protocol: String(local?.relayProtocol ?? local?.protocol ?? "-"),
      rtt: typeof pair?.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null,
      videoKbps: 0, audioKbps: 0, fps: null, width: null, height: null, videoLoss: 0, audioLoss: 0, jitter: null, framesDecoded: 0, freezes: 0, videoDelay: null,
    };
    const now = Date.now();
    let newFreezes = 0;         // real decode freezes in this interval (not a still desktop)
    let framesAdvanced = 0;     // frames actually decoded in this interval
    for (const stat of all.values()) {
      if (stat.type !== "inbound-rtp") continue;
      const kind = stat.kind as string;
      const bytes = Number(stat.bytesReceived ?? 0), lost = Number(stat.packetsLost ?? 0), got = Number(stat.packetsReceived ?? 0);
      const frames = Number(stat.framesDecoded ?? 0), freezes = Number(stat.freezeCount ?? 0);
      const jbDelay = Number(stat.jitterBufferDelay ?? 0), jbEmit = Number(stat.jitterBufferEmittedCount ?? 0);
      const before = this.last.get(kind);
      this.last.set(kind, { bytes, at: now, lost, got, frames, freezes, jbDelay, jbEmit });
      const kbps = before ? Math.round(((bytes - before.bytes) * 8) / Math.max(1, now - before.at)) : 0;
      const loss = before ? Math.max(0, lost - before.lost) / Math.max(1, (lost - before.lost) + (got - before.got)) : 0;
      if (kind === "video") {
        if (before) { newFreezes = Math.max(0, freezes - before.freezes); framesAdvanced = Math.max(0, frames - before.frames); }
        // How far behind live the picture is playing now: the jitter buffer delay added per frame
        // over this interval (seconds summed ÷ frames emitted), in ms.
        const emitted = before ? jbEmit - before.jbEmit : 0;
        const delay = before && emitted > 0 ? Math.round(((jbDelay - before.jbDelay) / emitted) * 1000) : null;
        const fpsStat = stat.framesPerSecond;
        Object.assign(figures, { videoKbps: kbps, videoLoss: loss, videoDelay: delay,
          fps: typeof fpsStat === "number" ? Math.round(fpsStat) : null,
          width: Number(stat.frameWidth ?? 0) || null, height: Number(stat.frameHeight ?? 0) || null,
          framesDecoded: frames, freezes });
      } else {
        Object.assign(figures, { audioKbps: kbps, audioLoss: loss, jitter: typeof stat.jitter === "number" ? Math.round(stat.jitter * 1000) : null });
      }
    }
    this.on.figures(figures);
    // Poor means the LINE is struggling, not that the desktop is still. A static screen legitimately
    // decodes few frames, so low fps is never on its own a fault. Judge by real loss, and by genuine
    // decode freezes that happen while the picture is actually moving (frames advanced but it stalled).
    const poor = pc.connectionState === "connected"
      && (figures.audioLoss > 0.08 || figures.videoLoss > 0.1 || (newFreezes > 0 && framesAdvanced > 0));
    if (poor) { this.poor += 1; this.good = 0; } else { this.good += 1; this.poor = 0; }
    if (!this.degraded && this.poor >= 2) this.degraded = true;
    if (this.degraded && this.good >= 5) this.degraded = false;
    this.show();
  }

  private finish(why: string, reason: string | null = null) {
    if (this.over) return;
    this.over = true;
    if (reason) void this.supabase.rpc("support_end", { session: this.session, reason });
    this.close();
    this.state = "ended";
    this.on.state("ended", why);
  }

  private close() {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
    window.removeEventListener("online", this.online);
    this.pc?.close();
    this.pc = null;
    this.mic?.stop();
    this.mic = null;
    if (this.channel) void this.supabase.removeChannel(this.channel);
    this.channel = null;
  }

  /** The manager ends the session for both: the app stops capturing as soon as it hears,
   * and in any case at its next look at the session. */
  async end() {
    if (this.over) return;
    await this.send({ kind: "ended", reason: "manager_ended" });
    await this.supabase.rpc("support_end", { session: this.session, reason: "manager_ended" });
    this.finish("You ended the session.");
  }

  /** The page is closing without ending: the app waits a while for the manager to come back. */
  leaving() {
    if (this.over) return;
    void this.send({ kind: "leave" });
    void this.supabase.rpc("support_note", { session: this.session, what: "manager_left", detail: {} });
  }

  stop() {
    if (this.over) return;
    this.over = true;
    this.close();
  }
}

export function endedText(reason: string | null): string {
  switch (reason) {
    case "member_stopped": case "stopped": return "The member stopped sharing.";
    case "manager_ended": return "The session was ended by the manager.";
    case "lapsed": return "The member's app stopped answering, so the session ended.";
    case "revoked": return "The manager is no longer allowed to support this member, so the session ended.";
    case "manager_gone": return "The session ended because the manager was away too long.";
    case "signed_out": return "The member signed out of the app.";
    case "app_restart": return "The member's app was restarted; sharing needs a new approval.";
    case "declined": return "The member declined the invitation.";
    case "invite_expired": return "The invitation was not answered in time.";
    default: return "This session has ended.";
  }
}
