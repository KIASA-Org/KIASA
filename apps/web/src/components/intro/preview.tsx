"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent } from "motion/react";
import { SESSION_KEY } from "./config";
import { MarkScene } from "./scene";
import { PERIOD, SETTLED } from "./timing";

/** The inspector shows the entrance and the first two periods of the loop: the
 * second is the steady state, where the end of one circuit overlaps the next. */
const END = SETTLED + PERIOD * 2;
/** Named frames worth inspecting, in order. */
const STOPS: readonly (readonly [string, number])[] = [
  ["Light", 0.1],
  ["Stems", 0.75],
  ["Veins", 1.4],
  ["Dew", 2.1],
  ["At rest", SETTLED],
  ["Crown", SETTLED + PERIOD * 0.12],
  ["Right leaf", SETTLED + PERIOD * 0.46],
  ["Left leaf", SETTLED + PERIOD * 0.8],
];

/** Development inspector: scrub, step through or play the mark. The scene is a
 * pure function of its clock, so every frame shown here is exactly the frame
 * playback produces at that time. */
export function IntroPreview({ initialTime }: { initialTime: number }) {
  const clock = useMotionValue(initialTime);
  const flow = useMotionValue(initialTime >= SETTLED ? 1 : 0);
  const slider = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLOutputElement>(null);
  const [playing, setPlaying] = useState(false);

  // Mirror the clock into the controls without re-rendering React every frame.
  useMotionValueEvent(clock, "change", time => {
    flow.set(time >= SETTLED ? 1 : 0);
    if (slider.current) slider.current.value = String(time);
    if (readout.current) readout.current.textContent = `${time.toFixed(2)} s`;
  });

  useEffect(() => {
    if (!playing) return;
    let loop: ReturnType<typeof animate> | undefined;
    // After the first period, repeat the steady-state one.
    const circulate = () => { loop = animate(clock, [SETTLED, SETTLED + PERIOD, END], { duration: PERIOD * 2, ease: "linear", onComplete: () => { loop = animate(clock, [SETTLED + PERIOD, END], { duration: PERIOD, ease: "linear", repeat: Infinity }); } }); };
    const from = clock.get() >= SETTLED ? 0 : clock.get();
    clock.set(from);
    const entrance = animate(clock, SETTLED, { duration: SETTLED - from, ease: "linear", onComplete: circulate });
    return () => { entrance.stop(); loop?.stop(); };
  }, [playing, clock]);

  function show(time: number) {
    setPlaying(false);
    clock.set(time);
  }
  // A full document load on purpose: the pre-paint script that starts the entrance
  // does not run on client-side navigation.
  function openHomepage(query = "") {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage is optional. */ }
    location.assign(new URL(`/${query}`, location.origin));
  }

  return <main className="preview-stage">
    <p className="preview-caption">Intro inspector · development only</p>
    <MarkScene clock={clock} flow={flow} />
    <section className="preview-panel" aria-label="Animation timeline">
      <div className="preview-heading">
        <label htmlFor="timeline">Scene time · entrance to {SETTLED.toFixed(2)} s, then two loops</label>
        <output ref={readout} htmlFor="timeline">{initialTime.toFixed(2)} s</output>
      </div>
      <input ref={slider} id="timeline" type="range" min="0" max={END} step="0.01" defaultValue={initialTime}
        onInput={event => show(Number(event.currentTarget.value))} />
      <div className="preview-actions">
        <button onClick={() => setPlaying(value => !value)} aria-pressed={playing}>{playing ? "Pause" : "Play"}</button>
        {STOPS.map(([label, time]) => <button key={label} onClick={() => show(time)}>{label}</button>)}
        <button className="preview-gap" onClick={() => openHomepage()}>Open homepage</button>
        <button onClick={() => openHomepage("?intro-test=loading")}>Test pending request</button>
      </div>
    </section>
  </main>;
}
