"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Close, Download } from "../site/icons";
import { fileSize } from "./chat-format";
import { isPicture, type Upload } from "./chat-upload";

type StoredFile = { path: string; name: string; mime: string; size: number };

const links = new Map<string, { url: string; until: number }>();
const previews = new Map<string, string>();

/** A file's private link: made for an hour, as the chat's member, and reused meanwhile. */
async function linkFor(supabase: SupabaseClient, path: string) {
  const known = links.get(path);
  if (known && known.until > Date.now() + 60_000) return known.url;
  const { data } = await supabase.storage.from("chat-files").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  links.set(path, { url: data.signedUrl, until: Date.now() + 3600_000 });
  return data.signedUrl;
}

/** A picture sent from this computer: shown from here once it is up, so it
 * does not blink while a link to it is fetched. */
export const keepPreview = (path: string, url: string) => { previews.set(path, url); };

/** A file opened in a new tab, to look at (a PDF in the browser's own viewer, say). */
export async function openFile(supabase: SupabaseClient, path: string) {
  const link = await linkFor(supabase, path);
  if (link) window.open(link, "_blank", "noopener");
}

/** Files coming down to this computer, by their path: how much has come, and
 * how to stop it; or that it could not come. Kept here, so a file's message
 * shows it, whichever button started it. */
type Saving = { loaded: number; stop?: () => void; failed?: boolean };
const saving = new Map<string, Saving>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function setSaving(path: string, state: Saving | null) {
  if (state) saving.set(path, state);
  else saving.delete(path);
  for (const listener of listeners) listener();
}
const useSaving = (path: string) => useSyncExternalStore(subscribe, () => saving.get(path), () => undefined);

/** Downloading, as in Telegram: the file comes down here with its progress
 * shown in its message (× stops it), then is saved under its own name. */
export async function downloadFile(supabase: SupabaseClient, file: StoredFile) {
  if (saving.get(file.path)?.stop) return;
  const stopper = new AbortController();
  const stop = () => stopper.abort();
  setSaving(file.path, { loaded: 0, stop });
  try {
    const link = await linkFor(supabase, file.path);
    const response = link ? await fetch(link, { signal: stopper.signal }) : null;
    if (!response?.ok || !response.body) throw new Error("The file could not be fetched.");
    const reader = response.body.getReader();
    const parts: BlobPart[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(new Uint8Array(value));
      loaded += value.length;
      setSaving(file.path, { loaded, stop });
    }
    const url = URL.createObjectURL(new Blob(parts, { type: file.mime }));
    const anchor = Object.assign(document.createElement("a"), { href: url, download: file.name });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setSaving(file.path, null);
  } catch {
    if (stopper.signal.aborted) return setSaving(file.path, null);
    // It says so for a moment; a click tries again.
    setSaving(file.path, { loaded: 0, failed: true });
    window.setTimeout(() => { if (saving.get(file.path)?.failed) setSaving(file.path, null); }, 5000);
  }
}

/** The ring that fills as a file goes up or comes down. */
function Ring({ share }: { share: number }) {
  return <svg className="chat-ring" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="19" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - Math.max(5, share * 100)} />
  </svg>;
}

/** A file or picture in a message. A picture shows in place, and opens in a new
 * tab; any other file is a card that downloads it, as in Telegram: ↓ in its
 * round mark, which fills as it comes down. Both come from the chat's private store. */
export function ChatFile({ supabase, file }: { supabase: SupabaseClient; file: StoredFile }) {
  const picture = isPicture(file.mime);
  const [url, setUrl] = useState<string | null>(() => previews.get(file.path) ?? links.get(file.path)?.url ?? null);
  const saved = useSaving(file.path);
  useEffect(() => {
    if (!picture || previews.has(file.path)) return;
    let stopped = false;
    void linkFor(supabase, file.path).then(link => { if (!stopped) setUrl(link); });
    return () => { stopped = true; };
  }, [picture, supabase, file.path]);

  if (picture) return <button type="button" className="chat-picture" onClick={() => void openFile(supabase, file.path)} aria-label={`Open ${file.name}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- a private link that expires within the hour: not one for the image optimizer to keep */}
    {url ? <img src={url} alt={file.name} loading="lazy" /> : <span className="chat-picture-wait">Loading picture…</span>}
  </button>;
  const coming = !!saved?.stop;
  const kind = (file.name.includes(".") ? file.name.split(".").pop() ?? "" : "").slice(0, 4).toUpperCase();
  return <button type="button" className="chat-file" aria-label={`${coming ? "Stop downloading" : "Download"} ${file.name}`}
    onClick={() => coming ? saved?.stop?.() : void downloadFile(supabase, file)}>
    <span className="chat-progress" aria-hidden="true">{coming ? <><Ring share={(saved?.loaded ?? 0) / Math.max(1, file.size)} /><Close /></> : <Download />}</span>
    <span className="chat-file-text"><span>{file.name}</span>
      <span>{coming ? `${fileSize(saved?.loaded ?? 0)} / ${fileSize(file.size)}` : saved?.failed ? "Could not download. Try again."
        : `${kind ? `${kind} · ` : ""}${fileSize(file.size)}`}</span></span>
  </button>;
}

/** A file on its way up, as Telegram shows one: a ring that fills as it goes,
 * with × in it to stop it, and how much has gone ("57 KB / 113 KB"). A picture
 * shows itself, from this computer, under the ring. One that failed keeps its
 * ×, to take it away (sending it again is under the message). */
export function UploadingFile({ file, upload, onStop }: {
  file: { name: string; mime: string; size: number }; upload: Upload | undefined; onStop: () => void;
}) {
  const ring = <button type="button" className="chat-progress" data-failed={upload?.failed || undefined}
    aria-label={upload?.failed ? `Remove ${file.name}` : `Stop sending ${file.name}`} title={upload?.failed ? "Remove" : "Stop sending"}
    onClick={event => { event.stopPropagation(); onStop(); }}>
    {!upload?.failed && <Ring share={upload ? upload.loaded / Math.max(1, file.size) : 0} />}
    <Close />
  </button>;
  const said = upload?.failed ? "Not sent" : `${fileSize(upload?.loaded ?? 0)} / ${fileSize(file.size)}`;
  if (file.mime.startsWith("image/") && upload?.preview) return <div className="chat-picture" data-uploading="">
    {/* eslint-disable-next-line @next/next/no-img-element -- the picture itself, from this computer, before it is anywhere else */}
    <img src={upload.preview} alt={file.name} />
    {ring}
    <span className="chat-picture-progress">{said}</span>
  </div>;
  return <div className="chat-file" data-uploading="">
    {ring}
    <span className="chat-file-text"><span>{file.name}</span><span>{said}</span></span>
  </div>;
}
