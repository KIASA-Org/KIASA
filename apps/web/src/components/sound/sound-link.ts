import { RealtimeClient, type RealtimeChannel } from "@supabase/supabase-js";
import { startClock } from "@/components/interview/live-link";
import { clearVoice, gathered } from "@/components/meet/rtc";

/** How a member's computer sound reaches the admins who listen to it.
 *
 * The sound goes straight between the two browsers (through the relay when a network
 * will not let it) and is never stored. They find each other on a private channel,
 * sound:<member's id>, which only that member and KIASA's admins can join: the database
 * decides that as a browser joins, so whoever is on it may hear the sound.
 *
 * The member always makes the offer, and the admin always answers. So the two can never
 * offer at once, and a lost message is put right by the admin asking again.
 *
 * Each side has its own connection on a worker's clock: the member is usually working in
 * another window, where a page's own timers run once a minute. */

const CLOCK_URL = "/live-clock.js";
const HEARTBEAT_MS = 12_000;
const REFRESH_MS = 240_000;       // a hidden tab does not renew its sign-in by itself
const REOPEN_MS = 15_000;         // a channel not back by then is opened again
const OFFER_PATIENCE_MS = 15_000; // an offer not connected by then may be made again
const ASK_MS = 3_000;             // how often an admin not yet hearing asks
const GONE_MS = 20_000;           // silence for this long: is the member still sharing?
const STUN: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

export type SoundAccess = { url: string; key: string; token: () => Promise<string | null> };
type Signal = {
  from: string; to?: string;
  /** An admin wants the sound, or the member asks any admin listening to say so again. */
  listen?: boolean; ask?: boolean;
  /** An admin has stopped listening; the member has stopped sharing. */
  bye?: boolean; stopped?: boolean;
  description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit;
};

const relayed = (ice: RTCIceServer[]) => ice.some(server => [server.urls].flat().some(url => url.startsWith("turn")));
const newId = () => crypto.randomUUID();

/** The channel, and its own connection, opened again if it is lost. */
class SoundChannel {
  joined = false;
  private client: RealtimeClient | null = null;
  private channel: RealtimeChannel | null = null;
  private openedAt = 0;
  private refreshedAt = 0;
  private generation = 0;

  constructor(private access: SoundAccess, private topic: string, private onSignal: (signal: Signal) => void,
    private onJoined: () => void, private onRefused: () => void) {}

  open() {
    this.shut();
    const generation = ++this.generation;
    const { url, key, token } = this.access;
    const client = new RealtimeClient(`${url}/realtime/v1`, {
      params: { apikey: key }, accessToken: token, worker: true, workerUrl: CLOCK_URL, heartbeatIntervalMs: HEARTBEAT_MS, timeout: 20_000,
      reconnectAfterMs: (tries: number) => [300, 800, 1_500, 3_000][tries - 1] ?? 5_000,
    });
    this.client = client;
    this.openedAt = this.refreshedAt = Date.now();
    const channel = client.channel(this.topic, { config: { private: true, broadcast: { self: false } } })
      .on("broadcast", { event: "sound" }, ({ payload }) => { if (generation === this.generation) this.onSignal(payload as Signal); });
    this.channel = channel;
    void client.setAuth().catch(() => { /* It is asked for again as it joins. */ }).then(() => {
      if (generation !== this.generation) return;
      channel.subscribe((status, error) => {
        if (generation !== this.generation) return;
        this.joined = status === "SUBSCRIBED";
        if (this.joined) this.onJoined();
        // Refused by the database, not a passing loss of the network: that one comes back.
        else if (status === "CHANNEL_ERROR" && /unauthori[sz]ed|permission/i.test(error?.message ?? "")) this.onRefused();
      });
    });
  }

  /** Called on each tick of the clock: keeps the sign-in fresh and the channel open. */
  keepUp() {
    if (!this.joined && Date.now() - this.openedAt > REOPEN_MS) return this.open();
    if (Date.now() - this.refreshedAt > REFRESH_MS) {
      this.refreshedAt = Date.now();
      void this.client?.setAuth().catch(() => {});
    }
  }

  async send(signal: Signal) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const channel = this.channel;
      if (!channel || !this.joined) return;
      const sent = await channel.send({ type: "broadcast", event: "sound", payload: signal }).catch(() => "error");
      if (sent === "ok") return;
      await new Promise(resolve => window.setTimeout(resolve, 150 + attempt * 150));
    }
  }

  private shut() {
    this.joined = false;
    this.channel = null;
    const client = this.client;
    this.client = null;
    if (client) void client.removeAllChannels().catch(() => {}).then(() => client.disconnect()).catch(() => {});
  }

  close() {
    this.generation += 1;
    this.shut();
  }
}

type Peer = { pc: RTCPeerConnection | null; at: number; described: boolean };

/** The member's side: gives the sound to each admin who asks for it. */
export class SoundSender {
  private id = newId();
  private peers = new Map<string, Peer>();
  private channel: SoundChannel;

  constructor(access: SoundAccess, member: string, private stream: MediaStream, private ice: () => Promise<RTCIceServer[]>, onRefused: () => void) {
    this.channel = new SoundChannel(access, soundTopic(member), signal => this.heard(signal), () => void this.channel.send({ from: this.id, ask: true }), onRefused);
  }

  start() { this.channel.open(); }

  tick() { this.channel.keepUp(); }

  private heard(signal: Signal) {
    if (signal.to && signal.to !== this.id) return;
    const peer = this.peers.get(signal.from);
    if (signal.listen) void this.offerTo(signal.from);
    else if (signal.bye) this.drop(signal.from);
    else if (signal.description?.type === "answer") void peer?.pc?.setRemoteDescription(signal.description).catch(() => { /* An offer since replaced. */ });
    else if (signal.candidate) void peer?.pc?.addIceCandidate(signal.candidate).catch(() => { /* Not for this offer. */ });
  }

