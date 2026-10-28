"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { initialsOf } from "@/lib/accounts/viewer";
import { askToJoin, beginMeeting, decideJoin, endMeeting } from "@/lib/meetings/actions";
import { meetingState, type Admission, type Meeting, type MeetStart } from "@/lib/meetings/types";
import { Avatar } from "../site/avatar";
import { LeafMark } from "../site/brand";
import { Check, ChevronDown, Close, Hand, Mic, MicOff, People, PhoneOff, Record, Screen, Video, VideoOff } from "../site/icons";
import { startRecording, type Recording } from "./recorder";
import { useMeeting, type LinkDetails, type PeerState, type Remote } from "./use-meeting";

/** A video element showing a stream, as the camera sees it (never mirrored),
 * silent (the sound plays elsewhere, or is one's own). `onShape`: the
 * picture's width over its height, whenever it is known or changes. */
function StreamVideo({ stream, className, onShape }: { stream: MediaStream; className?: string; onShape?: (ratio: number) => void }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = element.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);
  const measure = () => {
    const video = element.current;
    if (video?.videoWidth && video.videoHeight) onShape?.(video.videoWidth / video.videoHeight);
  };
  return <video ref={element} className={className} autoPlay playsInline muted onLoadedMetadata={measure} onResize={measure} />;
}

/** Someone's voice: played (or, for one's own, only kept for the recording). */
function Voice({ stream, own, peer }: { stream: MediaStream; own?: boolean; peer?: string }) {
  const element = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = element.current;
    if (audio && audio.srcObject !== stream) audio.srcObject = stream;
  }, [stream]);
  return <audio ref={element} data-voice data-peer={peer} autoPlay muted={own} />;
}

