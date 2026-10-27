"use client";

import { useSyncExternalStore } from "react";

/** A file on its way into a chat, kept by its message's id, on this page only:
 * how far it has gone up, how to stop it, and what sending it again needs. */
export type Upload = {
  chatId: string; file: File; caption: string; replyTo: string | null;
  /** A picture, from this computer: shown while it goes up, and after. */
  preview: string | null;
  /** Bytes gone up so far. */
  loaded: number;
  failed?: boolean;
  stop?: () => void;
};

const uploads = new Map<string, Upload>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const uploadOf = (id: string) => uploads.get(id);
export function setUpload(id: string, upload: Upload | null) {
  if (upload) uploads.set(id, upload);
  else uploads.delete(id);
  for (const listener of listeners) listener();
}
/** One message's upload as it goes: only that message draws again as it moves. */
export const useUpload = (id: string) => useSyncExternalStore(subscribe, () => uploads.get(id), () => undefined);

/** A file into the chat's private store, telling how far along it is. Sent with
 * XMLHttpRequest, as fetch cannot tell an upload's progress; the store's rules
 * are the same as for any upload (only the chat's members may add to it). */
export function putFile({ url, key, token, path, file, onProgress }: {
  url: string; key: string; token: string; path: string; file: File; onProgress: (loaded: number) => void;
}) {
  const request = new XMLHttpRequest();
  const done = new Promise<"done" | "stopped" | "failed">(resolve => {
    request.open("POST", `${url.replace(/\/+$/, "")}/storage/v1/object/chat-files/${path.split("/").map(encodeURIComponent).join("/")}`);
    request.setRequestHeader("authorization", `Bearer ${token}`);
    request.setRequestHeader("apikey", key);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.setRequestHeader("cache-control", "max-age=3600");
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = event => onProgress(event.loaded);
    request.onload = () => resolve(request.status >= 200 && request.status < 300 ? "done" : "failed");
    request.onerror = () => resolve("failed");
    request.onabort = () => resolve("stopped");
    request.send(file);
  });
  return { done, stop: () => request.abort() };
}
