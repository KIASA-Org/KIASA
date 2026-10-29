"use client";

import { useState, type RefObject } from "react";
import { ArrowLeft } from "../site/icons";

/** Jobs a page at a time. Back to the first page whenever `view` changes (the
 * day, the filter, the search). `page` is the page shown, `items` its jobs. */
export function usePages<T>(all: T[], size: number, view: string) {
  const [at, setAt] = useState({ view, page: 1 });
  const pages = Math.max(1, Math.ceil(all.length / size));
  const page = Math.min(at.view === view ? at.page : 1, pages);
  return { page, pages, size, total: all.length, items: all.slice((page - 1) * size, page * size), go: (next: number) => setAt({ view, page: Math.min(Math.max(1, next), pages) }) };
}

/** The pages' numbers: the first, the last, and those near the one shown. */
function numbers(page: number, pages: number): (number | "gap")[] {
  const near = new Set([1, pages, page - 1, page, page + 1].filter(n => n >= 1 && n <= pages));
  const sorted = [...near].sort((a, b) => a - b);
  return sorted.flatMap((n, index) => index && n - sorted[index - 1] > 1 ? ["gap" as const, n] : [n]);
}

/** Below a list: "21–40 of 120", and the pages to go to. Going to a page
 * brings the list's top into view. Nothing when everything fits on one. */
export function Pager({ pages: paging, label, top }: { pages: ReturnType<typeof usePages<unknown>>; label: string; top?: RefObject<HTMLElement | null> }) {
  const { page, pages, size, total, go } = paging;
  if (pages <= 1) return null;
  const to = (next: number) => {
    go(next);
    top?.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return <nav className="jobs-pager" aria-label={label}>
    <span className="jobs-hint">{(page - 1) * size + 1}–{Math.min(page * size, total)} of {total}</span>
    <span className="jobs-pager-pages">
      <button type="button" className="chat-icon" aria-label="The page before" disabled={page === 1} onClick={() => to(page - 1)}><ArrowLeft /></button>
      {numbers(page, pages).map((entry, index) => entry === "gap"
        ? <span key={`gap${index}`} className="jobs-pager-gap" aria-hidden="true">…</span>
        : <button key={entry} type="button" className="jobs-pager-page" aria-current={entry === page ? "page" : undefined} aria-label={`Page ${entry}`} onClick={() => to(entry)}>{entry}</button>)}
      <button type="button" className="chat-icon jobs-next" aria-label="The page after" disabled={page === pages} onClick={() => to(page + 1)}><ArrowLeft /></button>
    </span>
  </nav>;
}
