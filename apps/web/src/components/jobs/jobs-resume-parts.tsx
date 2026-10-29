"use client";

import { useState } from "react";
import type { TailorReport } from "@/lib/resume/actions";
import { Copy } from "../site/icons";

/** Copies text for a chat, and shows how long it is (the text itself is long: the prompt and the résumé). */
export function CopyButton({ text, label, onCopied }: { text: string; label: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const box = document.createElement("textarea");
      box.value = text;
      document.body.appendChild(box);
      box.select();
      document.execCommand("copy");
      box.remove();
    }
    setCopied(true);
    onCopied?.();
    window.setTimeout(() => setCopied(false), 2500);
  };
  return <span className="resume-copy">
    <button type="button" className="jobs-button" data-primary="" onClick={() => void copy()}><Copy /> {copied ? "Copied" : label}</button>
    <span className="jobs-hint">{text.length.toLocaleString("en-US")} characters</span>
  </span>;
}

const List = ({ items }: { items: string[] }) => <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;

/** What an answer did, in the order to read it: what stopped it, what was
 * applied, what was not found, what was refused, and what to check. */
export function ReportLists({ report }: { report: Pick<TailorReport, "applied" | "unmatched" | "rejected" | "warnings" | "errors"> }) {
  return <div className="resume-report">
    {report.errors.length > 0 && <div data-tone="error"><strong>The answer could not be used:</strong><List items={report.errors} /></div>}
    {report.applied.length > 0 && <details data-tone="ok"><summary>Applied ({report.applied.length})</summary><List items={report.applied} /></details>}
    {report.unmatched.length > 0 && <div data-tone="error">
      <strong>Not found in your résumé, so skipped ({report.unmatched.length}):</strong><List items={report.unmatched} />
      <p>The chat changed the wording of a line instead of copying it. Run the prompt again in a new chat for a complete result, or keep the rest.</p>
    </div>}
    {report.rejected.length > 0 && <div data-tone="warn"><strong>Refused ({report.rejected.length}):</strong><List items={report.rejected} /></div>}
    {report.warnings.length > 0 && <details data-tone="warn"><summary>Please check ({report.warnings.length})</summary><List items={report.warnings} /></details>}
  </div>;
}

/** Downloads a résumé PDF (made on the server, a few seconds); what went wrong, if anything. */
export async function downloadPdf(query: string): Promise<string | null> {
  try {
    const answer = await fetch(`/jobs/resume/pdf?${query}`);
    if (!answer.ok) return (await answer.text()) || "The PDF could not be made. Please try again.";
    const name = /filename="([^"]+)"/.exec(answer.headers.get("Content-Disposition") ?? "")?.[1] ?? "resume.pdf";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await answer.blob());
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    return null;
  } catch {
    return "The PDF could not be made. Please check the connection and try again.";
  }
}
