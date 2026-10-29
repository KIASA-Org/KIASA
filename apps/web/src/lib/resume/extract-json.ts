export type ExtractJsonResult =
  | { ok: true; value: Record<string, unknown>; json: string; source: "fence" | "bare" }
  | { ok: false; reason: "no-json" | "incomplete" | "invalid"; error: string; json?: string };

const FENCE_RE = /```[ \t]*(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
const OPEN_FENCE_RE = /```[ \t]*(?:json|JSON)?[ \t]*\r?\n/;

/**
 * Pulls the JSON object out of a pasted chat answer.
 * Prefers a ```json code block, falls back to the first "{" ... last "}", and tells a
 * cut-off answer apart from a malformed one so the user knows whether to rerun.
 */
export function extractJson(text: string): ExtractJsonResult {
  const cleaned = text.replace(/^﻿/, "");
  const candidates: { json: string; source: "fence" | "bare" }[] = [];

  for (const m of cleaned.matchAll(FENCE_RE)) candidates.push({ json: m[1], source: "fence" });

  if (candidates.length === 0) {
    const open = cleaned.search(OPEN_FENCE_RE);
    if (open >= 0) {
      const afterNewline = cleaned.indexOf("\n", open) + 1;
      candidates.push({ json: cleaned.slice(afterNewline), source: "fence" });
    }
  }

  if (candidates.length === 0) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push({ json: cleaned.slice(first, last + 1), source: "bare" });
    else if (first >= 0) candidates.push({ json: cleaned.slice(first), source: "bare" });
  }

  if (candidates.length === 0) {
    return { ok: false, reason: "no-json", error: "No JSON was found in the pasted text." };
  }

  let failure: ExtractJsonResult | null = null;
  // Largest candidate first: a real answer outranks a small example block.
  for (const c of [...candidates].sort((a, b) => b.json.length - a.json.length)) {
    const json = c.json.trim();
    try {
      const value: unknown = JSON.parse(json);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return { ok: true, value: value as Record<string, unknown>, json, source: c.source };
      }
      failure = { ok: false, reason: "invalid", error: "The JSON is not an object.", json };
    } catch (e) {
      failure = looksIncomplete(json)
        ? {
            ok: false,
            reason: "incomplete",
            error:
              "The answer looks cut off: the JSON is incomplete. Run it again, or ask the model to continue and paste the whole answer.",
            json,
          }
        : { ok: false, reason: "invalid", error: `Invalid JSON: ${(e as Error).message}`, json };
    }
  }
  return failure as ExtractJsonResult;
}

/** True when braces or a string are still open at the end: the signature of a truncated reply. */
export function looksIncomplete(json: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return inString || depth > 0;
}
