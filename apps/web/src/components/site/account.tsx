import Link from "next/link";
import type { ReactNode } from "react";
import { member as sample, subjects } from "@/content/accounts";
import type { Member } from "@/lib/accounts/server";
import { initialsOf } from "@/lib/accounts/viewer";
import { AccountActions, DigestSwitch } from "./account-actions";
import { AccountDetails } from "./account-details";
import { Avatar } from "./avatar";
import { Contacts, Features } from "./blocks/sections";
import { Cta, Section, SectionHead, longDate } from "./blocks/shared";
import { Check } from "./icons";
import { RequestWatcher } from "./request-watcher";
import { YourPhoto } from "./your-photo";

/** Says, on a private page, that accounts are not connected yet and what is shown instead. */
export function PreviewNote() {
  return <p className="account-preview" role="note">
    <span>Preview</span> Accounts are not connected yet, so this page shows sample people, and nothing done here is kept.
  </p>;
}

/** The top of an account: the welcome, and a card saying who is signed in.
 * `banner` sits above it: the preview note, or the news of an approval.
 * `who`: their square and name, when it is more than their initials (their
 * photo, which they can set or change there). */
function AccountHero({ name, role, lead, facts, banner, eyebrow = "Your account", title, who, children }: {
  name: string; role?: string; lead: string; facts: [string, string][]; banner?: ReactNode;
  eyebrow?: string; title?: string; who?: ReactNode; children?: ReactNode;
}) {
  return <section className="block account-hero" aria-labelledby="account-title">
    {banner && <div className="wrap wrap-wide">{banner}</div>}
    <div className="wrap wrap-wide account-hero-grid">
      <div>
        <p className="eyebrow block-eyebrow">{eyebrow}</p>
        <h1 id="account-title" className="account-title">{title ?? `Welcome back, ${name.split(" ")[0]}`}</h1>
        <p className="account-lead">{lead}</p>
        {children}
      </div>
      <div className="account-card">
        <div className="account-who">
          {who ?? <>
            <Avatar initials={initialsOf(name)} className="account-initials" />
            <div>
              <p className="account-name">{name}</p>
              {role && <p className="account-role">{role}</p>}
            </div>
          </>}
        </div>
        <dl className="account-facts">
          {facts.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
        </dl>
      </div>
    </div>
  </section>;
}

const day = (iso: string) => longDate(iso.slice(0, 10));

/** The account of a signed-in person, from their request: who they are, what
 * they hear about, and the account itself. What will gather here later is said
 * plainly, not filled with sample content. */
export function MemberAccountView({ member, photo, realtime, welcome = false }: {
  member: Member; photo: string | null; realtime: { url: string; key: string }; welcome?: boolean;
}) {
  const facts: [string, string][] = [["Signed in as", member.email]];
  if (member.decided) facts.push(["Approved by KIASA", day(member.decided)]);
  if (member.lastSignIn) facts.push(["Last signed in", day(member.lastSignIn)]);
  return <div className="page account">
    <AccountHero name={member.name} role={member.organization} facts={facts}
      who={<YourPhoto person={{ id: member.id, name: member.name }} photo={photo} realtime={realtime} className="account-initials"
        details="card" role={member.organization} align="start" />}
      title={welcome ? `Welcome, ${member.name.split(" ")[0]}` : undefined}
      banner={welcome && <p className="account-welcome" role="status"><span>Approved</span> A person at KIASA approved your request: your account is ready.</p>}
      lead="Your details and what you hear from us. Your reading, your events and, for clients, your reports will gather here.">
      <div className="account-ctas">
        <Cta link={{ label: "Open KIASA Jobs", href: "/jobs" }} className="account-cta" />
        <Cta link={{ label: "Open KIASA Chat", href: "/chat" }} className="account-cta" />
      </div>
    </AccountHero>

    <Section type="account-settings">
      <div className="account-columns">
        <div>
          <SectionHead eyebrow="Your topics" heading="What you hear about" />
          <DigestSwitch on={member.digest} />
          <p className="account-note">The Preference Center lists everything else we write about.</p>
          <Cta link={{ label: "Preference Center", href: "/preferences" }} className="account-cta" />
        </div>
        <div>
          <SectionHead eyebrow="Your details" heading="Your account" />
          <AccountDetails details={{ name: member.name, email: member.email, organization: member.organization, reason: member.reason }} />
          <AccountActions live />
        </div>
      </div>
    </Section>

    <Features block={{
      type: "features", tone: "paper", eyebrow: "Coming to your account", heading: "What will gather here",
      items: [
        { title: "Your reports", text: "For clients: the monthly KIASA Canopy report on the platforms we run for you, once we connect you to your team.", pattern: "pulse", link: { label: "KIASA Canopy", href: "/canopy" } },
        { title: "Saved for later", text: "The research, perspectives and client stories you keep to read later.", pattern: "matrix", link: { label: "What we think", href: "/insights" } },
        { title: "Your events", text: "Your seats at breakfasts, talks and open evenings in our studios.", pattern: "orbit", link: { label: "Our studios", href: "/about/locations" } },
      ],
    }} />
  </div>;
}

/** A request still waiting, or declined, as its owner sees it: what they asked
 * and when, straight from the database, so a refresh cannot lose it. While it
 * waits, the page watches for the decision and changes the moment it is made. */
export function RequestStatusView({ member, realtime, pushKey }: { member: Member; realtime: { url: string; key: string }; pushKey: string }) {
  const waiting = member.status === "waiting";
  const facts: [string, string][] = [["Email", member.email], ["Asked", day(member.asked)], ["Status", waiting ? "Waiting for approval" : "Not approved"]];
  return <div className="page account">
    <AccountHero name={member.name} role={member.organization} facts={facts} eyebrow="Your request"
      title={waiting ? "Your request is with our team" : "Your request was not approved"}
      lead={waiting
        ? "A person at KIASA reads every request, usually within one working day. Once yours is approved, this page becomes your account."
        : "A person at KIASA looked at your request and could not approve it. If you think that is a mistake, please tell us."}>
      {waiting ? <RequestWatcher id={member.id} realtime={realtime} pushKey={pushKey} /> : <Cta link={{ label: "Contact us", href: "/contact" }} className="account-cta" />}
    </AccountHero>

    <Section type="account-settings">
      <div className="account-columns">
        <div>
          <SectionHead eyebrow="What you told us" heading="Your request" />
          <dl className="account-details">
            <div><dt>Name</dt><dd>{member.name}</dd></div>
            <div><dt>Email</dt><dd>{member.email}</dd></div>
            <div><dt>Organization</dt><dd>{member.organization ?? "None given"}</dd></div>
            <div><dt>Why</dt><dd>{member.reason}</dd></div>
          </dl>
        </div>
        <div>
          <SectionHead eyebrow="Changed your mind?" heading="Withdraw it" />
          <p className="account-note account-note-lead">Sign out here, or withdraw your request: it is deleted at once, with everything you told us.</p>
          <AccountActions live subject="request" />
        </div>
      </div>
    </Section>
  </div>;
}

/** The account page as designed, drawn for the sample client in
 * `content/accounts.ts`: shown until accounts are connected. */
export function SampleAccountView() {
  return <div className="page account">
    <AccountHero banner={<PreviewNote />} name={sample.name} role={sample.role} lead="Your reports, your reading and your events, in one place."
      facts={[["Signed in as", sample.email], ["Approved by KIASA", longDate(sample.approved)], ["Last signed in", longDate(sample.lastSignIn)]]} />

    <Section type="account-reports">
      <SectionHead eyebrow="KIASA Canopy" heading="Your reports"
        intro={`Each month, the platforms we run for ${sample.organization}, in plain language: how they ran, what went wrong and what changed.`}
        cta={{ label: "What a report covers", href: "/canopy" }} />
      <div className="account-scroll">
        <table className="account-table">
          <thead>
            <tr><th scope="col">Month</th><th scope="col">Availability</th><th scope="col">Incidents</th><th scope="col">Changes shipped</th><th scope="col">Published</th></tr>
          </thead>
          <tbody>
            {sample.reports.map(report => <tr key={report.month}>
              <th scope="row">{report.month}</th>
              <td className="account-figure">{report.availability}</td>
              <td>{report.incidents}</td>
              <td>{report.changes}</td>
              <td>{longDate(report.published)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <p className="account-note">The October report arrives in the first week of November.</p>
    </Section>

    <Section type="account-lists" tone="paper">
      <div className="account-columns">
        <div>
          <SectionHead eyebrow="Your reading" heading="Saved for later" />
          <ul className="account-rows">
            {sample.saved.map(item => <li key={item.href}>
              <Link href={item.href} className="account-row">
                <span className="account-row-kind">{item.kind}</span>
                <span className="account-row-title">{item.title}</span>
                <span className="account-row-meta">Saved {longDate(item.saved)}</span>
              </Link>
            </li>)}
          </ul>
        </div>
        <div>
          <SectionHead eyebrow="Your events" heading="Booked and coming up" />
          <ul className="account-rows">
            {sample.events.map(event => <li key={event.title} className="account-row account-event">
              <span className="account-row-kind">{longDate(event.date)}, {event.time}</span>
              <span className="account-row-title">{event.title}</span>
              <span className="account-row-meta">{event.place}</span>
              <span className="account-badge" data-done={event.status === "Booked" ? undefined : ""}>{event.status}</span>
            </li>)}
          </ul>
        </div>
      </div>
    </Section>

    <Contacts block={{ type: "contacts", heading: "Your team at KIASA", intro: "The people who run your platforms, and the line that is answered around the clock.", items: sample.team }} />

    <Section type="account-settings">
      <div className="account-columns">
        <div>
          <SectionHead eyebrow="Your topics" heading="What you hear about" />
          <ul className="account-topics">
            {subjects.map(subject => {
              const chosen = (sample.topics as readonly string[]).includes(subject);
              return <li key={subject} data-chosen={chosen ? "" : undefined}>
                <span className="account-topic-mark" aria-hidden="true">{chosen && <Check />}</span>
                <span>{subject}</span>
                <span className="account-topic-state">{chosen ? "On" : "Off"}</span>
              </li>;
            })}
          </ul>
          <p className="account-note">How often: {sample.often.toLowerCase()}.</p>
          <Cta link={{ label: "Change them in the Preference Center", href: "/preferences" }} className="account-cta" />
        </div>
        <div>
          <SectionHead eyebrow="Your details" heading="Your account" />
          <dl className="account-details">
            <div><dt>Name</dt><dd>{sample.name}</dd></div>
            <div><dt>Work email</dt><dd>{sample.email}</dd></div>
            <div><dt>Organization</dt><dd>{sample.organization}</dd></div>
            <div><dt>Signing in</dt><dd>With your email and password</dd></div>
          </dl>
          <AccountActions />
        </div>
      </div>
    </Section>
  </div>;
}
