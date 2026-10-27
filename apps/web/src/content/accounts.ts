/**
 * The two private pages behind Sign up: a signed-in visitor's account
 * (`/account`) and the admin page where KIASA approves who may sign in
 * (`/admin`). Every account starts as a request from the sign-up page; a person
 * at KIASA approves or declines it, and only then can its owner sign in.
 *
 * SAMPLE CONTENT, like the rest of the site: there are no accounts yet. The
 * people are invented, their addresses use the reserved `.example` domain, and
 * nothing on these pages is stored or sent.
 */

/** Why someone asks for an account, as the sign-up form offers it. */
export const reasons = [
  "I work with KIASA",
  "I am thinking of working with KIASA",
  "I follow KIASA's research",
  "I am looking for a job",
  "Something else",
] as const;
export type Reason = (typeof reasons)[number];

/** What a visitor can hear about from KIASA, in the Preference Center and on the account page. */
export const subjects = ["Research and reports", "Perspectives from our people", "News from KIASA", "Events and webinars", "Careers and open roles"] as const;

export type AccountStatus = "waiting" | "approved" | "declined";

export type Account = {
  id: string;
  name: string;
  email: string;
  organization?: string;
  reason: Reason;
  /** When they asked: ISO date and time, UTC. */
  asked: string;
  status: AccountStatus;
  /** When a person at KIASA decided: an ISO day. */
  decided?: string;
  /** Approved accounts: the last time they signed in, an ISO day. */
  lastSignIn?: string;
  /** An admin has made them a top manager: KIASA's leaf shows on their photo. */
  top?: boolean;
  /** The id of the team an admin put them in. */
  team?: string;
};

/** The person the account page is drawn for: a client, signed in. */
export const member = {
  name: "Lena Hartley",
  role: "Head of Platform Engineering, Halden Mutual",
  organization: "Halden Mutual",
  email: "lena.hartley@haldenmutual.example",
  approved: "2025-03-04",
  lastSignIn: "2026-10-24",
  /** The monthly KIASA Canopy report on the platforms KIASA runs for her team. Newest first. */
  reports: [
    { month: "September 2026", published: "2026-10-03", availability: "99.98%", incidents: "2, both resolved within the hour", changes: 41 },
    { month: "August 2026", published: "2026-09-04", availability: "99.99%", incidents: "1, resolved in 22 minutes", changes: 37 },
    { month: "July 2026", published: "2026-08-05", availability: "99.97%", incidents: "3, all resolved the same day", changes: 44 },
    { month: "June 2026", published: "2026-07-03", availability: "99.99%", incidents: "None", changes: 39 },
  ],
  saved: [
    { kind: "Research report", title: "The maintenance dividend", href: "/insights/the-maintenance-dividend", saved: "2026-10-12" },
    { kind: "Perspective", title: "Why the second year of a cloud migration matters more than the first", href: "/insights/second-year-of-a-cloud-migration", saved: "2026-09-30" },
    { kind: "Research report", title: "Platform pulse: what engineering leaders will fund in 2027", href: "/insights/platform-pulse-2027", saved: "2026-09-18" },
    { kind: "Perspective", title: "Security debt: the quiet risk on the balance sheet", href: "/insights/security-debt", saved: "2026-08-29" },
  ],
  events: [
    { date: "2026-11-12", time: "08:00 to 09:30", title: "Breakfast: running platforms people trust", place: "London studio, 41 Great Sutton Street", status: "Booked" },
    { date: "2026-12-03", time: "16:00 to 17:00", title: "Webinar: the maintenance dividend, one year on", place: "Online", status: "Booked" },
    { date: "2026-09-24", time: "18:00 to 20:00", title: "Open evening: what a Canopy report tells you", place: "London studio", status: "Recording ready" },
  ],
  /** Which of the subjects she hears about, and how often. */
  topics: ["Research and reports", "Perspectives from our people", "Events and webinars"] satisfies (typeof subjects)[number][],
  often: "A monthly digest",
  team: [
    { name: "Joaquim Serra", role: "Engagement Lead for Halden Mutual", email: "joaquim.serra@kiasa.tech", phone: "+44 20 3870 4410" },
    { name: "Abena Owusu", role: "Service Manager, KIASA Canopy", email: "abena.owusu@kiasa.tech" },
    { name: "Canopy support", role: "Around the clock, for an incident on a platform we run for you", email: "canopy-support@kiasa.tech", phone: "+44 20 3870 4499" },
  ],
};

/** The person the admin page is drawn for. */
export const admin = { name: "Tomás Ferreira", role: "Client Operations, Lisbon" };

