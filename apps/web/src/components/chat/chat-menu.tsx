"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** `checked`: one of a set of choices (true for the one in force), as a radio button is. */
export type MenuItem = { label: string; icon: ReactNode; danger?: boolean; checked?: boolean; onSelect: () => void };
/** Where a menu opens: a point (a right-click, a long press) or under a button.
 * `end`: the point is where its right edge goes (for a button at the right). */
export type MenuPlace = { x: number; y: number; end?: boolean };

/** A small menu, as Telegram's: for a message or a chat, opened by a right-click,
 * a long press, or its ⋯ or ⋮ button. It stays on the screen, and closes on a
 * choice, a click elsewhere, Escape, the reader scrolling (the page scrolling
 * itself, for a new message, does not count) or resizing. `top`: what sits
 * above the items (a message's reactions). */
export function Menu({ at, items, top, label, onClose }: {
  at: MenuPlace; items: MenuItem[]; top?: ReactNode; label: string; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  // Measured once in the page, then moved to stay inside it.
  const place = useCallback((menu: HTMLDivElement | null) => {
    box.current = menu;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(at.end ? at.x - width : at.x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${at.y + height + 8 > window.innerHeight ? Math.max(8, at.y - height) : at.y}px`;
    menu.style.visibility = "visible";
    menu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [at.x, at.y, at.end]);

  useEffect(() => {
    const away = (event: Event) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const moved = () => onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", moved);
    document.addEventListener("wheel", away, { capture: true, passive: true });
    document.addEventListener("touchmove", away, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", moved);
      document.removeEventListener("wheel", away, true);
      document.removeEventListener("touchmove", away, true);
    };
  }, [onClose]);

  // Up and down move between the items.
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };

  return createPortal(<div ref={place} className="chat-menu" role="menu" aria-label={label} style={{ visibility: "hidden" }} onKeyDown={keys}
    onContextMenu={event => event.preventDefault()}>
    {top}
    {items.map(item => <button key={item.label} type="button" role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked}
      className="chat-menu-item" data-danger={item.danger || undefined} data-checked={item.checked || undefined}
      onClick={() => { onClose(); item.onSelect(); }}>
      {item.icon}<span>{item.label}</span>
    </button>)}
  </div>, document.body);
}

/** A long press on a touch screen does what a right-click does with a mouse. */
export function useLongPress(onPress: (at: MenuPlace) => void) {
  const timer = useRef(0);
  const start = useRef<MenuPlace | null>(null);
  const stop = () => { window.clearTimeout(timer.current); start.current = null; };
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => { if (start.current) onPress(start.current); start.current = null; }, 480);
    },
    onPointerMove: (event: PointerEvent) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}
