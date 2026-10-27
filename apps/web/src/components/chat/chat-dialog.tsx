"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Asking before something that cannot be undone: deleting messages, clearing
 * a chat's history, deleting or leaving a chat. `also`, when there is a choice:
 * the box that makes it happen for the others too ("Also delete for Ben"). */
export function Confirm({ title, text, also, confirm, onConfirm, onClose }: {
  title: string; text: ReactNode; also?: { label: string; checked: boolean };
  confirm: string; onConfirm: (everyone: boolean) => Promise<string | null>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [everyone, setEveryone] = useState(also?.checked ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);

  const go = async () => {
    setBusy(true);
    setError("");
    const failed = await onConfirm(everyone);
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  };

  return <dialog ref={dialog} className="chat-dialog" aria-label={title} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <p className="chat-dialog-title">{title}</p>
    <div className="chat-dialog-text">{text}</div>
    {also && <label className="chat-dialog-check">
      <input type="checkbox" checked={everyone} onChange={event => setEveryone(event.target.checked)} />
      <span>{also.label}</span>
    </label>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="chat-dialog-button" data-danger="" onClick={() => void go()} disabled={busy} autoFocus>{busy ? "Working…" : confirm}</button>
    </div>
  </dialog>;
}
