import { RealtimeClient, type RealtimeChannel } from "@supabase/supabase-js";
import { scriptTopic } from "./live-words";

/** How a member's live script reaches the admins who read it, whatever the network and
 * whatever the member is doing in the browser.
 *
 * The rules that make it hold up:
 * - Nothing that matters waits on the page's timers: a hidden tab's run once a minute. A word
 *   goes out the moment it arrives; everything else runs on a worker's clock (live-clock.js).
 * - Nothing queues behind a slow network. Only so much may be unconfirmed at a time; beyond
 *   that, new words gather, and go as one change when the network has taken the last ones. So
 *   on a poor connection the words come in bigger steps, but never further and further behind.
 *   One small probe confirms everything sent before it, so a poor connection is not also
 *   carrying an answer to every change.
 * - Getting it back is cheap. A reader who lost something asks only for what it lacks, and a
 *   reader who opens a long script gets the newest words first, and the older ones after them.
 * - A connection that has gone quiet is not waited for: it is replaced. Until then, changes go
 *   by plain web request.
 * - It has its own connection, so no other page's channels can get in its way.
 * - Each side says it is still there, so silence on a call is not taken for a lost connection.
 *
 * The words are never stored. Readers and writers from before this speak `change`, `whole` and
 * `want` too, so tabs left open across an update go on working with each other. */

const CLOCK_URL = "/live-clock.js";

const LEAST_ROOM = 800;         // characters that may be sent and not yet confirmed, at the least
const MOST_ROOM = 8_000;        // at the most
const FIRST_ROOM = 1_600;       // to start with: it then follows what the connection can take
const PROBE_AT = 800;           // characters sent before asking for a confirmation at once
const PROBE_EVERY_MS = 1_000;   // or this often, while anything is unconfirmed
const OVERHEAD = 140;           // what a change costs on the wire beyond its words
const FASTEST_MS = 100;         // the shortest wait between two changes
const SLOWEST_MS = 2_000;       // the longest, for a reader on a very poor connection
const BACKLOG_MS = 2_000;       // a reader this far behind its usual delay has a backlog
const NO_BACKLOG_MS = 1_000;    // and this close to it has none
const TICK_EVERY_MS = 2_000;    // how often the writer says where it has got to
const SEEN_EVERY_MS = 1_000;    // how often a reader says what it has got
const REFRESH_EVERY_MS = 240_000; // a hidden tab does not renew its sign-in by itself
const TAIL_FIRST = 1_500;       // characters a new reader gets at once: the newest
const CHUNK_FAST = 8_000;       // older characters at a time, after that, on a good connection
const CHUNK_SLOW = 1_500;       // and on a poor one
const CORRECTED_BACK = 2_400;   // how far back Windows can still be correcting (about 300 words)
const CHECK_LENGTH = 2_048;     // the stretch compared, to tell that two copies agree
const QUIET_MS = 7_000;         // a reader who hears nothing for this long has lost the connection
const TOO_BIG = 8_000;          // characters too many for one change: readers ask for what they lack

/** A clock that keeps time in a hidden tab. Gives back how to stop it. */
export function startClock(everyMs: number, tick: () => void): () => void {
  let timer = 0;
  let worker: Worker | null = null;
  const fallBack = () => { if (!timer) timer = window.setInterval(tick, everyMs); };
  try {
    worker = new Worker(CLOCK_URL);
    worker.onmessage = () => tick();
    worker.onerror = () => { worker?.terminate(); worker = null; fallBack(); };
    worker.postMessage({ event: "start", interval: everyMs });
  } catch { fallBack(); }
  return () => { worker?.terminate(); worker = null; window.clearInterval(timer); };
}

/** A short fingerprint of a piece of text, to tell two copies apart. */
export function fingerprint(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Where the newest words start, for a reader who has nothing yet: at a sentence if one is near. */
export function tailStart(text: string): number {
  if (text.length <= TAIL_FIRST) return 0;
  const from = text.length - TAIL_FIRST;
  const sentence = text.slice(from).search(/[.!?]\s/);
  if (sentence !== -1 && sentence < TAIL_FIRST / 2) return from + sentence + 2;
  const space = text.indexOf(" ", from);
  return space === -1 ? from : space + 1;
}

type Access = { url: string; key: string; token: () => Promise<string | null> };

/** The signed-in person's token, looked up at most every 20 seconds, as it is asked for with each
 * probe. Asking for it also renews it if it is close to running out, which a hidden tab
 * does not otherwise do. */
export function tokenFrom(supabase: { auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }> } }) {
  let token: string | null = null;
  let at = 0;
  return async () => {
    if (token && Date.now() - at < 20_000) return token;
    token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    at = Date.now();
    return token;
  };
}

