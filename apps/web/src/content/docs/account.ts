import type { PageDoc } from "../blocks";

/** The page behind the header's Sign up button. A visitor asks for an account
 * here, choosing a password; a person at KIASA approves it on the admin page
 * (`/admin`), and then the visitor signs in at `/sign-in`. The form is real
 * once accounts are connected (`src/lib/accounts`); until then it says that
 * nothing was sent. The rest of the page is sample content, like the site. */

const signUp: PageDoc = {
  href: "/sign-up",
  title: "Sign up",
  section: "KIASA",
  summary: "Ask for a KIASA account to keep your reading, your topics and, as a client, your reports in one place.",
  blocks: [
    {
      type: "hero",
      variant: "plain",
      eyebrow: "Sign up",
      title: "Ask for a KIASA account",
      lead: "One place for the research you save, the events you join and, if you are a client, the reports on the systems we run for you. A person at KIASA approves every account; then you sign in with your email and password.",
      cta: { label: "Already approved? Sign in", href: "/sign-in" },
      pattern: "veins",
    },
    {
      type: "form",
      heading: "Request an account",
      intro: "A person at KIASA reads every request, usually within one working day. Once yours is approved, sign in with your email and the password you choose here. If you are a client, use your work email, so we can connect you to your team's reports.",
      kind: "sign-up",
    },
    {
      type: "steps",
      tone: "paper",
      eyebrow: "How it works",
      heading: "From request to signed in",
      intro: "A person approves each account, so the people on it are the people they say they are.",
      items: [
        { title: "Tell us who you are", text: "Your name, your work email, your organization if you like, and a password. It takes a minute." },
        { title: "We approve your request", text: "A person at KIASA reads it, usually within one working day, and connects clients to their team's reports." },
        { title: "See it change", text: "Your request page shows where it stands, and becomes your account the moment it is approved. Your computer can tell you too." },
        { title: "Come back any time", text: "Sign in with your email and password: your reading, topics and, for clients, reports are waiting." },
      ],
    },
    {
      type: "features",
      eyebrow: "Your account",
      heading: "What it keeps for you",
      items: [
        { title: "Your reading", text: "Research, perspectives and client stories you save, to read later on any device.", pattern: "matrix", link: { label: "What we think", href: "/insights" } },
        { title: "Your topics", text: "What you hear about from us, and how often. Nothing else arrives.", pattern: "waves", link: { label: "Preference Center", href: "/preferences" } },
        { title: "Your events", text: "Your seats at breakfasts, talks and open evenings in our studios, and the recordings afterwards.", pattern: "orbit", link: { label: "Our studios", href: "/about/locations" } },
        { title: "Your reports", text: "For clients: the monthly KIASA Canopy report, your service handbook and the people on your team.", pattern: "pulse", link: { label: "KIASA Canopy", href: "/canopy" } },
      ],
    },
    {
      type: "stats",
      tone: "paper",
      eyebrow: "What to expect",
      heading: "Quick, and kept small",
      items: [
        { value: "1 day", label: "Usually, for a person at KIASA to approve your request." },
        { value: "0", label: "People at KIASA who can read your password: it is kept only in scrambled form." },
        { value: "1 click", label: "To delete your account and everything in it." },
        { value: "0", label: "Addresses passed to anyone outside KIASA." },
      ],
    },
    {
      type: "accordion",
      eyebrow: "Questions",
      heading: "Common questions",
      items: [
        {
          title: "Do I need an account to read your research?",
          body: ["No. Every report, perspective and client story on this site is open to everyone. An account only keeps your place: what you saved, and what you asked to hear about."],
          link: { label: "What we think", href: "/insights" },
        },
        {
          title: "Why does a person approve each account?",
          body: ["Because a client's reports must reach only the people they are meant for. A person checks every request, connects clients to their team, and turns away anything automated. It usually takes less than one working day, and we tell you either way."],
        },
        {
          title: "How will I know I am approved?",
          body: ["After you ask, you land on your request page. It shows where your request stands, turns into your account the moment a person at KIASA approves it, and can ask your computer to tell you. If you have left by then, sign in later and you are welcomed to your account."],
          link: { label: "Sign in", href: "/sign-in" },
        },
        {
          title: "I am a client. What will I see?",
          body: ["Ask with your work email. Once we approve you, your account shows the monthly KIASA Canopy report for the platforms we run for you, your service handbook and the people on your team."],
          link: { label: "KIASA Canopy", href: "/canopy" },
        },
        {
          title: "I forgot my password.",
          body: ["Write to us from the address you signed up with, and a person will help you set a new one."],
          link: { label: "Contact us", href: "/contact" },
        },
        {
          title: "How do I delete my account?",
          body: ["In one click from your account, or by writing to privacy@kiasa.tech. Your details, saved reading and topics are deleted at once; we keep only a note of your address, so that we never write to you again."],
          link: { label: "Privacy statement", href: "/privacy" },
        },
      ],
    },
    {
      type: "cta",
      heading: "Rather talk to a person?",
      text: "Tell us what you are working on. A partner will reply within two working days.",
      cta: { label: "Contact us", href: "/contact" },
      secondary: { label: "Only the emails, no account", href: "/preferences" },
    },
  ],
};

export const accountPages: PageDoc[] = [signUp];
