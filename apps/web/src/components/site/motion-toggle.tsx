"use client";

import { useState } from "react";
import { Pause, Play } from "./icons";

/** Stops and restarts the hero's moving background. The motion itself is CSS:
 * this only marks the hero as paused. */
export function MotionToggle() {
  const [paused, setPaused] = useState(false);
  return <button type="button" className="hero-motion" aria-pressed={paused} aria-label="Pause background motion"
    onClick={event => {
      event.currentTarget.closest(".hero")?.toggleAttribute("data-paused", !paused);
      setPaused(!paused);
    }}>
    {paused ? <Play /> : <Pause />}
  </button>;
}