  private async offerTo(listener: string) {
    const known = this.peers.get(listener);
    if (known && (known.pc?.connectionState === "connected" || Date.now() - known.at < OFFER_PATIENCE_MS)) return;
    this.drop(listener);
    const peer: Peer = { pc: null, at: Date.now(), described: false };
    this.peers.set(listener, peer);
    const ice = await this.ice();
    if (this.peers.get(listener) !== peer) return;
    const pc = new RTCPeerConnection({ iceServers: ice });
    peer.pc = pc;
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && peer.described) void this.channel.send({ from: this.id, to: listener, candidate: candidate.toJSON() });
    };
    // Lost: let go. The admin asks again, and gets a new offer.
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" && this.peers.get(listener) === peer) this.drop(listener); };
    await pc.setLocalDescription();
    await gathered(pc, relayed(ice));
    if (this.peers.get(listener) !== peer) return;
    await this.channel.send({ from: this.id, to: listener, description: clearVoice(pc.localDescription!.toJSON()) });
    peer.described = true;
  }

  private drop(listener: string) {
    this.peers.get(listener)?.pc?.close();
    this.peers.delete(listener);
  }

  /** The page is going away (a reload, or the tab closing): listeners are told at once if the message gets out. */
  leaving() { void this.channel.send({ from: this.id, stopped: true }); }

  async stop() {
    await Promise.race([this.channel.send({ from: this.id, stopped: true }), new Promise(resolve => window.setTimeout(resolve, 400))]);
    for (const listener of [...this.peers.keys()]) this.drop(listener);
    this.channel.close();
  }
}

export type HeardState = "connecting" | "live" | "ended" | "refused";

/** The admin's side: asks for the sound until it comes, and again if it is lost. */
export class SoundListener {
  private id = newId();
  private pc: RTCPeerConnection | null = null;
  private described = false;
  private live = false;
  private lostAt = Date.now();
  private checking = false;
  private over = false;
  private stopClock: () => void = () => {};
  private channel: SoundChannel;

  constructor(access: SoundAccess, member: string, private ice: () => Promise<RTCIceServer[]>, private stillSharing: () => Promise<boolean>,
    private onStream: (stream: MediaStream) => void, private onState: (state: HeardState) => void) {
    this.channel = new SoundChannel(access, soundTopic(member), signal => void this.heard(signal), () => this.ask(), () => this.finish("refused"));
  }

  start() {
    this.onState("connecting");
    this.channel.open();
    this.stopClock = startClock(ASK_MS, () => this.tick());
  }

  private ask() { if (!this.live) void this.channel.send({ from: this.id, listen: true }); }

  private tick() {
    this.channel.keepUp();
    if (this.live) return;
    this.ask();
    if (Date.now() - this.lostAt > GONE_MS && !this.checking) {
      this.checking = true;
      void this.stillSharing().then(yes => {
        this.checking = false;
        if (!yes) this.finish("ended");
        else this.lostAt = Date.now();
      });
    }
  }

  private async heard(signal: Signal) {
    if (this.over) return;
    if (signal.stopped) return this.finish("ended");
    if (signal.ask) return this.ask();
    if (signal.to !== this.id) return;
    if (signal.candidate) return void this.pc?.addIceCandidate(signal.candidate).catch(() => { /* Not for this offer. */ });
    if (signal.description?.type !== "offer") return;
    // A new offer takes the place of any before it.
    this.pc?.close();
    const ice = await this.ice();
    if (this.over) return;
    const pc = new RTCPeerConnection({ iceServers: ice });
    this.pc = pc;
    this.described = false;
    pc.ontrack = ({ streams, track }) => this.onStream(streams[0] ?? new MediaStream([track]));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.described && this.pc === pc) void this.channel.send({ from: this.id, to: signal.from, candidate: candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc || this.over) return;
      const live = pc.connectionState === "connected";
      if (live !== this.live) {
        this.live = live;
        if (!live) this.lostAt = Date.now();
        this.onState(live ? "live" : "connecting");
      }
    };
    await pc.setRemoteDescription(signal.description);
    await pc.setLocalDescription();
    await gathered(pc, relayed(ice));
    if (this.pc !== pc || this.over) return;
    await this.channel.send({ from: this.id, to: signal.from, description: clearVoice(pc.localDescription!.toJSON()) });
    this.described = true;
  }

  private finish(state: HeardState) {
    if (this.over) return;
    this.close();
    this.onState(state);
  }

  private close() {
    this.over = true;
    this.stopClock();
    this.pc?.close();
    this.pc = null;
    this.channel.close();
  }

  stop() {
    if (this.over) return;
    void this.channel.send({ from: this.id, bye: true }).finally(() => this.close());
    this.over = true;
    this.stopClock();
    this.pc?.close();
    this.pc = null;
  }
}

export const soundTopic = (member: string) => `sound:${member}`;

/** Fresh relay passwords now and then: a share can last all day, and each new listener needs them. */
export function iceFrom(ask: () => Promise<RTCIceServer[]>): () => Promise<RTCIceServer[]> {
  let ice: RTCIceServer[] = [];
  let at = 0;
  return async () => {
    if (at && Date.now() - at < 3_600_000) return ice;
    const got = await ask().catch(() => [] as RTCIceServer[]);
    ice = got.length ? got : STUN;
    at = got.length ? Date.now() : 0;
    return ice;
  };
}