type Handler = (payload: Record<string, unknown>) => void;

/** One connection and its one channel, which can be replaced whole if it goes quiet. */
class Link {
  channel: RealtimeChannel | null = null;
  joined = false;
  generation = 0;
  /** When the probe still unanswered went, or 0. */
  probedAt = 0;
  private client: RealtimeClient | null = null;
  private sendBeat: () => void = () => {};

  constructor(private access: Access, private topic: string,
    private handlers: Record<string, Handler>, private onJoined: () => void, private onLost: () => void,
    private onConfirmed: (roundTripMs: number) => void = () => {}) {}

  open() {
    this.close();
    const generation = ++this.generation;
    const { url, key, token } = this.access;
    const client = new RealtimeClient(`${url}/realtime/v1`, {
      params: { apikey: key },
      accessToken: token,
      worker: true,
      workerUrl: CLOCK_URL,
      heartbeatIntervalMs: 12_000,
      timeout: 20_000,
      reconnectAfterMs: (tries: number) => [300, 800, 1_500, 3_000][tries - 1] ?? 5_000,
    });
    this.client = client;
    this.probedAt = 0;
    // The library's heartbeat is the probe: the server answers it after all that came before it.
    // A second one sent while one is unanswered would make the library close the connection,
    // so its own (from the clock) goes through this as well.
    const beat = client.sendHeartbeat.bind(client);
    this.sendBeat = () => {
      if (generation !== this.generation || this.probedAt || !client.isConnected()) return;
      this.probedAt = Date.now();
      void beat();
    };
    client.sendHeartbeat = async () => this.sendBeat();
    client.onHeartbeat((status, latency) => {
      if (generation !== this.generation || status === "sent") return;
      this.probedAt = 0;
      // Not from in here: the library marks this heartbeat as answered only after this returns,
      // and it would take another one sent now for a second one sent too early, and hang up.
      if (status === "ok") queueMicrotask(() => { if (generation === this.generation) this.onConfirmed(latency ?? 0); });
    });
    let channel = client.channel(this.topic, { config: { private: true, broadcast: { self: false } } });
    for (const [event, handle] of Object.entries(this.handlers)) {
      channel = channel.on("broadcast", { event }, ({ payload }) => { if (generation === this.generation) handle(payload); });
    }
    this.channel = channel;
    void client.setAuth().catch(() => { /* It is asked for again as it joins. */ }).then(() => {
      if (generation !== this.generation) return;
      channel.subscribe(status => {
        if (generation !== this.generation) return;
        const joined = status === "SUBSCRIBED";
        if (joined === this.joined && !joined) return;
        this.joined = joined;
        this.probedAt = 0;  // Whatever was out went with the old connection.
        if (joined) this.onJoined(); else this.onLost();
      });
    });
  }

  probe() { this.sendBeat(); }

  close() {
    this.generation += 1;
    this.joined = false;
    this.channel = null;
    this.probedAt = 0;
    const client = this.client;
    this.client = null;
    // Not waited for: on a dead connection these take a while, and nothing depends on them.
    if (client) void client.removeAllChannels().catch(() => {}).then(() => client.disconnect()).catch(() => {});
  }

  /** Keep the sign-in fresh: the server ends a connection whose token has run out. */
  refresh() { void this.client?.setAuth().catch(() => {}); }
}

/** How long to give a connection to join before replacing it: longer each time it does not. */
const joinPatience = (tries: number) => Math.min(30_000, 12_000 * 1.5 ** tries);

type Reply = { to: string; next: number };

