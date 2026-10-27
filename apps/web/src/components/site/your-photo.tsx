"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { refreshBadge } from "@/lib/accounts/actions";
import { browserClient } from "@/lib/accounts/browser";
import { initialsOf, photoUrl } from "@/lib/accounts/viewer";
import { Avatar } from "./avatar";
import { Camera, Close } from "./icons";

/** The panel's width; the square a photo is placed in, on screen; and the size it is saved at. */
const PANEL = 304;
const FRAME = 224;
const SAVED = 320;
const LARGEST = 25 * 1024 * 1024;
const NOT_SET_UP = "Photos are not set up in the database yet: an admin runs supabase/migrations/20261026230000_avatars.sql in Supabase's SQL Editor.";

/** Your own square at the top of a page: it opens a small panel where you
 * choose a photo, place and zoom it, or remove it. The photo is made small
 * here, in the browser, and goes straight to Supabase, whose rules let each
 * person write only their own; everyone who may chat sees it, live.
 * `details`: their name (and `role`) beside the square, as part of the button,
 * styled for a page's bar or the account card, with "Add a photo" under it
 * until there is one. `children`: links the panel offers too (on a phone, the
 * chat's bar keeps only the square, so the way to the account page goes in here). */
export function YourPhoto({ person, photo: saved, realtime, className, details, role, align = "end", children }: {
  person: { id: string; name: string }; photo: string | null; realtime: { url: string; key: string };
  className: string; details?: "bar" | "card"; role?: string; align?: "start" | "end"; children?: ReactNode;
}) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [open, setOpen] = useState(false);
  // How far the panel sits from the square, sideways: under it, kept on the screen.
  const [shift, setShift] = useState(0);
  // What was just saved here shows at once, before the page is drawn again.
  const [changed, setChanged] = useState<{ photo: string | null } | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const chosen = useRef<string | null>(null);
  const photo = changed ? changed.photo : saved;
  const initials = initialsOf(person.name);

  /** A picture chosen, or put away: its temporary address is let go of when done with. */
  const show = (next: string | null) => {
    if (chosen.current) URL.revokeObjectURL(chosen.current);
    chosen.current = next;
    setSource(next);
  };
  const close = () => { setOpen(false); show(null); setError(""); };
  /** Under the square, lined up with its start or end, and moved in to stay 16px inside the screen. */
  const openPanel = () => {
    const square = root.current?.getBoundingClientRect();
    if (square) {
      const width = Math.min(PANEL, window.innerWidth - 32);
      const lined = align === "end" ? square.width - width : 0;
      setShift(Math.min(Math.max(lined, 16 - square.left), window.innerWidth - 16 - width - square.left));
    }
    setOpen(true);
  };

  // Escape, or a click anywhere else, closes the panel; never while saving.
  const dismiss = useEffectEvent(() => { if (!busy) close(); });
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    const onPointer = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const choose = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose a picture.");
    if (file.size > LARGEST) return setError("That picture is too large. Please choose one under 25 MB.");
    show(URL.createObjectURL(file));
  };

  const failed = (message: string) => { setBusy(""); setError(message); };

  /** Saved: the new file first, then the record of it, then the old file goes. */
  const save = async (blob: Blob) => {
    setBusy("Saving your photo…");
    setError("");
    const path = `${person.id}/${crypto.randomUUID()}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
    const files = supabase.storage.from("avatars");
    const [uploaded, before] = await Promise.all([
      files.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false }),
      supabase.from("avatars").select("path").eq("user_id", person.id).maybeSingle(),
    ]);
    if (/bucket not found/i.test(uploaded.error?.message ?? "") || before.error?.code === "PGRST205") return failed(NOT_SET_UP);
    if (uploaded.error) return failed("Your photo could not be saved. Please try again.");
    const { error: refused } = await supabase.from("avatars").upsert({ user_id: person.id, path });
    if (refused) {
      void files.remove([path]);
      return failed("Your photo could not be saved. Please try again.");
    }
    if (before.data?.path) void files.remove([before.data.path as string]);
    setChanged({ photo: photoUrl(realtime.url, path) });
    close();
    setBusy("");
    await refreshBadge();
  };

  const remove = async () => {
    setBusy("Removing your photo…");
    setError("");
    const { data, error: refused } = await supabase.from("avatars").delete().eq("user_id", person.id).select("path");
    if (refused) return failed(refused.code === "PGRST205" ? NOT_SET_UP : "Your photo could not be removed. Please try again.");
    const gone = (data ?? []).map(row => row.path as string);
    if (gone.length) void supabase.storage.from("avatars").remove(gone);
    setChanged({ photo: null });
    close();
    setBusy("");
    await refreshBadge();
  };

  return <div className="photo-control" ref={root}>
    <button type="button" className="photo-button" aria-expanded={open} aria-label={`Your photo, ${person.name}: ${photo ? "change or remove it" : "add one"}`}
      title={photo ? "Change your photo" : "Add a photo"} onClick={() => (open ? close() : openPanel())}>
      <Avatar initials={initials} photo={photo} className={className}>
        <span className="photo-button-mark"><Camera /></span>
      </Avatar>
      {details && <span className={details === "bar" ? "admin-user-text" : "photo-card-text"}>
        <span className={details === "bar" ? "admin-user-name" : "account-name"}>{person.name}</span>
        {role && <span className={details === "bar" ? "admin-user-role" : "account-role"}>{role}</span>}
        {!photo && <span className="photo-cue">Add a photo</span>}
      </span>}
    </button>
    {open && <div className="photo-panel" style={{ left: shift, width: `min(${PANEL}px, calc(100vw - 32px))` }} role="dialog" aria-label="Your photo">
      <div className="photo-panel-head">
        <p className="photo-panel-title">Your photo</p>
        <button type="button" className="photo-close" aria-label="Close" onClick={close} disabled={!!busy}><Close /></button>
      </div>
      {source
        ? <PhotoFrame source={source} busy={!!busy} onSave={blob => void save(blob)} onCancel={() => show(null)}
          onUnreadable={() => { show(null); setError("That picture could not be opened here. Please choose a JPEG, PNG or WebP picture."); }} />
        : <>
          <Avatar initials={initials} photo={photo} className="photo-preview" />
          <div className="photo-actions">
            <label className={`account-button photo-choose${busy ? " photo-wait" : ""}`}>
              {photo ? "Choose another" : "Choose a photo"}
              <input type="file" accept="image/*" disabled={!!busy} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            {photo && <button type="button" className="account-button" disabled={!!busy} onClick={() => void remove()}>Remove</button>}
          </div>
          <p className="photo-note">Everyone you can chat with at KIASA sees it.</p>
        </>}
      {busy && <p className="photo-status" role="status">{busy}</p>}
      {error && <p className="b-form-error" role="alert">{error}</p>}
      {children && <div className="photo-links">{children}</div>}
    </div>}
  </div>;
}

/** Placing a photo: drag it in the square, and zoom with the slider (or the
 * arrow keys, and + and −). What is in the square is what is saved: made
 * small and sharp here, as WebP where the browser can, otherwise JPEG. */
function PhotoFrame({ source, busy, onSave, onCancel, onUnreadable }: {
  source: string; busy: boolean; onSave: (blob: Blob) => void; onCancel: () => void; onUnreadable: () => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // Where the picture's top-left corner is, in the square.
  const [at, setAt] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const scaleAt = (z: number) => (size ? (FRAME * z) / Math.min(size.w, size.h) : 1);
  const scale = scaleAt(zoom);
  // The picture always covers the square.
  const keep = (x: number, y: number, s = scale) => size
    ? { x: Math.min(0, Math.max(FRAME - size.w * s, x)), y: Math.min(0, Math.max(FRAME - size.h * s, y)) }
    : { x, y };

  const loaded = () => {
    const w = image.current?.naturalWidth ?? 0, h = image.current?.naturalHeight ?? 0;
    if (!w || !h) return onUnreadable();
    const s = FRAME / Math.min(w, h);
    setSize({ w, h });
    // Centred; a tall picture a little above centre, where a face usually is.
    setAt({ x: (FRAME - w * s) / 2, y: (FRAME - h * s) * (h > w ? 0.3 : 0.5) });
  };
  const zoomTo = (value: number) => {
    const next = Math.min(4, Math.max(1, value));
    const ratio = scaleAt(next) / scale, middle = FRAME / 2;
    // About the square's middle, so what is there stays there.
    setAt(keep(middle - (middle - at.x) * ratio, middle - (middle - at.y) * ratio, scaleAt(next)));
    setZoom(next);
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
    if (moves[event.key]) {
      event.preventDefault();
      setAt(keep(at.x + moves[event.key][0], at.y + moves[event.key][1]));
    } else if (event.key === "+" || event.key === "=") zoomTo(zoom + 0.1);
    else if (event.key === "-" || event.key === "−") zoomTo(zoom - 0.1);
  };
  const press = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: at };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) setAt(keep(start.from.x + event.clientX - start.x, start.from.y + event.clientY - start.y));
  };

  const place = async () => {
    const picture = image.current;
    if (!picture || !size || busy) return;
    const side = FRAME / scale;
    let from: CanvasImageSource = picture, x = -at.x / scale, y = -at.y / scale, span = side;
    // A large picture is halved step by step, so the small square stays sharp.
    while (span > SAVED * 2) {
      const half = document.createElement("canvas");
      half.width = half.height = Math.ceil(span / 2);
      half.getContext("2d")!.drawImage(from, x, y, span, span, 0, 0, half.width, half.height);
      from = half;
      x = 0;
      y = 0;
      span = half.width;
    }
    const square = document.createElement("canvas");
    square.width = square.height = SAVED;
    const pen = square.getContext("2d")!;
    pen.fillStyle = "#0a1410";
    pen.fillRect(0, 0, SAVED, SAVED);
    pen.imageSmoothingQuality = "high";
    pen.drawImage(from, x, y, span, span, 0, 0, SAVED, SAVED);
    const as = (type: string, quality: number) => new Promise<Blob | null>(resolve => square.toBlob(resolve, type, quality));
    let blob = await as("image/webp", 0.86);
    if (!blob || blob.type !== "image/webp") blob = await as("image/jpeg", 0.88);
    if (blob) onSave(blob);
  };

  return <>
    <div className="photo-frame" tabIndex={0} role="group" aria-label="Place your photo: drag it, or use the arrow keys; + and − zoom"
      onPointerDown={press} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={nudge}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture still on this computer, being placed: not one for the image optimizer */}
      <img ref={image} src={source} alt="" draggable={false} onLoad={loaded} onError={onUnreadable}
        style={size ? { width: size.w * scale, height: size.h * scale, transform: `translate(${at.x}px, ${at.y}px)` } : { opacity: 0 }} />
    </div>
    <label className="photo-zoom">
      <span>Zoom</span>
      <input type="range" min={1} max={4} step={0.01} value={zoom} disabled={!size} onChange={event => zoomTo(Number(event.target.value))} />
    </label>
    <div className="photo-actions">
      <button type="button" className="b-submit photo-save" aria-disabled={busy || !size || undefined} onClick={() => void place()}>{busy ? "Saving…" : "Save photo"}</button>
      <button type="button" className="account-button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </>;
}
