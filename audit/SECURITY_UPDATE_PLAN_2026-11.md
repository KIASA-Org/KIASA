# KIASA security review and update plan (17 Nov 2026)

Four parts were reviewed: the database (every migration's latest rules and
functions), the website's server code (server actions, routes, headers), the
desktop apps and bots (Admin/User Live Desk, Sound Desk, KIASA Browser,
Job Saving Bot codes), and the KIASA ChatGPT Bridge extension.

## The worry: "users paste our database key"

What members and bots paste is **not** a key with powers. A connection code
holds three things:

- the database's address (public),
- its **public** key (the same one every visitor's browser already has: it
  gives no access by itself; the database's rules decide everything),
- the bot's or browser's **own secret** (about 244 random bits, only its hash
  is kept; it reaches only that bot's or that member's own data, through a few
  named functions).

The secret key that can do anything (`SUPABASE_SECRET_KEY`) never leaves the
server. No tracked file in the repository holds a secret.

No path was found where a member, an unapproved account or a stranger with the
public key makes themselves an admin **directly**. One indirect path was found
and is closed (1 below).

## Fixed in this update

| # | Severity | What | Where |
|---|----------|------|-------|
| 1 | High | **Admin takeover by email.** Anyone could make an account with a future admin's address (the request form does not prove an address is theirs; Supabase's own sign-up may be open). Adding the admin row, or re-running the old "link by email" SQL, then made that stranger the admin. Now an admin row must name its account's `user_id`, and that account must be marked `app_metadata.kiasa_admin` (only the database's own powers can set it). Existing admins were marked. | `supabase/migrations/20261117120000_hardening.sql` §1, `docs/site.md` step 4 |
| 2 | High | **Device check failed open.** An error inside the access-token hook gave an admin's sign-in full powers. It now gives none. The site's own check (`deviceLockOn`) also treats "no answer" as "lock on". | migration §2, `src/lib/accounts/server.ts` |
| 3 | Medium | **Password guessing.** Checks ran before tries were counted (a burst at once all passed), and a failing counter let every try through. Tries are now counted and checked in one step, fail closed, and an email is also limited from anywhere (60 per 15 min), not only per address. | migration §3, `signInAllowed` in `src/lib/accounts/server.ts`, sign-in action, `/desk/sign-in`, `/say/sign-in` |
| 4 | Medium | **One member could write a job's shared description**, which then went into every member's ChatGPT prompt for that job. A member's pasted (or bridge-read) description is now used for them alone; only an admin's is kept for everyone. | `src/lib/resume/actions.ts` |
| 5 | Medium | **Shared PDF printer could be kept busy by one member.** 90 PDFs an hour per person. | `src/app/jobs/resume/pdf/route.ts` |
| 6 | Medium | **Admin Live Desk could type a command.** A member's live text with a new line in it, pasted while the admin's cursor was in a terminal (VS Code's, a web SSH console), would press Enter. Every control character and line separator in a member's text is now a space. | `apps/admin live-desk/Core/BoxRules.cs` (`Clean`), `Win/Typer.cs`, `Core/WordWriter.cs`, tests |
| 7 | Medium | **KIASA Browser could be taken over by a link.** Any website could open a `kiasa-browser://` link with another member's code and the browser switched to it silently, keeping this person's Gmail connected. It now asks first (No by default) and lets the old Gmail go. | `agentic browser/main.go`, `internal/winmsg` |
| 8 | Medium | **Job bot code could post any link** (another computer's address, a link with a password). Bot links must now be https to a named public site. | migration §4 |
| 9 | Low | **Passing for an admin by name.** No member can take an admin's name, on the site or through `update_profile`. | migration §5, `src/lib/accounts/actions.ts` |
| 10 | Medium | **ChatGPT Bridge 1.5.0** (security update; KIASA shows members "update"): answers only KIASA's own pages and its own parts; opens only public job pages (never localhost, an IP address, a `.local`-like name, or a link with a password), on the extension and on KIASA's `/jobs/bridge/job`; questions capped at 400,000 characters. | `apps/web/bridge/*`, `src/components/jobs/jobs-bridge.ts`, `src/app/jobs/bridge/job/route.ts` |

## To do by hand (settings only the owner can change)

1. **Run the migration** `20261117120000_hardening.sql` in the Supabase SQL
   Editor **before** deploying the site (the site still works without it, but
   the new protections are in the database).
2. **Supabase → Authentication → Sign In / Providers: turn off "Allow new users
   to sign up".** The site makes accounts with its secret key; this closes the
   side door that skips the request form and its limits.
3. **Authentication → Hooks:** check that *Customize Access Token* is on and set
   to `public.custom_access_token_hook` (the admin device lock depends on it).
4. **Authentication → Rate Limits:** lower sign-in and sign-up limits; set the
   minimum password length to 12; turn on leaked-password protection and
   CAPTCHA (Turnstile) if the plan allows.
5. **Realtime → Settings:** turn off "Allow public access" so only the private
   channels (with their rules) can be joined.
6. **Rotate any code that may have been shared:** in the Jobs tab, Job Saving
   Bot → settings → *New code* for each computer; members can reconnect their
   KIASA Browser from Auto apply.

## Next updates (planned, not yet done)

| When | What | Why |
|------|------|-----|
| Next | **Two-step sign-in (TOTP) for admins**, required for admin powers (`aal2` in `admin_session_ok`). | Admin powers rest on a password plus a device; a second factor stops a stolen password and the "first device" rule being abused. |
| Next | **Prove the email on sign-up** (Supabase's confirmation email, or a code) instead of marking it confirmed. | Requests then show addresses people really own. |
| Next | **Publish the ChatGPT Bridge on the Chrome Web Store (unlisted)** instead of a zip loaded in Developer mode. | Signed, automatic updates; a tampered zip could no longer be passed around; members need not turn on Developer mode. |
| Next | **Sound Desk updates checked against a signature** (Authenticode, or an ed25519 key built into the app as the KIASA Browser already does). | Today it trusts whatever the website lists: a compromised deploy could push a program to every Sound Desk. |
| Soon | **Model server address pinned** to one named Cloudflare tunnel (not any `*.trycloudflare.com`), and its key and the release-signing key kept encrypted (DPAPI) or offline. | Whoever has the model-server key can point every member's browser at their own server. |
| Soon | **Expiry for bot and browser codes** (`expires_at`, `last_used_at`), with renewal from the site. | A code copied off a computer works until someone disconnects it. |
| Soon | **Content-Security-Policy with a nonce** (no `unsafe-inline` scripts), built per request in `src/proxy.ts`. | Any future HTML-injection bug would then not run script. |
| Later | Local proxy forwarders of the KIASA Browser to require a per-run token. | Other programs on the same PC could use the paid proxy. |
| Later | Re-check approval in every write rule (`resumes`, `applications`, `interviews`, chat edits). | A declined member could still change their old rows. |
| Decide | `team_board()` shows every member's salary and pay to every member. | Keep if intended; else show it only to admins and the member. |

## Checked and sound

Admin status comes only from `admins.user_id` (never from a token's email or
user-editable metadata). Every server action checks its caller on the server.
RLS is on for every table; every privileged function fixes its `search_path`.
Server-side fetching of job pages blocks private addresses, DNS rebinding and
unsafe redirects. Security headers (frame blocking, HSTS, nosniff, referrer,
permissions) are set in production. No TLS checks are switched off anywhere;
the KIASA Browser's updates are signed; no debugging port is exposed; desk
credentials are kept encrypted for the Windows user (DPAPI); no tokens are
logged.