/** The member's side: takes the script as it grows, and sends it on. */
export class ScriptWriter {
  private link: Link;
  private stopClock: () => void = () => {};
  private session = Math.random().toString(36).slice(2, 8);
  private running = false;
  private n = 0;
  private sent = "";            // the script as readers will have it, once what is on its way lands
  private safe = "";            // the script as far as the server has said it has it
  private unconfirmed = 0;      // characters sent since the last confirmation began
  private probe: { text: string; size: number } | null = null;  // what the probe out now confirms
  private lastProbe = 0;
  private roundTrip = 300;
  private stalls = 0;
  private room = FIRST_ROOM;
  private heldBack = false;     // words had to wait for room since the last confirmation
  private trips: number[] = [];
  private lastSent = 0;
  private gap = FASTEST_MS;
  private bySeq = new Map<number, number>();
  private delays: number[] = [];
  private lastBacklog = 0;
  private lastTick = 0;
  private lastRefresh = Date.now();
  private lostAt = Date.now();
  private tries = 0;
  private overWeb = false;
  private lastOverWeb = 0;
  private olderParts: Reply[] = [];

  constructor(access: Access, member: string, private current: () => string) {
    this.link = new Link(access, scriptTopic(member), {
      want: payload => this.heardWant(payload),
      seen: payload => this.heardSeen(payload),
    }, () => this.joined(), () => { this.lostAt = Date.now(); this.rewind(); }, ms => this.confirmed(ms));
  }

  /** The server has everything sent before the probe. */
  private confirmed(roundTripMs: number) {
    this.roundTrip = roundTripMs;
    this.stalls = 0;
    this.trips.push(roundTripMs);
    if (this.trips.length > 8) this.trips.shift();
    // Longer than its best lately means something is waiting on the way: leave less room. If not,
    // and words had to wait for room, the connection can take more.
    const over = roundTripMs - Math.min(...this.trips);
    if (over > 1_500) this.room = Math.max(LEAST_ROOM, this.room * 0.7);
    else if (over < 1_000 && this.heldBack) this.room = Math.min(MOST_ROOM, this.room * 1.3);
    this.heldBack = false;
    if (this.probe) {
      this.safe = this.probe.text;
      this.unconfirmed = Math.max(0, this.unconfirmed - this.probe.size);
      this.probe = null;
    }
    this.pump();
  }

  start() {
    this.running = true;
    this.lostAt = Date.now();
    // Whatever is already written is not sent to no one: a reader asks, for what it lacks.
    this.sent = this.safe = this.current();
    this.link.open();
    this.stopClock = startClock(FASTEST_MS, () => this.tick());
    window.addEventListener("online", this.networkBack);
  }

  stop() {
    this.running = false;
    this.stopClock();
    window.removeEventListener("online", this.networkBack);
    this.link.close();
  }

  /** The script changed. This runs as the words arrive, so it needs no timer, even hidden. */
  changed() { if (this.running) this.pump(); }

  /** What was on its way may be lost: the next change starts from what the server surely has.
   * A reader can always take it, as a change only says "from here on, it reads like this". */
  private rewind() {
    this.sent = this.safe;
    this.unconfirmed = 0;
    this.probe = null;
  }

  private joined() {
    this.tries = 0;
    this.rewind();
    this.sendTick();    // A reader who missed something can tell from this, and asks.
    this.pump();
  }

  private pump() {
    if (!this.running) return;
    const now = Date.now();
    const text = this.current();
    if (text !== this.sent) {
      if (this.link.joined) {
        if (this.unconfirmed >= this.room) this.heldBack = true;
        else if (now - this.lastSent >= this.gap) this.sendChange(text, now);
      } else this.sendOverWeb(text, now);
    } else if (this.link.joined && this.olderParts.length && this.unconfirmed < PROBE_AT) this.sendOlder();
    this.askConfirmation(now);
  }

  private askConfirmation(now: number) {
    if (!this.link.joined || !this.unconfirmed || this.link.probedAt) return;
    if (this.unconfirmed < PROBE_AT && now - this.lastProbe < PROBE_EVERY_MS) return;
    this.lastProbe = now;
    this.probe = { text: this.sent, size: this.unconfirmed };
    this.link.probe();
  }

  private difference(text: string) {
    const before = this.sent;
    let same = 0;
    const most = Math.min(text.length, before.length);
    while (same < most && text[same] === before[same]) same += 1;
    return { at: same, tail: text.slice(same) };
  }

  /** All at once (the page came back to a long script) is not to be pushed through as one change:
   * readers can tell from the next tick, and ask for what they lack. */
  private tooBig(tail: string, text: string) {
    if (tail.length <= TOO_BIG) return false;
    this.n += 1;
    this.sent = this.safe = text;
    this.sendTick();
    return true;
  }