/** Everyone who has asked for an account, newest first. The first four are waiting. */
export const accounts: Account[] = [
  { id: "a-118", name: "Wen Zhao", email: "wen.zhao@ospreyfreight.example", organization: "Osprey Freight", reason: "I work with KIASA", asked: "2026-10-26T08:42Z", status: "waiting" },
  { id: "a-117", name: "Samuel Achebe", email: "s.achebe@brannockrail.example", organization: "Brannock Rail", reason: "I am thinking of working with KIASA", asked: "2026-10-25T16:05Z", status: "waiting" },
  { id: "a-116", name: "Ruth Abernethy", email: "r.abernethy@vale-university.example", organization: "Vale University", reason: "I follow KIASA's research", asked: "2026-10-24T11:30Z", status: "waiting" },
  { id: "a-115", name: "Tobias Lang", email: "tobias.lang@mail.example", reason: "I am looking for a job", asked: "2026-10-23T19:58Z", status: "waiting" },
  { id: "a-114", name: "Growth Desk", email: "outreach@leadsbulk.example", organization: "Bulk Leads", reason: "Something else", asked: "2026-10-21T03:14Z", status: "declined", decided: "2026-10-21" },
  { id: "a-113", name: "Grete Sandvik", email: "grete.sandvik@vardaenergy.example", organization: "Varda Energy", reason: "I work with KIASA", asked: "2026-10-19T09:20Z", status: "approved", decided: "2026-10-19", lastSignIn: "2026-10-25" },
  { id: "a-112", name: "Joaquín Ibarra", email: "j.ibarra@pellam.example", organization: "Pellam Insurance", reason: "I am thinking of working with KIASA", asked: "2026-10-14T14:47Z", status: "approved", decided: "2026-10-15", lastSignIn: "2026-10-22" },
  { id: "a-111", name: "Moana Tipene", email: "moana.tipene@tesserahealth.example", organization: "Tessera Health", reason: "I work with KIASA", asked: "2026-10-08T22:03Z", status: "approved", decided: "2026-10-09", lastSignIn: "2026-10-26" },
  { id: "a-109", name: "Henry Akande", email: "henry.akande@ellerywater.example", organization: "Ellery Water", reason: "I follow KIASA's research", asked: "2026-09-27T10:11Z", status: "approved", decided: "2026-09-28", lastSignIn: "2026-10-17" },
  { id: "a-108", name: "Sunita Varma", email: "sunita.varma@haldenmutual.example", organization: "Halden Mutual", reason: "I work with KIASA", asked: "2026-09-16T08:35Z", status: "approved", decided: "2026-09-16", lastSignIn: "2026-10-23" },
  { id: "a-106", name: "Pavel Novak", email: "pavel.novak@mail.example", reason: "I am looking for a job", asked: "2026-09-02T18:26Z", status: "declined", decided: "2026-09-03" },
  { id: "a-104", name: "Saoirse Doyle", email: "saoirse.doyle@aldermoor.example", organization: "Aldermoor University", reason: "I follow KIASA's research", asked: "2026-08-21T13:02Z", status: "approved", decided: "2026-08-21", lastSignIn: "2026-10-02" },
  { id: "a-101", name: "Matteo Conti", email: "matteo.conti@ospreyfreight.example", organization: "Osprey Freight", reason: "I work with KIASA", asked: "2026-07-30T07:49Z", status: "approved", decided: "2026-07-30", lastSignIn: "2026-10-20" },
  { id: "a-097", name: "Aurélie Brun", email: "aurelie.brun@vardaenergy.example", organization: "Varda Energy", reason: "I work with KIASA", asked: "2026-06-11T15:40Z", status: "approved", decided: "2026-06-12", lastSignIn: "2026-10-12" },
  { id: "a-090", name: "Callan Price", email: "callan.price@kestrelcouncil.example", organization: "Kestrel County Council", reason: "I am thinking of working with KIASA", asked: "2026-04-02T09:05Z", status: "approved", decided: "2026-04-02", lastSignIn: "2026-09-08" },
  { id: "a-071", name: "Beatrix Kohl", email: "beatrix.kohl@tesserahealth.example", organization: "Tessera Health", reason: "I work with KIASA", asked: "2025-11-18T12:22Z", status: "approved", decided: "2025-11-18", lastSignIn: "2026-10-21" },
  { id: "a-042", name: "Lena Hartley", email: "lena.hartley@haldenmutual.example", organization: "Halden Mutual", reason: "I work with KIASA", asked: "2025-03-03T17:12Z", status: "approved", decided: "2025-03-04", lastSignIn: "2026-10-24" },
];
