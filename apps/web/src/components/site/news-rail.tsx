"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "./icons";

type Item = { date: string; day: string; title: string; href: string };

/** Seconds a headline stays before the row moves on. */
const HOLD = 6;

/** A row of headlines that can be scrolled, stepped with the arrows, or left to
 * advance by itself. It waits while it is off screen, while the pointer or the
 * keyboard focus is on it, and for anyone who prefers reduced motion. */
export function NewsRail({ items }: { items: Item[] }) {
  const track = useRef<HTMLOListElement>(null);
  /** Reasons to hold still that are not the visitor's Pause: off screen, hovered, focused. */
  const waiting = useRef({ offscreen: true, pointer: false, focus: false });
  const [paused, setPaused] = useState(false);

  const step = (direction: 1 | -1) => {
    const row = track.current;
    if (!row) return;
    const first = row.children[0] as HTMLElement, second = row.children[1] as HTMLElement | undefined;
    const stride = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
    const end = row.scrollWidth - row.clientWidth;
    // From the last headline, forward returns to the first; from the first, back goes to the last.
    const left = direction === 1 && row.scrollLeft >= end - 8 ? 0 : direction === -1 && row.scrollLeft <= 8 ? end : row.scrollLeft + direction * stride;
    row.scrollTo({ left, behavior: "smooth" });
  };

  useEffect(() => {
    const row = track.current;
    if (!row) return;
    const visible = new IntersectionObserver(([entry]) => { waiting.current.offscreen = !entry.isIntersecting; }, { threshold: 0.4 });
    visible.observe(row);
    return () => visible.disconnect();
  }, []);

  useEffect(() => {
    if (paused) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const timer = setInterval(() => {
      const hold = waiting.current;
      if (still.matches || document.hidden || hold.offscreen || hold.pointer || hold.focus) return;
      step(1);
    }, HOLD * 1000);
    return () => clearInterval(timer);
  }, [paused]);

  return <div className="news-rail">
    <ol ref={track} className="news-track"
      onPointerEnter={() => { waiting.current.pointer = true; }} onPointerLeave={() => { waiting.current.pointer = false; }}
      onFocus={() => { waiting.current.focus = true; }} onBlur={() => { waiting.current.focus = false; }}>
      {items.map(item => <li key={item.href} className="news-item">
        <Link href={item.href} prefetch={false}>
          <time dateTime={item.date}>{item.day}</time>
          <span className="news-headline">{item.title}</span>
        </Link>
      </li>)}
    </ol>
    <div className="news-controls wrap">
      <button type="button" className="news-button news-pause" aria-pressed={paused} aria-label="Pause the news" onClick={() => setPaused(!paused)}>
        {paused ? <Play /> : <Pause />}
      </button>
      <div className="news-arrows">
        <button type="button" className="news-button" aria-label="Previous headline" onClick={() => step(-1)}><ArrowLeft /></button>
        <button type="button" className="news-button" aria-label="Next headline" onClick={() => step(1)}><ArrowRight /></button>
      </div>
    </div>
  </div>;
}