  private sendChange(text: string, now: number) {
    const channel = this.link.channel;
    if (!channel) return;
    const change = this.difference(text);
    if (this.tooBig(change.tail, text)) return;
    const payload = { s: this.session, n: ++this.n, ...change };
    this.sent = text;
    this.lastSent = now;
    this.unconfirmed += change.tail.length + OVERHEAD;
    this.bySeq.set(payload.n, now);
    if (this.bySeq.size > 512) this.bySeq.delete(this.bySeq.keys().next().value as number);
    void channel.send({ type: "broadcast", event: "change", payload });
  }

  /** No joined connection: one web request at a time, for as long as that lasts. */
  private sendOverWeb(text: string, now: number) {
    const channel = this.link.channel;
    if (!channel || this.overWeb || now - this.lastOverWeb < 800) return;
    const change = this.difference(text);
    if (this.tooBig(change.tail, text)) return;
    this.overWeb = true;
    this.lastOverWeb = now;
    const payload = { s: this.session, n: ++this.n, ...change };
    this.sent = text;
    const finish = (ok: boolean) => {
      this.overWeb = false;
      if (ok) this.safe = text;
      else if (!this.link.joined) this.sent = this.safe;
      this.pump();
    };
    channel.httpSend("change", payload, { timeout: 10_000 }).then(result => finish(result.success), () => finish(false));
  }

  private sendTick() {
    const channel = this.link.channel;
    if (!channel || !this.link.joined) return;
    this.lastTick = Date.now();
    const text = this.sent;
    this.unconfirmed += OVERHEAD;
    void channel.send({ type: "broadcast", event: "tick", payload: { s: this.session, n: this.n, l: text.length, h: fingerprint(text.slice(-CHECK_LENGTH)) } });
  }

  /** Someone needs some or all of the script. It answers with the script as sent so far, so
   * that the next change follows on from it for them too. */
  private heardWant(payload: Record<string, unknown>) {
    const channel = this.link.channel;
    if (!channel) return;
    const text = this.sent;
    const to = payload.id as string | undefined;
    // A reader from before all this wants the whole of it.
    if (!to) {
      void channel.send({ type: "broadcast", event: "whole", payload: { n: this.n, text } });
      return;
    }
    const start = (payload.start as number) ?? 0;
    const end = (payload.end as number) ?? 0;
    const at = Math.max(start, end - CORRECTED_BACK);
    const agrees = end > 0 && end <= text.length + CORRECTED_BACK
      && fingerprint(text.slice(Math.max(start, at - CHECK_LENGTH), at)) === payload.h;
    this.olderParts = this.olderParts.filter(reply => reply.to !== to);
    if (agrees) {
      this.unconfirmed += text.length - at + OVERHEAD;
      void channel.send({ type: "broadcast", event: "resync", payload: { to, s: this.session, n: this.n, at, tail: text.slice(at) } });
      if (start > 0) this.olderParts.push({ to, next: start });
      return;
    }
    const from = tailStart(text);
    this.unconfirmed += text.length - from + OVERHEAD;
    void channel.send({ type: "broadcast", event: "resync", payload: { to, s: this.session, n: this.n, at: from, tail: text.slice(from), reset: true } });
    if (from > 0) this.olderParts.push({ to, next: from });
  }

  /** The older part of the script, a piece at a time, behind any new words. */
  private sendOlder() {
    const channel = this.link.channel;
    const reply = this.olderParts[0];
    if (!channel || !reply) return;
    const from = Math.max(0, reply.next - (this.roundTrip < 600 ? CHUNK_FAST : CHUNK_SLOW));
    const payload = { to: reply.to, at: from, text: this.sent.slice(from, reply.next) };
    reply.next = from;
    if (from === 0) this.olderParts.shift();
    this.unconfirmed += payload.text.length + OVERHEAD;
    void channel.send({ type: "broadcast", event: "older", payload });
  }

  /** A reader says how far it has got. If it has a backlog, its connection cannot take this
   * many changes: send fewer, bigger ones. What counts is the delay over the shortest seen
   * lately, as a poor connection has a long delay, and a jumpy one, with nothing waiting. */
  private heardSeen(payload: Record<string, unknown>) {
    const sentAt = payload.s === this.session ? this.bySeq.get(payload.n as number) : undefined;
    // Without how long the reader has had it, a quiet moment on the call would look like a backlog.
    if (sentAt === undefined || typeof payload.held !== "number") return;
    const delay = Date.now() - sentAt - payload.held;
    this.delays.push(delay);
    if (this.delays.length > 12) this.delays.shift();
    const waiting = delay - Math.min(...this.delays);
    const now = Date.now();
    if (waiting > BACKLOG_MS) {
      if (now - this.lastBacklog > 2_000) {
        this.lastBacklog = now;
        this.gap = Math.min(SLOWEST_MS, this.gap * 1.5);
      }
    } else if (waiting < NO_BACKLOG_MS) this.gap = Math.max(FASTEST_MS, this.gap * 0.9);
  }

