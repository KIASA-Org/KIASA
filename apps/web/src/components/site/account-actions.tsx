"use client";

import Link from "next/link";
import { startTransition, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { deleteAccount, setDigest, signOut } from "@/lib/accounts/actions";

const WORDS = {
  account: {
    start: "Delete my account", group: "Delete your account", go: "Delete it", busy: "Deleting…", keep: "Keep my account",
    ask: "Delete your account and everything in it: your details, your request and what you hear about? This cannot be undone.",
  },
  request: {
    start: "Withdraw my request", group: "Withdraw your request", go: "Withdraw it", busy: "Withdrawing…", keep: "Keep my request",
    ask: "Withdraw your request and delete everything you told us? This cannot be undone.",
  },
};

/** Signing out, and deleting the account (or, while it waits, withdrawing the
 * request) after a second, explicit yes. With accounts connected (`live`) both
 * are real; on the sample page nothing is deleted, and the page says so. */
export function AccountActions({ live = false, subject = "account" }: { live?: boolean; subject?: keyof typeof WORDS }) {
  const words = WORDS[subject];
  const [step, setStep] = useState<"idle" | "confirm" | "done">("idle");
  const [error, setError] = useState("");
  const [deleting, startDeleting] = useTransition();
  const keep = useRef<HTMLButtonElement>(null);
  // Asked to confirm, the safe answer is the one under the visitor's hand.
  useEffect(() => { if (step === "confirm") keep.current?.focus(); }, [step]);

  const remove = () => {
    if (!live) return setStep("done");
    startDeleting(async () => {
      const result = await deleteAccount();
      if (result?.error) setError(result.error);
    });
  };

  return <div className="account-actions">
    <div className="account-buttons">
      {live
        ? <form action={signOut}><button type="submit" className="account-button">Sign out</button></form>
        : <Link href="/" className="account-button">Sign out</Link>}
      {step === "idle" && <button type="button" className="account-button account-danger" onClick={() => setStep("confirm")}>{words.start}</button>}
    </div>
    {step === "confirm" && <div className="account-confirm" role="group" aria-label={words.group}>
      <p>{words.ask}</p>
      <div className="account-buttons">
        <button type="button" className="account-button account-danger" aria-disabled={deleting || undefined} onClick={deleting ? undefined : remove}>{deleting ? words.busy : words.go}</button>
        <button ref={keep} type="button" className="account-button" onClick={() => setStep("idle")}>{words.keep}</button>
      </div>
    </div>}
    <div role="status">
      {step === "done" && <p className="account-status">This is a sample site: nothing was deleted.</p>}
      {error && <p className="b-form-error">{error}</p>}
    </div>
  </div>;
}

/** The monthly research digest, on or off. The switch moves at once and the
 * choice is saved behind it; if saving fails it moves back and says why. */
export function DigestSwitch({ on }: { on: boolean }) {
  const [shown, show] = useOptimistic(on);
  const [error, setError] = useState("");
  const toggle = () => startTransition(async () => {
    show(!shown);
    const result = await setDigest(!shown);
    setError(result.error ?? "");
  });
  return <div className="account-switch">
    <button type="button" role="switch" aria-checked={shown} className="account-switch-row" onClick={toggle}>
      <span className="account-switch-text">
        <span className="account-switch-name">Monthly research digest</span>
        <span>New research and perspectives from KIASA, once a month.</span>
      </span>
      <span className="account-switch-track" aria-hidden="true" />
    </button>
    {error && <p className="b-form-error" role="alert">{error}</p>}
  </div>;
}
