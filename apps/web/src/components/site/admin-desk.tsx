"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import type { Account, AccountStatus } from "@/content/accounts";
import { decide, removeAccount } from "@/lib/accounts/actions";
import { useLiveRows } from "@/lib/accounts/live";
import { Search } from "./icons";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-26…" → "Oct 26, 2026". Written out by hand, so the server and every browser agree. */
const day = (iso: string) => {
  const [year, month, date] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[month - 1]} ${date}, ${year}`;
};
/** "2026-10-26T08:42…Z" → "08:42 UTC". */
const time = (iso: string) => `${iso.slice(11, 16)} UTC`;

const STATUS: Record<AccountStatus, string> = { waiting: "Waiting", approved: "Approved", declined: "Declined" };
const SHOW = ["all", "waiting", "approved", "declined"] as const;
type Decision = { status: "approved" | "declined"; decided: string };

/** The admin's desk: the requests waiting for a decision, then everyone, with a
 * search and a filter. With accounts connected (`live`) each decision is saved
 * and the page hears of new requests the moment they arrive; on the sample page
 * a decision lasts until the page is left, and says that nothing was sent. */
export function AdminDesk({ people: given, live, realtime }: { people: Account[]; live: boolean; realtime?: { url: string; key: string } }) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<(typeof SHOW)[number]>("all");
  const [notice, setNotice] = useState<{ text: string; sample?: boolean; failed?: boolean } | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{ text: string; sample?: boolean; failed?: boolean } | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // Asked to confirm a deletion, the safe answer is the one under the admin's hand.
  useEffect(() => { if (confirming) keep.current?.focus(); }, [confirming]);

  // Live: any new request, a decision made elsewhere, or a deletion refreshes the page's data.
  const listening = useLiveRows({ realtime, onChange: () => router.refresh(), catchUp: () => router.refresh() });

  // A decision or a deletion shows at once; what the server sends back takes over when it agrees.
  const people = given.filter(person => !removed.includes(person.id))
    .map(person => person.status === "waiting" && decisions[person.id] ? { ...person, ...decisions[person.id] } : person);
  const count = (status: AccountStatus) => people.filter(person => person.status === status).length;
  const waiting = people.filter(person => person.status === "waiting");

  const choose = (person: Account, status: Decision["status"]) => {
    setDecisions(current => ({ ...current, [person.id]: { status, decided: new Date().toISOString() } }));
    setNotice({
      sample: !live,
      text: status === "approved" ? `${person.name} is approved and can sign in now.` : `${person.name}'s request is declined. They are told so if they try to sign in.`,
    });
    if (!live) return;
    startTransition(async () => {
      const result = await decide(person.id, status);
      if (!result.error) return;
      setDecisions(current => {
        const rest = { ...current };
        delete rest[person.id];
        return rest;
      });
      setNotice({ text: result.error, failed: true });
    });
  };

  const remove = (person: Account) => {
    setConfirming(null);
    setRemoved(current => [...current, person.id]);
    setRemoval({ sample: !live, text: `${person.name}'s account is deleted, with their request. They can no longer sign in.` });
    if (!live) return;
    startTransition(async () => {
      const result = await removeAccount(person.id);
      if (!result.error) return;
      setRemoved(current => current.filter(id => id !== person.id));
      setRemoval({ text: result.error, failed: true });
    });
  };

  // Every word typed must appear in the person's name, email or organization.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = people.filter(person => (show === "all" || person.status === show)
    && words.every(word => `${person.name} ${person.email} ${person.organization ?? ""}`.toLowerCase().includes(word)));

  return <>
    <section className="block admin-top" aria-labelledby="admin-title">
      <div className="wrap wrap-wide">
        <p className="eyebrow block-eyebrow">Admin</p>
        <h1 id="admin-title" className="account-title">Accounts</h1>
        <p className="account-lead">Approve the people asking for an account, and find anyone who has one. No one can sign in until a person here approves them.</p>
        {realtime && <p className="admin-live" data-state={listening}>
          <span aria-hidden="true" />
          {listening === "live" ? "Live: new requests appear here the moment they are sent."
            : listening === "connecting" ? "Connecting live updates…"
              : "Live updates are paused, so this page checks for new requests every 30 seconds."}
        </p>}
        <dl className="b-stats admin-stats" data-count="3">
          <div className="b-stat"><dt className="b-stat-value">{count("waiting")}</dt><dd className="b-stat-label">Waiting for approval</dd></div>
          <div className="b-stat"><dt className="b-stat-value">{count("approved")}</dt><dd className="b-stat-label">Approved and able to sign in</dd></div>
          <div className="b-stat"><dt className="b-stat-value">{count("declined")}</dt><dd className="b-stat-label">Declined</dd></div>
        </dl>
      </div>
    </section>

    <section className="block admin-waiting" aria-labelledby="admin-waiting">
      <div className="wrap wrap-wide">
        <header className="block-head">
          <div className="block-head-text">
            <h2 id="admin-waiting" className="block-title">Waiting for approval</h2>
            <p className="block-lead">Newest first. Approving lets the person sign in with the password they chose; declining keeps them out.</p>
          </div>
        </header>
        <div role="status">
          {notice && <p className="admin-notice" data-failed={notice.failed ? "" : undefined}>
            {notice.text}{notice.sample && <span> This is a sample site: nothing was saved.</span>}
          </p>}
        </div>
        {waiting.length ? <ul className="admin-requests">
          {waiting.map(person => <li key={person.id} className="admin-request">
            <div className="admin-request-who">
              <p className="admin-request-name">{person.name}</p>
              <p className="admin-request-email">{person.email}</p>
            </div>
            <dl className="admin-request-facts">
              <div><dt>Organization</dt><dd>{person.organization ?? "None given"}</dd></div>
              <div><dt>Why</dt><dd>{person.reason}</dd></div>
              <div><dt>Asked</dt><dd>{day(person.asked)}, {time(person.asked)}</dd></div>
            </dl>
            <div className="admin-request-actions">
              <button type="button" className="admin-approve" aria-label={`Approve ${person.name}`} onClick={() => choose(person, "approved")}>Approve</button>
              <button type="button" className="account-button" aria-label={`Decline ${person.name}`} onClick={() => choose(person, "declined")}>Decline</button>
            </div>
          </li>)}
        </ul> : <p className="b-jobs-empty">No one is waiting. New requests appear here as they arrive.</p>}
      </div>
    </section>

    <section className="block admin-people" aria-labelledby="admin-people">
      <div className="wrap wrap-wide">
        <header className="block-head">
          <div className="block-head-text">
            <h2 id="admin-people" className="block-title">Everyone who has asked</h2>
          </div>
        </header>
        <div className="admin-filters">
          <label className="b-jobs-search">
            <Search />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, email or organization"
              aria-label="Search accounts" autoComplete="off" spellCheck={false} />
          </label>
          <div className="admin-show" role="group" aria-label="Show">
            {SHOW.map(option => <button key={option} type="button" aria-pressed={show === option} onClick={() => setShow(option)}>
              {option === "all" ? "All" : STATUS[option]} <span>{option === "all" ? people.length : count(option)}</span>
            </button>)}
          </div>
        </div>
        <div role="status">
          {removal && <p className="admin-notice admin-removal" data-failed={removal.failed ? "" : undefined}>
            {removal.text}{removal.sample && <span> This is a sample site: nothing was deleted.</span>}
          </p>}
        </div>
        <p className="b-jobs-count" aria-live="polite">
          {shown.length ? `${shown.length} of ${people.length} people` : people.length ? `Nothing found${query.trim() ? ` for “${query.trim()}”` : ""}` : "No one has asked for an account yet."}
        </p>
        {shown.length > 0 && <div className="account-scroll">
          <table className="account-table admin-table">
            <thead>
              <tr><th scope="col">Person</th><th scope="col">Organization</th><th scope="col">Why</th><th scope="col">Status</th><th scope="col">Asked</th><th scope="col">Last signed in</th><th scope="col" className="admin-actions-head">Delete</th></tr>
            </thead>
            <tbody>
              {shown.map(person => <tr key={person.id}>
                <th scope="row">
                  <span className="admin-person-name">{person.name}</span>
                  <span className="admin-person-email">{person.email}</span>
                  {/* Phones drop the organization column; it joins the person instead. */}
                  <span className="admin-person-org">{person.organization ?? "No organization given"}</span>
                </th>
                <td>{person.organization ?? "None given"}</td>
                <td>{person.reason}</td>
                <td>
                  <span className="admin-status" data-status={person.status}>{STATUS[person.status]}</span>
                  {person.decided && <span className="admin-when">{day(person.decided)}</span>}
                </td>
                <td>{day(person.asked)}</td>
                <td>{person.lastSignIn ? day(person.lastSignIn) : person.status === "approved" ? "Not yet" : "None"}</td>
                <td className="admin-actions">
                  {confirming === person.id
                    ? <div className="admin-confirm" role="group" aria-label={`Delete ${person.name}?`}>
                      <span>Delete {person.name.split(" ")[0]} for good?</span>
                      <button type="button" className="account-button account-danger" onClick={() => remove(person)}>Delete</button>
                      <button ref={keep} type="button" className="account-button" onClick={() => setConfirming(null)}>Keep</button>
                    </div>
                    : <button type="button" className="admin-delete" aria-label={`Delete ${person.name}`} onClick={() => setConfirming(person.id)}>Delete</button>}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      </div>
    </section>
  </>;
}