  private tick() {
    if (!this.running) return;
    const now = Date.now();
    this.pump();
    if (this.link.joined && now - this.lastTick >= TICK_EVERY_MS && this.unconfirmed < this.room) this.sendTick();
    if (now - this.lastRefresh >= REFRESH_EVERY_MS) {
      this.lastRefresh = now;
      this.link.refresh();
    }
    // A probe that has had no answer for this long is not getting one: the connection is gone,
    // even if nothing has told the browser so yet. A slow connection gets longer to answer in.
    const patience = Math.min(30_000, Math.max(8_000, this.roundTrip * 4) * 1.5 ** this.stalls);
    if (this.link.joined && this.link.probedAt && now - this.link.probedAt > patience) {
      this.stalls += 1;
      this.reopen(now);
    } else if (!this.link.joined && now - this.lostAt > joinPatience(this.tries)) {
      this.tries += 1;
      this.reopen(now);
    }
  }

  /** Back on a network: no reason to wait for the clock. The connection from before is likely dead,
   * even if it still says it is joined. */
  private networkBack = () => {
    if (!this.running) return;
    this.tries = 0;
    this.reopen(Date.now());
  };

  private reopen(now: number) {
    this.lostAt = now;
    this.rewind();
    this.link.open();
  }
}

export type ReadingState = "opening" | "live" | "waiting";

/** An admin's side: holds the script as far as it has arrived, and keeps it right. */
export class ScriptReader {
  private link: Link;
  private stopClock: () => void = () => {};
  private id = Math.random().toString(36).slice(2, 10);
  private running = false;
  private text = "";
  private startsAt = 0;       // where in the whole script this text starts: older words come after
  private session: unknown = undefined;
  private n = -1;
  private heard = 0;        // when anything last came from the member
  private asked = 0;        // when the script was last asked for, 0 if not waiting for it
  private askAfter = 3_000;
  private behindTicks = 0;
  private seenSent = -1;
  private lastSeen = 0;
  private arrived = 0;      // when the newest change came
  private lastRefresh = Date.now();
  private lostAt = Date.now();
  private tries = 0;
  private lastQuietOpen = 0;
  private state: ReadingState = "opening";
  private spoken = false;   // this member's page speaks the new language

  constructor(access: Access, member: string, private onText: (text: string, older?: string) => void, private onState: (state: ReadingState) => void) {
    this.link = new Link(access, scriptTopic(member), {
      change: payload => this.heardChange(payload),
      whole: payload => this.heardWhole(payload),
      resync: payload => this.heardResync(payload),
      older: payload => this.heardOlder(payload),
      tick: payload => this.heardTick(payload),
    }, () => this.ask(), () => { this.lostAt = Date.now(); });
  }

  /** Back on a network: no reason to wait for the clock. */
  private networkBack = () => {
    if (!this.running) return;
    this.tries = 0;
    this.lostAt = Date.now();
    this.link.open();
  };

  begin() {
    this.running = true;
    this.lostAt = Date.now();
    this.heard = Date.now();
    this.link.open();
    this.stopClock = startClock(250, () => this.tick());
    window.addEventListener("online", this.networkBack);
  }

  end() {
    this.running = false;
    this.stopClock();
    window.removeEventListener("online", this.networkBack);
    this.link.close();
  }

  private setState(state: ReadingState) {
    if (state === this.state) return;
    this.state = state;
    this.onState(state);
  }

  private fresh() {
    this.heard = Date.now();
    this.tries = 0;
    if (this.state === "waiting") this.setState("live");
  }

  private show(older?: string) { this.onText(this.text, older); }

  private ended = () => this.startsAt + this.text.length;

  private ask() {
    const channel = this.link.channel;
    if (!channel || !this.link.joined) return;
    this.asked = Date.now();
    const end = this.ended();
    const at = Math.max(this.startsAt, end - CORRECTED_BACK);
    const h = fingerprint(this.text.slice(Math.max(0, at - CHECK_LENGTH - this.startsAt), at - this.startsAt));
    void channel.send({ type: "broadcast", event: "want", payload: { id: this.id, start: this.startsAt, end, h } });
  }

