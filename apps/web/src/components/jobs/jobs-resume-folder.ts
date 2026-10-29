"use client";

/** The member's résumé folder on their computer (Chrome and Edge: the File
 * System Access API). Chosen once; then every résumé PDF is saved straight
 * into it, under its own name, and its full path can be copied for a job
 * application's file box. A browser never tells a page where a folder is, so
 * the member gives its path once too (from File Explorer's address bar).
 * Elsewhere, PDFs download as usual. Kept in this browser only. */

type Permission = "granted" | "denied" | "prompt";
type FolderHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "readwrite" }): Promise<Permission>;
  requestPermission(options: { mode: "readwrite" }): Promise<Permission>;
};
type Picker = (options: { id?: string; mode?: "readwrite"; startIn?: string }) => Promise<FolderHandle>;

const DB = "kiasa-resumes";
const PATH_KEY = "kiasa-resume-folder-path";
const NAMES_KEY = "kiasa-resume-files";

/** Whether this browser can save into a chosen folder. */
export const canChooseFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

function store<T>(mode: IDBTransactionMode, act: (folder: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise(resolve => {
    try {
      const opening = indexedDB.open(DB, 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("folder");
      opening.onerror = () => resolve(undefined);
      opening.onsuccess = () => {
        const asked = act(opening.result.transaction("folder", mode).objectStore("folder"));
        asked.onsuccess = () => resolve(asked.result);
        asked.onerror = () => resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
}

/** The folder chosen in this browser, if any. */
export const savedFolder = () => store<FolderHandle>("readonly", folder => folder.get("handle") as IDBRequest<FolderHandle>);

/** Asks for a folder (the browser's own window) and keeps it. */
export async function chooseFolder(): Promise<FolderHandle | null> {
  try {
    const picked = await (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ id: "kiasa-resumes", mode: "readwrite", startIn: "documents" });
    await store("readwrite", folder => folder.put(picked, "handle"));
    return picked;
  } catch {
    return null; // closed without choosing
  }
}

export async function forgetFolder() {
  await store("readwrite", folder => folder.delete("handle"));
  try { localStorage.removeItem(PATH_KEY); } catch { /* nothing kept */ }
}

/** The folder's path, as the member gave it. */
export function folderPath(): string {
  try { return localStorage.getItem(PATH_KEY) ?? ""; } catch { return ""; }
}
export function setFolderPath(path: string) {
  try { localStorage.setItem(PATH_KEY, path.trim().replace(/^"|"$/g, "")); } catch { /* not kept */ }
}

/** A file's full path, from its place in the folder ("2026-10-29/Docker -
 * Data Engineer/Jane Doe Resume.pdf"), with the folder's own separator. */
export function pathOf(place: string): string | null {
  const base = folderPath().replace(/[\\/]+$/, "");
  if (!base) return null;
  const separator = base.includes("/") && !base.includes("\\") ? "/" : "\\";
  return `${base}${separator}${place.split("/").join(separator)}`;
}

/** Where a job's résumé goes in the folder: a folder for the day it is saved
 * (this computer's date, "2026-10-29"), and in it one for the job ("Docker -
 * Data Engineer"), so every résumé keeps the plain name a recruiter should see. */
export function jobPlace(job: { company?: string | null; title?: string | null; id: string }): string[] {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const label = [job.company, job.title].map(part => (part ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join(" - ")
    .slice(0, 90).replace(/[ .]+$/, "");
  return [day, label || `Job ${job.id.slice(0, 8)}`];
}

/** Where each job's résumé was saved in the folder (to copy its path later). */
function names(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
export const savedName = (key: string): string | null => names()[key] ?? null;
function rememberName(key: string, name: string) {
  try { localStorage.setItem(NAMES_KEY, JSON.stringify({ ...names(), [key]: name })); } catch { /* not kept */ }
}

/** The folder, if writing to it is allowed: asks the browser when needed, so
 * call it first thing in a click (it may show the browser's own question). */
export async function writableFolder(): Promise<FolderHandle | null> {
  if (!canChooseFolder()) return null;
  const handle = await savedFolder();
  if (!handle) return null;
  try {
    if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return handle;
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted" ? handle : null;
  } catch {
    return null;
  }
}

/** Whether the folder has the file (saved earlier), at its place in the folder. */
export async function hasFile(handle: FolderHandle, place: string) {
  try {
    const parts = place.split("/");
    let at: FileSystemDirectoryHandle = handle;
    for (const part of parts.slice(0, -1)) at = await at.getDirectoryHandle(part);
    await at.getFileHandle(parts[parts.length - 1]);
    return true;
  } catch {
    return false;
  }
}

/** `name`: the file's own name; `place`: where it is in the folder; `path`: its whole path, when the folder's path is known. */
export type Saved = { error?: string; name?: string; place?: string; path?: string | null; where?: "folder" | "downloads" };

/** The file name the server gave ("Jane Doe Resume.pdf"), any language's letters kept. */
function fileName(header: string) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { /* the plain one, then */ } }
  return /filename="([^"]+)"/.exec(header)?.[1] ?? "Resume.pdf";
}

/** A résumé PDF (made on the server, a few seconds): into the member's folder
 * when one is chosen and allowed (`folder`, asked for at the click), in the
 * folders `within` (a job's: its day, then the job), else downloaded. `key`
 * remembers where it went, for copying its path later. */
export async function savePdf(query: string, folder: FolderHandle | null, key?: string, within: string[] = []): Promise<Saved> {
  let answer: Response;
  try {
    answer = await fetch(`/jobs/resume/pdf?${query}`);
  } catch {
    return { error: "The PDF could not be made. Please check the connection and try again." };
  }
  if (!answer.ok) return { error: (await answer.text().catch(() => "")) || "The PDF could not be made. Please try again." };
  const name = fileName(answer.headers.get("Content-Disposition") ?? "");
  const blob = await answer.blob();
  if (folder) {
    try {
      let at: FileSystemDirectoryHandle = folder;
      for (const part of within) at = await at.getDirectoryHandle(part, { create: true });
      const writer = await (await at.getFileHandle(name, { create: true })).createWritable();
      await writer.write(blob);
      await writer.close();
      const place = [...within, name].join("/");
      if (key) rememberName(key, place);
      return { name, place, path: pathOf(place), where: "folder" };
    } catch {
      // Not allowed after all, or the folder is gone: downloaded instead, below.
    }
  }
  if (key) rememberName(key, name);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  return { name, place: name, path: null, where: "downloads" };
}

/** Copies text; true when it went. */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
