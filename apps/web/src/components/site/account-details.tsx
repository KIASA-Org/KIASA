"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { reasons } from "@/content/accounts";
import { changePassword, updateDetails, type FormState } from "@/lib/accounts/actions";

type Details = { name: string; email: string; organization?: string; reason: string };

/** A member's details, and changing them: Edit details (name, organization,
 * why they joined) and Change password open in place, below the details. */
export function AccountDetails({ details }: { details: Details }) {
  const [open, setOpen] = useState<"details" | "password" | null>(null);
  const [said, setSaid] = useState("");
  const done = (what: string) => { setOpen(null); setSaid(what); };
  return <div className="account-editable">
    <dl className="account-details">
      <div><dt>Name</dt><dd>{details.name}</dd></div>
      <div><dt>Email</dt><dd>{details.email}</dd></div>
      <div><dt>Organization</dt><dd>{details.organization ?? "None given"}</dd></div>
      <div><dt>Why you joined</dt><dd>{details.reason}</dd></div>
      <div><dt>Signing in</dt><dd>With your email and password</dd></div>
    </dl>
    {!open && <div className="account-buttons">
      <button type="button" className="account-button" onClick={() => { setSaid(""); setOpen("details"); }}>Edit details</button>
      <button type="button" className="account-button" onClick={() => { setSaid(""); setOpen("password"); }}>Change password</button>
    </div>}
    {said && <p className="account-status" role="status">{said}</p>}
    {open === "details" && <DetailsForm details={details} onDone={() => done("Your details are saved.")} onCancel={() => setOpen(null)} />}
    {open === "password" && <PasswordForm onDone={() => done("Your password is changed. Use the new one next time you sign in.")} onCancel={() => setOpen(null)} />}
  </div>;
}

function DetailsForm({ details, onDone, onCancel }: { details: Details; onDone: () => void; onCancel: () => void }) {
  const [state, send, busy] = useActionState<FormState, FormData>(updateDetails, {});
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => { if (state.done) onDone(); }, [state, onDone]);
  return <form action={send} className="b-form account-edit" aria-label="Edit your details">
    <label className="b-field"><span>Name</span><input ref={first} name="name" defaultValue={details.name} autoComplete="name" maxLength={80} required /></label>
    <label className="b-field"><span>Organization (optional)</span><input name="organization" defaultValue={details.organization ?? ""} autoComplete="organization" maxLength={160} /></label>
    <label className="b-field"><span>Why you joined</span>
      <select name="reason" defaultValue={details.reason}>{reasons.map(reason => <option key={reason}>{reason}</option>)}</select>
    </label>
    <p className="account-note">Your email is how you sign in; to change it, ask a person at KIASA.</p>
    {state.error && <p className="b-form-error" role="alert">{state.error}</p>}
    <div className="account-buttons">
      <button type="submit" className="b-submit account-save" disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
      <button type="button" className="account-button" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  </form>;
}

function PasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [state, send, busy] = useActionState<FormState, FormData>(changePassword, {});
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => { if (state.done) onDone(); }, [state, onDone]);
  return <form action={send} className="b-form account-edit" aria-label="Change your password">
    <label className="b-field"><span>Current password</span><input ref={first} name="current" type="password" autoComplete="current-password" required /></label>
    <div className="b-form-row">
      <label className="b-field"><span>New password (10 to 72 characters)</span><input name="next" type="password" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
      <label className="b-field"><span>New password again</span><input name="again" type="password" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
    </div>
    {state.error && <p className="b-form-error" role="alert">{state.error}</p>}
    <div className="account-buttons">
      <button type="submit" className="b-submit account-save" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
      <button type="button" className="account-button" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  </form>;
}
