"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Close, Send } from "../site/icons";
import { fileSize } from "./chat-format";

/** Pictures the browser shows itself, so they can be seen before they are sent. */
export const PREVIEWABLE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

/** Sending a file, as Telegram asks it: the picture (or the file's name and
 * size), a caption, and Send. Enter sends; Escape, ×, or a click beside it
 * puts it away. */
export function SendFile({ file, preview, caption: first, onSend, onClose }: {
  file: File; preview: string | null; caption: string; onSend: (caption: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [caption, setCaption] = useState(first);
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
    field.current?.focus();
  }, []);

  const send = () => onSend(caption.trim());
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
  };
  // Only a click on the dimmed page around it, not one on its own padding.
  const beside = (event: MouseEvent<HTMLDialogElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) onClose();
  };
  const title = preview ? "Send Photo" : "Send File";

  return <dialog ref={dialog} className="chat-dialog chat-sendfile" aria-label={title} onClose={onClose} onClick={beside}>
    <div className="chat-sendfile-head">
      <button type="button" className="chat-icon" aria-label="Cancel" title="Cancel" onClick={onClose}><Close /></button>
      <p className="chat-dialog-title">{title}</p>
    </div>
    {preview
      // eslint-disable-next-line @next/next/no-img-element -- the picture itself, from this computer, before it is anywhere else
      ? <div className="chat-sendfile-picture"><img src={preview} alt={file.name} /></div>
      : <div className="chat-file">
        <span className="chat-file-mark" aria-hidden="true">{(file.name.split(".").pop() ?? "file").slice(0, 4).toUpperCase()}</span>
        <span className="chat-file-text"><span>{file.name}</span><span>{fileSize(file.size)}</span></span>
      </div>}
    <div className="chat-sendfile-row">
      <textarea ref={field} rows={1} value={caption} onChange={event => setCaption(event.target.value)} onKeyDown={keys}
        placeholder="Add a caption…" aria-label="Caption" maxLength={4000} />
      <button type="button" className="chat-send" aria-label="Send" title="Send" onClick={send}><Send /></button>
    </div>
  </dialog>;
}
