"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { useLiveCapture } from "./live-capture";
import { ChevronDown } from "../site/icons";
import { ScriptReader, tokenFrom, type ReadingState } from "./live-link";

type Session = { user_id: string; started_at: string };

/** The script, as sentences: each finished sentence, then whatever is being
 * spoken now as the last one. */
function toSentences(text: string): string[] {
  return (text.match(/[^.!?]*[.!?]+|[^.!?]+$/g) ?? []).map(s => s.trim()).filter(Boolean);
}

/** The chosen cards' text, in order, one per line. */
const textOf = (set: Set<number>, arr: string[]) =>
  [...set].filter(i => i < arr.length).sort((a, b) => a - b).map(i => arr[i]).join("\n");
const copyText = (set: Set<number>, arr: string[]) => {
  const text = textOf(set, arr);
  if (text) void navigator.clipboard.writeText(text).catch(() => { /* Only while the page has focus. */ });
};
/** The cards that are chosen: the still ones, plus (while following) every card from the
 * follow point to the last — a range, so a burst of new sentences can't leave a gap. */
const chosenSet = (statics: Set<number>, anchor: number | null, len: number) => {
  const set = new Set(statics);
  if (anchor != null) for (let i = anchor; i < len; i++) set.add(i);
  return set;
};

/** One sentence. A long script has hundreds: only the one that changed is drawn again. */
const Card = memo(function Card({ sentence, index, live, picked, following, onDown, onEnter }: {
  sentence: string; index: number; live: boolean; picked: boolean; following: boolean;
  onDown: (index: number, event: React.MouseEvent) => void; onEnter: (index: number) => void;
}) {
  return <p className="live-card" data-live={live || undefined} data-picked={picked || undefined} data-following={following || undefined}
    onMouseDown={event => onDown(index, event)} onMouseEnter={() => onEnter(index)}>{sentence}</p>;
});

/** The admin's Live scripts: everyone whose live script is on now, and any one
 * of them, a card per sentence as it is spoken. Each of them is told on their
 * own page that an admin can read it. Nothing is kept: the words are only here. */
