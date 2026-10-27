import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteShell } from "@/components/site/shell";
import { SignInForm } from "@/components/site/sign-in-form";
import { accountsLive, currentViewer } from "@/lib/accounts/server";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your KIASA account.",
  robots: { index: false, follow: true },
};

/** Where people with a request, and KIASA's admins, sign in. Anyone already
 * signed in goes straight on: to their account (or their request's status), or
 * the admin page. */
export default async function SignInPage() {
  const viewer = await currentViewer();
  if (viewer?.admin) redirect("/admin");
  if (viewer?.member) redirect("/account");
  return <SiteShell>
    <div className="page account">
      <section className="block account-hero" aria-labelledby="sign-in-title">
        <div className="wrap wrap-wide b-form-layout">
          <div>
            <p className="eyebrow block-eyebrow">Your account</p>
            <h1 id="sign-in-title" className="account-title">Sign in</h1>
            <p className="account-lead">With the email and password you chose when you asked for your account. A person at KIASA approves every account first.</p>
            <p className="signin-alt"><Link href="/sign-up" className="textlink">No account yet? Ask for one</Link></p>
          </div>
          <SignInForm live={accountsLive} />
        </div>
      </section>
    </div>
  </SiteShell>;
}