  private settled() {
    this.asked = 0;
    this.askAfter = 3_000;
    this.behindTicks = 0;
    this.setState("live");
  }

  private heardChange(payload: Record<string, unknown>) {
    this.fresh();
    const n = payload.n as number;
    if (payload.s !== this.session) {
      this.session = payload.s;
      this.n = -1;
    }
    if (n <= this.n) return;
    const at = payload.at as number;
    // Words from before what is here: this can only be what the script is now.
    if (at < this.startsAt) { this.text = payload.tail as string; this.startsAt = at; }
    // Words are missing between what is here and this: it cannot be put in place yet.
    else if (at > this.ended()) { if (!this.asked) this.ask(); return; }
    else this.text = this.text.slice(0, at - this.startsAt) + (payload.tail as string);
    this.n = n;
    this.arrived = Date.now();
    this.show();
  }

  private heardWhole(payload: Record<string, unknown>) {
    this.fresh();
    this.text = payload.text as string;
    this.startsAt = 0;
    this.n = payload.n as number;
    this.session = undefined;
    this.settled();
    this.show();
  }

  private heardResync(payload: Record<string, unknown>) {
    if (payload.to !== this.id) return;
    this.fresh();
    this.spoken = true;
    const at = payload.at as number;
    if (payload.reset || at < this.startsAt) {
      this.text = payload.tail as string;
      this.startsAt = at;
    } else {
      this.text = this.text.slice(0, at - this.startsAt) + (payload.tail as string);
    }
    this.session = payload.s;
    this.n = payload.n as number;
    this.arrived = Date.now();
    this.settled();
    this.show();
  }

  private heardOlder(payload: Record<string, unknown>) {
    if (payload.to !== this.id) return;
    this.fresh();
    const older = payload.text as string;
    if ((payload.at as number) + older.length !== this.startsAt) return;
    this.text = older + this.text;
    this.startsAt = payload.at as number;
    this.show(older);
  }

  private heardTick(payload: Record<string, unknown>) {
    this.fresh();
    this.spoken = true;
    if (payload.s !== this.session) {
      // The member's page reloaded: if the words agree, nothing has been lost.
      this.session = payload.s;
      this.n = payload.n as number;
    }
    if (this.asked) return;
    const n = payload.n as number;
    if (n > this.n) {
      // Changes can still be arriving; twice in a row, or much too far behind, means they are not.
      this.behindTicks += 1;
      if (this.behindTicks >= 2 || (payload.l as number) - this.ended() > CHECK_LENGTH) this.ask();
      return;
    }
    this.behindTicks = 0;
    if (n === this.n && (payload.l !== this.ended() || payload.h !== fingerprint(this.text.slice(-CHECK_LENGTH)))) this.ask();
  }

  private tick() {
    if (!this.running) return;
    const now = Date.now();
    if (this.link.joined && this.asked && now - this.asked > this.askAfter) {
      this.askAfter = Math.min(10_000, this.askAfter * 1.5);
      this.ask();
    }
    if (this.n !== this.seenSent && now - this.lastSeen >= SEEN_EVERY_MS && this.link.joined && this.spoken) {
      this.seenSent = this.n;
      this.lastSeen = now;
      void this.link.channel?.send({ type: "broadcast", event: "seen", payload: { s: this.session, n: this.n, held: this.arrived ? now - this.arrived : 0 } });
    }
    if (now - this.lastRefresh >= REFRESH_EVERY_MS) {
      this.lastRefresh = now;
      this.link.refresh();
    }
    const quiet = now - this.heard;
    if (this.spoken && quiet > QUIET_MS && this.state !== "opening") this.setState("waiting");
    if (!this.link.joined) {
      if (now - this.lostAt > joinPatience(this.tries)) {
        this.tries += 1;
        this.lostAt = now;
        this.link.open();
      }
    } else if (this.spoken && quiet > QUIET_MS && now - this.lastQuietOpen > Math.min(30_000, QUIET_MS * 2 ** this.tries)) {
      // A joined connection saying nothing: it may be this side's that has gone. Try a new one.
      this.tries += 1;
      this.lastQuietOpen = now;
      this.lostAt = now;
      this.link.open();
    }
  }
}
