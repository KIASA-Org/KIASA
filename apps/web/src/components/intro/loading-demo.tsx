"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StartupBoundary } from "./controller";

/** Development fixture for `StartupBoundary`: readiness follows an actual request,
 * never the animation. The page behind is a stand-in, not site content. */
export function LoadingDemo() {
  const [status, setStatus] = useState<"pending" | "ready" | "error">("pending");
  const [completions, setCompletions] = useState(0);
  const [skips, setSkips] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/dev/intro/resource", { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error("Request failed");
      return response.json();
    }).then(() => setStatus("ready")).catch(() => {
      if (!abort.signal.aborted) setStatus("error");
    });
    return () => abort.abort();
  }, []);
  return <>
    <StartupBoundary readiness={status === "pending" ? { status: "pending" } : { status: "ready" }}
      onComplete={() => setCompletions(count => count + 1)} onSkip={() => setSkips(count => count + 1)}>
      <main id="main-content" className="dev-site" tabIndex={-1}>
        <h1>{status === "error" ? "The request failed" : "The request finished"}</h1>
        <p>This stand-in page was behind the mark while a real request was pending.</p>
        <Link href="/dev/intro">Back to the inspector</Link>
      </main>
    </StartupBoundary>
    <output hidden data-completions={completions} data-skips={skips} />
  </>;
}