export function LiveNow({ names, realtime }: { names: Record<string, string>; realtime: { url: string; key: string } }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [reading, setReading] = useState<ReadingState>("opening");
  const [text, setText] = useState("");        // everything heard so far, as it arrives
  const [shown, setShown] = useState("");      // what is on screen, catching up word by word
  const targetRef = useRef("");
  const shownRef = useRef("");
  const reveal = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(false);
  // Picking cards: click one, drag across several, or hold Ctrl to add more; the chosen
  // cards' text is copied at once. `picked` holds the still cards; `followAnchor` (if set)
  // follows the sentence being written — everything from it to the last keeps copying.
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [followAnchor, setFollowAnchor] = useState<number | null>(null);
  const [copied, setCopied] = useState(0);
  const [onClip, setOnClip] = useState(false);   // the followed text just reached the clipboard
  const [blocked, setBlocked] = useState(false); // the browser refused the automatic copy
  const okFlash = useRef(0);
  const pickedRef = useRef(picked);
  const anchorRef = useRef<number | null>(null);
  const stillOnRef = useRef(false);
  const drag = useRef<{ start: number; add: boolean; moved: boolean; base: Set<number> } | null>(null);
  const flash = useRef(0);
  const sentencesRef = useRef<string[]>([]);

  // Whose script is on (the database shows only those whose page is still
  // there): as the list changes, and a look now and then, as a closed page
  // says nothing.
  useEffect(() => {
    let stopped = false;
    let looking = false;
    const load = async () => {
      if (looking) return;  // On a poor connection, looks must not pile up.
      looking = true;
      const { data, error } = await supabase.from("live_sessions").select("user_id, started_at").order("started_at").abortSignal(AbortSignal.timeout(12_000));
      looking = false;
      if (stopped || error) return;  // A look that failed says nothing about who is on.
      setSessions((data ?? []) as Session[]);
      setLoaded(true);
    };
    void load();
    const changes = supabase.channel("live-sessions-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions" }, () => void load())
      .subscribe();
    // Often enough that a closed or crashed page clears soon after it goes stale.
    const tick = window.setInterval(() => void load(), 5_000);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      void supabase.removeChannel(changes);
    };
  }, [supabase]);

  // Words still coming say it is on, even if the member's connection could not tell the list.
  const stillOn = !!open && (sessions.some(session => session.user_id === open) || (reading === "live" && !opening));

  // An admin's own script, written in this very tab, is read straight from the capture. It
  // cannot come over its channel: a tab has one connection, which already holds that channel
  // to send on and does not hear itself. Asking for the channel again gives back the same one,
  // so nothing would ever arrive, and closing it would cut off anyone else reading these words.
  const { me, on: writingHere, scriptText, onScript } = useLiveCapture();
  const mine = !!open && open === me && writingHere;
  useEffect(() => {
    if (!mine) return;
    const show = () => {
      setText(scriptText());
      setOpening(false);
    };
    show();
    return onScript(show);
  }, [mine, scriptText, onScript]);

  // The script open now: the newest words when it opens, the older ones after them, then
  // each change. How it holds up on a poor connection is in live-link.ts.
  useEffect(() => {
    if (!open || mine) return;
    const reader = new ScriptReader({ url: realtime.url, key: realtime.key, token: tokenFrom(supabase) }, open, (next, older) => {
      // Older sentences arriving above: the cards picked are still the same ones.
      const added = older ? toSentences(older).length : 0;
      if (added) {
        setPicked(current => new Set([...current].map(index => index + added)));
        setFollowAnchor(current => (current == null ? current : current + added));
      }
      setText(next);
      setOpening(false);
    }, setReading);
    reader.begin();
    return () => reader.end();
  }, [supabase, realtime.url, realtime.key, open, mine]);

  // The words arrive in bursts (the speech model emits several at a time). Show them one
  // after another, fast, so the admin reads a live stream rather than blocks appearing.
  useEffect(() => {
    targetRef.current = text;
    const run = () => {
      const target = targetRef.current;
      let now = shownRef.current;
      if (now === target) return;
      if (!target.startsWith(now)) now = "";              // the text was corrected: start again from it
      const rest = target.slice(now.length);
      const waiting = rest.trim() ? rest.trim().split(/\s+/).length : 0;
      if (waiting > 5 || document.hidden) now = target;   // more than a few behind, or hidden: catch up at once
      else {
        const lead = rest.length - rest.trimStart().length;
        const end = rest.indexOf(" ", lead);
        now += end === -1 ? rest : rest.slice(0, end);
      }
      shownRef.current = now;
      setShown(now);
      // Fast enough that the word-by-word flow costs almost nothing against the member's own page.
      if (now !== target) reveal.current = window.setTimeout(run, Math.max(10, Math.min(20, 60 / Math.max(1, waiting))));
    };
    run();
    return () => window.clearTimeout(reveal.current);
  }, [text]);

  const sentences = useMemo(() => toSentences(shown), [shown]);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  useEffect(() => { anchorRef.current = followAnchor; }, [followAnchor]);
  useEffect(() => { stillOnRef.current = stillOn; }, [stillOn]);

  // Keep the newest sentence in view as the words appear, unless the admin scrolled up to read back.
  useEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [sentences]);

  // Copying always works from the freshest words, never the catching-up display, so the
  // clipboard holds everything heard so far even mid-reveal.
  useEffect(() => {
    const latest = toSentences(text);
    sentencesRef.current = latest;
    if (anchorRef.current != null && stillOnRef.current) {
      const picks = textOf(chosenSet(pickedRef.current, anchorRef.current, latest.length), latest);
      if (picks) void navigator.clipboard.writeText(picks).then(() => {
        setOnClip(true);
        setBlocked(false);
        window.clearTimeout(okFlash.current);
        okFlash.current = window.setTimeout(() => setOnClip(false), 1500);
      }).catch(() => setBlocked(true));   // an extension or the OS refused the write — Ctrl+C still works
    }
  }, [text]);

  // Keep the clipboard dependable: re-copy when this tab regains focus, and let a plain
  // Ctrl+C always take the chosen cards' latest text.
  useEffect(() => {
    const refresh = () => {
      if (anchorRef.current == null || !stillOnRef.current) return;
      const text = textOf(chosenSet(pickedRef.current, anchorRef.current, sentencesRef.current.length), sentencesRef.current);
      if (text) void navigator.clipboard.writeText(text).then(() => {
        setOnClip(true);
        setBlocked(false);   // back on the tab: the copy works again
        window.clearTimeout(okFlash.current);
        okFlash.current = window.setTimeout(() => setOnClip(false), 1500);
      }).catch(() => { /* still not focused */ });
    };
    const onCopy = (event: ClipboardEvent) => {
      if (window.getSelection()?.toString()) return;  // the admin selected some other text by hand
      const chosen = chosenSet(pickedRef.current, anchorRef.current, sentencesRef.current.length);
      if (!chosen.size || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", textOf(chosen, sentencesRef.current));
      event.preventDefault();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("copy", onCopy);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("copy", onCopy); };
  }, []);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
    setBehind(!atBottom.current);
  };
  const toNewest = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const choose = (id: string) => {
    if (id === open) return;
    setText("");
    setShown("");
    targetRef.current = "";
    shownRef.current = "";
    setPicked(new Set());
    setFollowAnchor(null);
    atBottom.current = true;
    setBehind(false);
    setOpening(true);
    setReading("opening");
    setOpen(id);
  };

  const last = sentences.length - 1;
  const liveFollowing = followAnchor != null && stillOn;
  const isPicked = (index: number) => picked.has(index) || (followAnchor != null && index >= followAnchor);

  const onDown = useCallback((index: number, event: React.MouseEvent) => {
    const add = event.ctrlKey || event.metaKey;   // hold Ctrl (or ⌘) to add to the pick
    // Adding: fold the currently-followed range into still cards, then build on that.
    const base = add ? chosenSet(pickedRef.current, anchorRef.current, sentencesRef.current.length) : new Set<number>();
    drag.current = { start: index, add, moved: false, base };
    setCopied(0);
    const next = new Set(base);
    next.add(index);
    setPicked(next);
    setFollowAnchor(null);  // recomputed when the gesture ends
  }, []);
  const onEnter = useCallback((index: number) => {
    const d = drag.current;
    if (!d) return;
    if (index !== d.start) d.moved = true;
    const next = new Set(d.base);
    for (let i = Math.min(d.start, index); i <= Math.max(d.start, index); i++) next.add(i);
    setPicked(next);
  }, []);

  // Finishing a pick copies the chosen cards at once (Ctrl-click an already-picked card
  // unpicks it). If the pick reaches the sentence being written, it follows it from there.
  useEffect(() => {
    const onUp = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      let set = pickedRef.current;
      if (d.add && !d.moved && d.base.has(d.start)) { set = new Set(d.base); set.delete(d.start); }
      const len = sentencesRef.current.length, end = len - 1;
      let anchor: number | null = null;
      if (stillOnRef.current && end >= 0 && set.has(end)) {
        anchor = end;
        while (anchor > 0 && set.has(anchor - 1)) anchor -= 1;  // the contiguous tail that reaches the live card
      }
      const statics = anchor == null ? set : new Set([...set].filter(i => i < (anchor as number)));
      setPicked(statics);
      setFollowAnchor(anchor);
      const chosen = chosenSet(statics, anchor, len);
      setCopied(chosen.size);
      window.clearTimeout(flash.current);
      flash.current = window.setTimeout(() => setCopied(0), 1800);
      copyText(chosen, sentencesRef.current);
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const nameOf = (id: string) => names[id] ?? "A KIASA member";
  const said = !open ? "Choose someone to read their script."
    : !stillOn ? `${nameOf(open)} has turned their live script off.`
    : opening ? "Opening…"
    : reading === "waiting" ? "Waiting for the connection. The words will catch up by themselves."
    : "Live";

  return <div className="interview wrap wrap-wide">
    <div>
      <h1 className="interview-title">Live scripts</h1>
      <p className="jobs-form-hint">Everyone whose live script is on now. Choose anyone to read theirs, a card per sentence. Click a card, or drag across several, to copy them; hold <b>Ctrl</b> to add more. Pick the sentence still being written and its words keep copying as they come. Each of them is told on their own page that a KIASA admin can read it. Nothing is kept.</p>
    </div>
    <div className="live-now">
      <div className="jobs-card live-now-list">
        <p className="resume-folder-title">Live now{loaded ? ` (${sessions.length})` : ""}</p>
        {loaded && !sessions.length && <p className="jobs-empty-line">No one has their live script on.</p>}
        {sessions.map(session => <button key={session.user_id} type="button" className="live-now-person" aria-current={session.user_id === open || undefined} onClick={() => choose(session.user_id)}>
          <span className="bridge-status-dot live-now-dot" aria-hidden="true" />
          <span className="live-now-name">{nameOf(session.user_id)}</span>
          <span className="live-now-since">since {new Date(session.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </button>)}
      </div>
      <div className="live-now-reading">
        <p className="bridge-status" data-state={liveFollowing && blocked ? "warn" : reading === "waiting" && stillOn ? "warn" : liveFollowing || copied || (open && stillOn && !opening) ? "ok" : "off"} role="status">
          <span className="bridge-status-dot" aria-hidden="true" />
          <span>{liveFollowing ? (blocked
            ? <b>Copying live — your browser is blocking the automatic copy. Press Ctrl+C to grab it, or open this page in an Incognito window.</b>
            : <b>Copying live{onClip ? " ✓" : ""} — the newest words are on your clipboard</b>)
            : copied ? <b>Copied {copied} {copied === 1 ? "card" : "cards"}</b>
            : <>{open ? <><b>{nameOf(open)}</b>: </> : null}{said}</>}</span>
        </p>
        <div className="live-box">
          <div ref={box} className="live-cards" onScroll={onScroll}>
            {sentences.length === 0
              ? <p className="live-cards-empty">{open && stillOn ? "Waiting for the first words…" : "Their words appear here, a card at a time, as they are spoken."}</p>
              : sentences.map((sentence, index) => <Card key={index} sentence={sentence} index={index}
                  live={index === last && stillOn}
                  picked={isPicked(index)}
                  following={liveFollowing && followAnchor != null && index >= followAnchor}
                  onDown={onDown} onEnter={onEnter} />)}
          </div>
          {behind && <button type="button" className="jobs-button live-newest" data-primary="" onClick={toNewest}>Newest words <ChevronDown /></button>}
        </div>
      </div>
    </div>
  </div>;
}
