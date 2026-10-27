"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";
import { signIn } from "@/lib/accounts/actions";
import { Submit } from "./blocks/forms";

/** Email and password. Where a signed-in person goes next (their account, or
 * the admin page) is decided on the server; this only shows what to fix. */
export function SignInForm({ live }: { live: boolean }) {
  const [state, send, busy] = useActionState(signIn, {});
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy || !form.reportValidity()) return;
    startTransition(() => send(new FormData(form)));
  };
  return <form className="b-form signin-form" onSubmit={submit} aria-busy={busy}>
    {!live && <p className="account-preview-note">This is a sample site: accounts are not connected yet, so no one can sign in.</p>}
    <label className="b-field"><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
    <label className="b-field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>
    {state.error && <p className="b-form-error" role="alert">{state.error}</p>}
    {state.preview && <p className="b-form-error" role="alert">Accounts are not connected yet, so this sample site cannot sign anyone in.</p>}
    <div className="signin-actions">
      <Submit busy={busy}>{busy ? "Signing in…" : "Sign in"}</Submit>
      <Link href="/contact" className="textlink">Forgot your password?</Link>
    </div>
  </form>;
}