/** Who is speaking now: each voice's loudness, heard a few times a second. */
function useSpeaking(voices: { key: string; stream: MediaStream | null; on: boolean }[]) {
  const [speaking, setSpeaking] = useState<string[]>([]);
  const signature = voices.map(voice => `${voice.key}:${voice.on}:${voice.stream?.getAudioTracks().map(track => track.id).join(",") ?? ""}`).join("|");
  useEffect(() => {
    const listening = voices.filter(voice => voice.on && voice.stream?.getAudioTracks().length);
    if (!listening.length) return;
    const audio = new AudioContext();
    const meters = listening.map(voice => {
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(new MediaStream(voice.stream!.getAudioTracks())).connect(analyser);
      return { key: voice.key, analyser, data: new Uint8Array(analyser.fftSize) };
    });
    let last = "";
    const timer = window.setInterval(() => {
      const now = meters.filter(meter => {
        meter.analyser.getByteTimeDomainData(meter.data);
        let sum = 0;
        for (const value of meter.data) sum += ((value - 128) / 128) ** 2;
        return Math.sqrt(sum / meter.data.length) > 0.04;
      }).map(meter => meter.key);
      const key = now.join(",");
      if (key !== last) { last = key; setSpeaking(now); }
    }, 200);
    return () => {
      window.clearInterval(timer);
      void audio.close();
    };
    // The voices themselves are described by their signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return speaking;
}

/** A soft two-note ping: someone is asking to join. */
function ping() {
  try {
    const audio = new AudioContext();
    for (const [offset, pitch] of [[0, 740], [0.14, 988]] as const) {
      const tone = audio.createOscillator(), level = audio.createGain();
      tone.frequency.value = pitch;
      const at = audio.currentTime + offset;
      level.gain.setValueAtTime(0, at);
      level.gain.linearRampToValueAtTime(0.1, at + 0.02);
      level.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      tone.connect(level).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.3);
    }
    window.setTimeout(() => void audio.close(), 800);
  } catch { /* no sound here */ }
}

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const elapsed = (from: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - Date.parse(from)) / 1000));
  const two = (value: number) => String(value).padStart(2, "0");
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}` : `${Math.floor(seconds / 60)}:${two(seconds % 60)}`;
};

/** A KIASA meeting, in its own window: first a waiting screen (how you look,
 * your microphone and camera, who is already in), then the meeting: everyone's
 * faces, a shared screen large, who is speaking, raised hands, the people in
 * it, and for admins, recording to their own computer and ending it for all. */
export function MeetingRoom({ start, realtime }: { start: MeetStart; realtime: { url: string; key: string } }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [joinedHere, setJoined] = useState(false);
  const [left, setLeft] = useState(false);
  const [meeting, setMeeting] = useState<Meeting>(start.meeting);
  // Who asked to join, and whom an admin let in (live). Admins need no letting in.
  const [admissions, setAdmissions] = useState<Admission[]>(start.admissions);
  const [asked, setAsked] = useState(false);
  const allowed = useMemo(() => [...start.admins, ...admissions.filter(entry => entry.status === "admitted").map(entry => entry.user_id)], [start.admins, admissions]);
  const mine = admissions.find(entry => entry.user_id === start.me.id);
  const letIn = start.me.admin || mine?.status === "admitted";
  // In once joined, or, having asked, once let in.
  const joined = joinedHere || (asked && letIn);
  const call = useMeeting({ supabase, start, joined, allowed });
  const [panel, setPanel] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [recorder, setRecorder] = useState<Recording | null>(null);
  const [notice, setNotice] = useState("");
  const [working, act] = useTransition();
  const [now, setNow] = useState(0);
  const room = useRef<HTMLDivElement>(null);
  const { me } = start;

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // The meeting itself, live: started by an admin while you wait, or ended.
  useEffect(() => {
    let stopped = false;
    let opened: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      await supabase.realtime.setAuth();
      if (stopped) return;
      opened = supabase.channel(`meeting-row:${start.meeting.id}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meetings", filter: `id=eq.${start.meeting.id}` }, payload => setMeeting(payload.new as Meeting))
        .on("postgres_changes", { event: "*", schema: "public", table: "meeting_admissions", filter: `meeting_id=eq.${start.meeting.id}` }, payload => {
          const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Admission;
          setAdmissions(current => payload.eventType === "DELETE" ? current.filter(entry => entry.user_id !== row.user_id)
            : [...current.filter(entry => entry.user_id !== row.user_id), row]);
        })
        .subscribe(status => {
          // Back from a pause: who asked meanwhile.
          if (status === "SUBSCRIBED" && !stopped) void supabase.from("meeting_admissions").select("user_id, name, status, asked_at").eq("meeting_id", start.meeting.id)
            .then(({ data, error }) => { if (!stopped && !error && data) setAdmissions(data as Admission[]); });
        });
    })().catch(() => {});
    return () => {
      stopped = true;
      if (opened) supabase.removeChannel(opened);
    };
  }, [supabase, start.meeting.id]);

  const state = meetingState(meeting, now || Date.parse(meeting.starts_at));
  const over = call.ended || state === "ended";

  // A recording stops when its admin leaves, or the meeting ends.
  useEffect(() => {
    if ((over || left) && recorder) void recorder.stop();
  }, [over, left, recorder]);

  const waiting = admissions.filter(entry => entry.status === "waiting").sort((a, b) => a.asked_at.localeCompare(b.asked_at));
  // Someone new waiting: the admins in the meeting hear a soft ping.
  const waitingCount = me.admin && joined ? waiting.length : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (waitingCount > lastCount.current) ping();
    lastCount.current = waitingCount;
  }, [waitingCount]);
  const ask = () => act(async () => {
    setNotice("");
    const result = await askToJoin(meeting.id);
    if (result.error) { setNotice(result.error); return; }
    if (result.status === "admitted") { setJoined(true); return; }
    setAsked(true);
  });
  const decide = (person: Admission, admit: boolean) => act(async () => {
    const result = await decideJoin(meeting.id, person.user_id, admit);
    if (result.error) setNotice(result.error);
  });

  const others = call.remotes;
  const speaking = useSpeaking([
    { key: "me", stream: call.local, on: call.mic && joined },
    ...others.map(remote => ({ key: remote.peer, stream: cameraOf(remote), on: remote.mic })),
  ]);
  const recordingBy = others.find(remote => remote.recording)?.name ?? (recorder ? "You" : null);
  const hands = [...(call.hand ? [{ name: "You", at: call.hand }] : []), ...others.filter(remote => remote.hand).map(remote => ({ name: remote.name, at: remote.hand! }))]
    .sort((a, b) => a.at - b.at);

  const record = () => {
    if (recorder) { void recorder.stop(); return; }
    if (!room.current) return;
    void startRecording(room.current, meeting.title, reason => {
      setRecorder(null);
      call.setRecording(false);
      setNotice(reason || "The recording is saved on this computer.");
    }).then(started => {
      if (!started) return;
      setRecorder(started);
      call.setRecording(true);
      setNotice(`Recording to ${started.file}. Everyone in the meeting sees that it is being recorded.`);
    }).catch(() => setNotice("The recording could not start in this browser. Chrome or Edge records best."));
  };

  const leave = () => { setLeaving(false); setAsked(false); setJoined(false); setLeft(true); };
  const endForAll = () => act(async () => {
    const result = await endMeeting(meeting.id);
    if (result.error) { setNotice(result.error); return; }
    call.announceEnd();
    setLeaving(false);
    setAsked(false);
    setJoined(false);
  });
  const begin = () => act(async () => {
    const result = await beginMeeting(meeting.id);
    if (result.error) { setNotice(result.error); return; }
    setJoined(true);
  });

  if (over) return <Frame title={meeting.title} chatTitle={start.chatTitle}>
    <div className="meet-message">
      <h1>This meeting has ended</h1>
      <p>{meeting.ended_at ? `It ended at ${time(meeting.ended_at)}.` : "Its organizer ended it."}</p>
      <Link className="admin-approve" href="/chat">Back to the chat</Link>
    </div>
  </Frame>;

  if (left) return <Frame title={meeting.title} chatTitle={start.chatTitle}>
    <div className="meet-message">
      <h1>You left the meeting</h1>
      <div className="meet-message-actions">
        <button type="button" className="admin-approve" onClick={() => { setLeft(false); setJoined(true); }}>Rejoin</button>
        <Link className="account-button" href="/chat">Back to the chat</Link>
      </div>
    </div>
  </Frame>;

  if (!joined) {
    const inside = call.present.filter(entry => entry.peer !== call.peerId);
    return <Frame title={meeting.title} chatTitle={start.chatTitle}>
      <div className="meet-lobby">
        <div className="meet-preview" data-tile="face" data-camera={call.cam ? "on" : "off"}>
          {call.local && call.cam ? <StreamVideo stream={call.local} className="meet-video" />
            : <div className="meet-nobody"><Avatar initials={initialsOf(me.name)} photo={me.photo} className="meet-avatar" who={me.id} /><span>Your camera is off</span></div>}
          <div className="meet-preview-controls">
            <ControlButton on={call.mic} label={call.mic ? "Turn off microphone" : "Turn on microphone"} onClick={call.toggleMic}>{call.mic ? <Mic /> : <MicOff />}</ControlButton>
            <MicChoice current={call.local?.getAudioTracks()[0]?.label ?? null} list={call.microphones} choose={call.chooseMic} />
            <ControlButton on={call.cam} label={call.cam ? "Turn off camera" : "Turn on camera"} onClick={() => void call.toggleCam()}>{call.cam ? <Video /> : <VideoOff />}</ControlButton>
          </div>
        </div>
        <div className="meet-lobby-text">
          <p className="eyebrow">{state === "scheduled" ? `Planned for ${time(meeting.starts_at)}` : "Meeting"}</p>
          <h1 className="meet-lobby-title">{meeting.title}</h1>
          <p className="meet-lobby-who">
            {inside.length ? `In the meeting: ${[...new Set(inside.map(entry => entry.name))].join(", ")}`
              : state === "scheduled" ? (me.admin ? "No one is in yet. Starting it rings everyone in the chat." : "No one is in yet. You can wait inside until it starts.")
                : "No one is in yet."}
          </p>
          {!letIn && mine?.status === "waiting" && <p className="meet-lobby-wait" role="status">
            <span aria-hidden="true" />
            {inside.some(entry => start.admins.includes(entry.user)) ? "Waiting for an admin to let you in…" : "Waiting: no admin is in the meeting yet. You will be let in once one joins."}
          </p>}
          {!letIn && mine?.status === "denied" && <p className="b-form-error" role="alert">An admin did not let you in this time.</p>}
          {call.problem && <p className="b-form-error" role="alert">{call.problem}</p>}
          {notice && <p className="b-form-error" role="alert">{notice}</p>}
          <div className="meet-lobby-actions">
            {state === "scheduled" && me.admin
              ? <button type="button" className="admin-approve" disabled={!call.local || working} onClick={begin}>{working ? "Starting…" : "Start the meeting"}</button>
              : letIn
                ? <button type="button" className="admin-approve" disabled={!call.local || call.connection !== "live"} onClick={() => setJoined(true)}>
                  {!call.local ? "Getting your camera…" : call.connection !== "live" ? "Connecting…" : "Join now"}
                </button>
                : mine?.status === "waiting"
                  ? <button type="button" className="admin-approve" disabled>Asking to join…</button>
                  : <button type="button" className="admin-approve" disabled={!call.local || working} onClick={ask}>
                    {!call.local ? "Getting your camera…" : working ? "Asking…" : mine?.status === "denied" ? "Ask again" : "Ask to join"}
                  </button>}
            <Link className="account-button" href="/chat">Back to the chat</Link>
          </div>
        </div>
      </div>
    </Frame>;
  }

  const shared = others.find(remote => remote.screen && streamOf(remote, remote.screen));
  const stage = call.screen ? { name: "You", stream: call.screen, own: true } : shared ? { name: shared.name, stream: streamOf(shared, shared.screen!)!, own: false } : null;
  const count = others.length + 1;

  return <div className="meet" ref={room}>
    <header className="meet-bar">
      <span className="meet-bar-mark"><LeafMark weight={3.4} /></span>
      <div className="meet-bar-text">
        <p className="meet-bar-title">{meeting.title}</p>
        <p className="meet-bar-sub">{meeting.started_at && now ? elapsed(meeting.started_at, now) : ""} · {count} {count === 1 ? "person" : "people"}{call.connection !== "live" ? " · reconnecting…" : ""}</p>
      </div>
      {recordingBy && <p className="meet-recording" role="status"><span aria-hidden="true" />{recordingBy === "You" ? "You are recording" : `${recordingBy} is recording`}</p>}
    </header>

    <div className="meet-body">
      <main className="meet-stage" data-sharing={stage ? "" : undefined} data-count={Math.min(count, 9)}>
        {stage && <div className="meet-tile meet-screen" data-tile="screen" data-name={`${stage.name === "You" ? "Your" : `${stage.name}'s`} screen`}>
          <StreamVideo stream={stage.stream} className={`meet-video meet-video-whole${stage.own ? " meet-video-kept" : ""}`} />
          {stage.own
            // One's own shared screen is not shown back: a screen showing itself repeats without end.
            // (The video stays, unseen, for a recording.)
            ? <div className="meet-presenting">
              <span className="meet-presenting-icon" aria-hidden="true"><Screen /></span>
              <p className="meet-presenting-title">You are sharing your screen</p>
              <p className="meet-presenting-text">Everyone in the meeting sees it. It is not shown to you here, so it does not repeat itself.</p>
              <button type="button" className="account-button" onClick={call.stopScreen}>Stop sharing</button>
            </div>
            : <span className="meet-name">{`${stage.name}'s screen`}</span>}
        </div>}
        <div className="meet-faces">
          <div className="meet-cell"><Tile name={`${me.name} (you)`} initials={initialsOf(me.name)} photo={me.photo} user={me.id} stream={call.local} camera={call.cam} mic={call.mic}
            hand={!!call.hand} speaking={speaking.includes("me")} /></div>
          {others.map(remote => {
            const person = start.people.find(entry => entry.id === remote.user);
            return <div key={remote.peer} className="meet-cell"><Tile name={remote.name} initials={initialsOf(remote.name)} photo={person?.photo ?? null} user={remote.user}
              stream={cameraOf(remote)} camera={remote.cam} mic={remote.mic} hand={!!remote.hand} speaking={speaking.includes(remote.peer)} link={remote.link} relayed={call.relayed} peer={remote.peer} details={() => call.details(remote.peer)} state={`${remote.link}/${remote.signaling}${remote.trouble ? ` ${remote.trouble}` : ""}`} /></div>;
          })}
        </div>
      </main>

      {panel && <aside className="meet-panel" aria-label="People">
        <div className="meet-panel-head">
          <p className="meet-panel-title">People ({count})</p>
          <button type="button" className="chat-icon" aria-label="Close" onClick={() => setPanel(false)}><Close /></button>
        </div>
        {hands.length > 0 && <p className="meet-panel-hands">✋ {hands.map(entry => entry.name).join(", ")}</p>}
        {waiting.length > 0 && <>
          <p className="meet-panel-sub">Waiting to join</p>
          <ul className="meet-people">
            {waiting.map(person => <li key={person.user_id} className="meet-person">
              <Avatar initials={initialsOf(person.name)} photo={start.people.find(entry => entry.id === person.user_id)?.photo ?? null} className="chat-avatar meet-person-photo" who={person.user_id} />
              <span className="meet-person-name">{person.name}</span>
              {me.admin && <span className="meet-person-marks">
                <button type="button" className="meet-mini" disabled={working} onClick={() => decide(person, true)}>Admit</button>
              </span>}
            </li>)}
          </ul>
          <p className="meet-panel-sub">In the meeting</p>
        </>}
        <ul className="meet-people">
          <Person name={`${me.name} (you)`} photo={me.photo} user={me.id} state={{ mic: call.mic, cam: call.cam, hand: call.hand }} />
          {others.map(remote => <Person key={remote.peer} name={remote.name} photo={start.people.find(entry => entry.id === remote.user)?.photo ?? null} user={remote.user} state={remote} />)}
        </ul>
        {(() => {
          const missing = start.people.filter(person => person.id !== me.id && !others.some(remote => remote.user === person.id));
          return missing.length > 0 && <>
            <p className="meet-panel-sub">Not in yet</p>
            <ul className="meet-people" data-away>
              {missing.map(person => <Person key={person.id} name={person.name} photo={person.photo} user={person.id} />)}
            </ul>
          </>;
        })()}
      </aside>}
    </div>

    {/* Every voice, played once (one's own kept silent, for the recording). */}
    <div hidden>
      {call.local && <Voice stream={call.local} own />}
      {others.map(remote => { const stream = cameraOf(remote); return stream && <Voice key={remote.peer} stream={stream} peer={remote.peer} />; })}
    </div>

    {me.admin && waiting.length > 0 && <div className="meet-knocks" role="region" aria-label="Asking to join">
      {waiting.map(person => <div key={person.user_id} className="meet-knock">
        <Avatar initials={initialsOf(person.name)} photo={start.people.find(entry => entry.id === person.user_id)?.photo ?? null} className="chat-avatar meet-person-photo" who={person.user_id} />
        <p className="meet-knock-text"><strong>{person.name}</strong> wants to join</p>
        <button type="button" className="account-button" disabled={working} onClick={() => decide(person, false)}>Deny</button>
        <button type="button" className="admin-approve" disabled={working} onClick={() => decide(person, true)}>Admit</button>
      </div>)}
    </div>}

    <div role="status" className="meet-toasts">
      {notice && <p className="meet-toast">{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><Close /></button></p>}
      {call.problem && <p className="meet-toast">{call.problem}<button type="button" aria-label="Dismiss" onClick={() => call.setProblem("")}><Close /></button></p>}
      {hands.length > 0 && !panel && <p className="meet-toast">✋ {hands.map(entry => entry.name).join(", ")} raised {hands.length > 1 ? "their hands" : hands[0].name === "You" ? "your hand" : "a hand"}</p>}
    </div>

    <footer className="meet-controls">
      <ControlButton on={call.mic} label={call.mic ? "Turn off microphone" : "Turn on microphone"} onClick={call.toggleMic}>{call.mic ? <Mic /> : <MicOff />}</ControlButton>
      <MicChoice current={call.local?.getAudioTracks()[0]?.label ?? null} list={call.microphones} choose={call.chooseMic} />
      <ControlButton on={call.cam} label={call.cam ? "Turn off camera" : "Turn on camera"} onClick={() => void call.toggleCam()}>{call.cam ? <Video /> : <VideoOff />}</ControlButton>
      <ControlButton on={!!call.screen} active label={call.screen ? "Stop sharing your screen" : "Share your screen"} onClick={() => void call.shareScreen()}><Screen /></ControlButton>
      <ControlButton on={!!call.hand} active label={call.hand ? "Lower your hand" : "Raise your hand"} onClick={call.raiseHand}><Hand /></ControlButton>
      {me.admin && <ControlButton on={!!recorder} active danger label={recorder ? "Stop recording" : "Record to this computer"} onClick={record}><Record /></ControlButton>}
      <ControlButton on={panel} active label={`People (${count})${me.admin && waiting.length ? `, ${waiting.length} waiting` : ""}`} onClick={() => setPanel(!panel)}><People /></ControlButton>
      <div className="meet-leave-wrap">
        <button type="button" className="meet-leave" aria-label="Leave the meeting" title="Leave" onClick={() => (me.admin ? setLeaving(!leaving) : leave())}><PhoneOff /></button>
        {leaving && <div className="meet-leave-menu" role="group" aria-label="Leave">
          <button type="button" className="account-button" onClick={leave}>Leave</button>
          <button type="button" className="account-button account-danger" disabled={working} onClick={endForAll}>{working ? "Ending…" : "End for everyone"}</button>
        </div>}
      </div>
    </footer>
  </div>;
}

/** The stream someone sends with their face and voice (not their shared screen). */
function cameraOf(remote: Remote): MediaStream | null {
  return remote.streams.find(stream => stream.id !== remote.screen && stream.getAudioTracks().length + stream.getVideoTracks().length > 0) ?? null;
}
const streamOf = (remote: Remote, id: string) => remote.streams.find(stream => stream.id === id) ?? null;

function Frame({ title, chatTitle, children }: { title: string; chatTitle: string; children: React.ReactNode }) {
  return <div className="meet meet-outside">
    <header className="meet-bar">
      <span className="meet-bar-mark"><LeafMark weight={3.4} /></span>
      <div className="meet-bar-text">
        <p className="meet-bar-title">{title}</p>
        <p className="meet-bar-sub">KIASA meeting · {chatTitle}</p>
      </div>
    </header>
    <main className="meet-outside-main">{children}</main>
  </div>;
}

/** Choosing the microphone, as in Google Meet: the computer's microphones, the one in use ticked. */
function MicChoice({ current, list, choose }: { current: string | null; list: () => Promise<MediaDeviceInfo[]>; choose: (deviceId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const toggle = () => {
    if (!open) void list().then(setDevices, () => setDevices([]));
    setOpen(!open);
  };
  return <span className="meet-mic-choice">
    <button type="button" className="meet-mic-more" aria-label="Choose microphone" title="Choose microphone" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><ChevronDown /></button>
    {open && <ul className="meet-mic-list" role="menu" aria-label="Microphones">
      <li className="meet-mic-head">Microphone</li>
      {devices === null ? <li className="meet-mic-none">…</li>
        : devices.length ? devices.map(device => <li key={device.deviceId}>
          <button type="button" role="menuitemradio" aria-checked={device.label === current} onClick={() => { setOpen(false); void choose(device.deviceId); }}>
            <span className="meet-mic-tick">{device.label === current && <Check />}</span>{device.label || "Microphone"}
          </button>
        </li>)
          : <li className="meet-mic-none">No microphone found on this computer</li>}
    </ul>}
  </span>;
}

function ControlButton({ on, active, danger, label, onClick, children }: {
  on: boolean; active?: boolean; danger?: boolean; label: string; onClick: () => void; children: React.ReactNode;
}) {
  // Microphone and camera read "off" in red; the rest light up when on.
  return <button type="button" className="meet-control" aria-label={label} title={label} aria-pressed={on}
    data-state={active ? (on ? (danger ? "recording" : "lit") : undefined) : on ? undefined : "off"} onClick={onClick}>{children}</button>;
}

function Tile({ name, initials, photo, user, stream, camera, mic, hand, speaking, link, relayed, peer, details, state }: {
  name: string; initials: string; photo: string | null; user: string; stream: MediaStream | null; camera: boolean; mic: boolean; hand: boolean;
  speaking: boolean; link?: RTCPeerConnectionState;
  /** Whether a relay is set up, said while connecting: a call that cannot go direct needs one. */
  relayed?: boolean;
  /** How the connection stands, for whoever looks into a problem (and the tests). */
  state?: string;
  /** Someone else's: their connection's details, a click away. */
  peer?: string; details?: () => Promise<LinkDetails | null>;
}) {
  const [open, setOpen] = useState(false);
  const showing = camera && !!stream?.getVideoTracks().length;
  // The tile takes the shape of the picture, so nothing of it is cut off.
  const [ratio, setRatio] = useState(16 / 9);
  const shape = showing ? Math.min(2.4, Math.max(0.5, ratio)) : 16 / 9;
  return <div className="meet-tile" style={{ "--ratio": shape } as React.CSSProperties} data-tile="face" data-name={name} data-initials={initials} data-camera={showing ? "on" : "off"} data-speaking={speaking} data-link={state}>
    {showing ? <StreamVideo stream={stream!} className="meet-video" onShape={setRatio} />
      : <div className="meet-nobody"><Avatar initials={initials} photo={photo} className="meet-avatar" who={user} /></div>}
    <span className="meet-name">{!mic && <MicOff aria-label="Microphone off" role="img" aria-hidden={false} />}{name}</span>
    {hand && <span className="meet-hand" role="img" aria-label="Hand raised">✋</span>}
    {details && <button type="button" className="meet-details-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close details" : "Details"}</button>}
    {details && open && <Details name={name} mic={mic} peer={peer} read={details} />}
    {link && link !== "connected" && link !== "new" && <span className="meet-link">{link === "connecting" ? "Connecting…" : link === "failed" ? "Can't connect" : "Reconnecting…"}{relayed !== undefined && ` · relay ${relayed ? "on" : "off"}`}</span>}
  </div>;
}

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
const ROUTES: Record<LinkDetails["route"], string> = { relay: "through the relay", "same network": "direct, same network", internet: "direct, over the internet", "none yet": "not found yet" };

/** A connection's details, read again every two seconds while open: which way
 * it goes, and whether sound and pictures come and go. For looking into a
 * problem: a screenshot of it on each side says where something stops. */
function Details({ name, mic, peer, read }: { name: string; mic: boolean; peer?: string; read: () => Promise<LinkDetails | null> }) {
  const [now, setNow] = useState<(LinkDetails & { played: boolean }) | null>(null);
  // The latest way to read them, whatever the page has drawn since: read only every two seconds.
  const reading = useEffectEvent(read);
  useEffect(() => {
    let stopped = false;
    const look = () => void reading().then(found => {
      const voice = document.querySelector<HTMLAudioElement>(`audio[data-peer="${peer}"]`);
      if (!stopped && found) setNow({ ...found, played: !!voice && !voice.paused && !voice.muted && !!(voice.srcObject as MediaStream | null)?.getAudioTracks().length });
    });
    look();
    const timer = window.setInterval(look, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [peer]);
  const first = name.split(" ")[0];
  return <dl className="meet-details">
    <div><dt>Route</dt><dd>{now ? ROUTES[now.route] : "…"}</dd></div>
    <div><dt>{first}&apos;s microphone</dt><dd>{mic ? "on" : "off (as they set it)"}</dd></div>
    <div><dt>{first}&apos;s sound arriving</dt><dd>{now ? (now.heard ? `${size(now.heard)}${now.level !== null ? ` · loudness ${Math.round(now.level * 100)}%` : ""}` : "none") : "…"}</dd></div>
    <div><dt>Played here</dt><dd>{now ? (now.played ? "yes" : "no") : "…"}</dd></div>
    <div><dt>{first}&apos;s video arriving</dt><dd>{now ? (now.seen ? size(now.seen) : "none") : "…"}</dd></div>
    <div><dt>Your voice going to {first}</dt><dd>{now ? (now.sent ? size(now.sent) : "none") : "…"}</dd></div>
    <div><dt>Your microphone</dt><dd>{now ? (now.micName ? `${now.micName} · ${now.micState}` : now.micState) : "…"}</dd></div>
  </dl>;
}

function Person({ name, photo, user, state }: { name: string; photo: string | null; user: string; state?: Pick<PeerState, "mic" | "cam" | "hand"> }) {
  return <li className="meet-person">
    <Avatar initials={initialsOf(name)} photo={photo} className="chat-avatar meet-person-photo" who={user} />
    <span className="meet-person-name">{name}</span>
    {state && <span className="meet-person-marks">
      {state.hand ? <span aria-label="Hand raised" role="img">✋</span> : null}
      {state.mic ? <Mic aria-label="Microphone on" role="img" aria-hidden={false} /> : <MicOff aria-label="Microphone off" role="img" aria-hidden={false} />}
      {state.cam ? <Video aria-label="Camera on" role="img" aria-hidden={false} /> : <VideoOff aria-label="Camera off" role="img" aria-hidden={false} />}
    </span>}
  </li>;
}
