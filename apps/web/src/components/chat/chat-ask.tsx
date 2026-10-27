"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askContact, decideContact } from "@/lib/teams/contacts";
import type { Attachment, ChatMe } from "@/lib/chat/types";
import type { Reach } from "@/lib/teams/rules";
import { Alert } from "../site/icons";

/** Asking the admin to let one message someone: a warning that says why it
 * is needed, a few words for the admin, and the request; or, with a request
 * already made, that it is waiting. */
export function AskToMessage({ person, reach, why, onAsked, onClose }: {
  person: { id: string; name: string }; reach: Reach; why: string; onAsked: (text: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);
  const first = person.name.split(" ")[0];

  const ask = () => start(async () => {
    setError("");
    const result = await askContact(person.id, reason);
    if (result.error) return setError(result.error);
    onAsked(result.already ? `You can message ${first} now.` : `Your request to message ${first} is with the admin. You will hear here when they decide.`);
    onClose();
  });

  return <dialog ref={dialog} className="chat-dialog chat-ask" aria-label={`Message ${person.name}`} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <p className="chat-dialog-title">{reach === "waiting" ? "Waiting for the admin" : "The admin's approval is needed"}</p>
    <p className="chat-ask-warning"><Alert />{why}</p>
    {reach === "waiting"
      ? <p className="chat-dialog-text">You asked to message {first}. Once the admin approves it, you can write to each other.</p>
      : <label className="chat-field chat-ask-reason"><span>Why you want to message {first} (optional)</span>
        <textarea rows={3} maxLength={300} value={reason} onChange={event => setReason(event.target.value)} placeholder="For example: to plan the launch together" />
      </label>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
    <div className="chat-dialog-actions">
      <button type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>{reach === "waiting" ? "Close" : "Cancel"}</button>
      {reach !== "waiting" && <button type="button" className="chat-dialog-button" onClick={ask} disabled={busy} autoFocus>{busy ? "Asking…" : "Ask the admin"}</button>}
    </div>
  </dialog>;
}

/** A request to talk, as a card in the admins' "Contact requests" chat: who
 * asks to message whom, and why; the admin approves or declines it there. */
export function ContactCard({ id, card, me, menuOn }: {
  id: string; card: Extract<Attachment, { type: "contact" }>; me: ChatMe; menuOn: Record<string, unknown>;
}) {
  const [working, start] = useTransition();
  const [error, setError] = useState("");
  const act = (status: "approved" | "declined") => start(async () => {
    setError("");
    const result = await decideContact(card.id, status);
    if (result.error) setError(result.error);
  });
  const label = { waiting: "Waiting for approval", approved: "Approved", declined: "Declined" }[card.status];
  return <div id={id} className="chat-request" data-status={card.status} {...menuOn}>
    <p className="chat-request-kicker">Request to message</p>
    <p className="chat-request-name">{card.from.name} → {card.to.name}</p>
    <dl className="chat-request-facts">
      <div><dt>Why</dt><dd>{card.reason || "No reason given"}</dd></div>
    </dl>
    <p className="chat-request-status">{label}{card.decided_by ? ` by ${card.decided_by}` : ""}</p>
    {card.status === "waiting" && me.admin && <div className="chat-request-actions">
      <button type="button" className="admin-approve" aria-disabled={working || undefined} onClick={working ? undefined : () => act("approved")}>{working ? "Saving…" : "Approve"}</button>
      <button type="button" className="account-button" aria-disabled={working || undefined} onClick={working ? undefined : () => act("declined")}>Decline</button>
    </div>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
  </div>;
}

/** In place of the box to write in, where one may not write yet: why, and the
 * way to ask the admin (or that the request is waiting). */
export function AskBar({ name, reach, onAsk }: { name: string; reach: Reach; onAsk: () => void }) {
  const first = name.split(" ")[0];
  return <div className="chat-readonly chat-askbar">
    <span>{reach === "waiting" ? `Your request to message ${first} is waiting for the admin.` : `Messaging ${first} needs the admin's approval.`}</span>
    {reach === "ask" && <button type="button" className="chat-pill" onClick={onAsk}>Ask the admin</button>}
  </div>;
}
