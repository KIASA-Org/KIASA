/**
 * SAMPLE CONTENT for the design review.
 *
 * Every client, person, figure, award, date and quotation in this file is a
 * placeholder, written so the design can be judged with realistic copy. None of
 * it is a statement about KIASA. Replace it all before the site is public, then
 * set SAMPLE_CONTENT to false to remove the notice in the footer.
 */
export const SAMPLE_CONTENT = true;

export type NavLink = { label: string; href: string; summary?: string };
export type NavGroup = { label: string; links: NavLink[] };
export type NavItem = { id: string; label: string; href: string; summary: string; groups?: NavGroup[] };

const slug = (label: string) => label.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const under = (base: string, entries: [label: string, summary: string][]): NavLink[] =>
  entries.map(([label, summary]) => ({ label, summary, href: `${base}/${slug(label)}` }));

export const company = {
  name: "KIASA",
  tagline: "Where change takes root",
  description: "KIASA is an independent technology consultancy. We design, build and run digital systems alongside the people who will own them.",
};

/** The header. "What we do", "Who we are" and "Careers" open a panel; "What we think" is a plain link. */
export const navigation: NavItem[] = [
  {
    id: "what-we-do",
    label: "What we do",
    href: "/what-we-do",
    summary: "The work we take on, and the industries we know best.",
    groups: [
      {
        label: "Capabilities",
        links: under("/what-we-do/capabilities", [
          ["Application Modernization", "Moving the systems a business depends on to foundations that can change, without stopping the business."],
          ["Artificial Intelligence and Data", "Data platforms people trust, and AI put to work on problems worth solving."],
          ["Cloud and Platform Engineering", "Cloud foundations and internal platforms that make the right way the easy way."],
          ["Cybersecurity", "Security designed in from the first sketch, and tested the way an attacker would."],
          ["Digital Product Engineering", "Products built and shipped by one team, from first prototype to steady release."],
          ["Enterprise Platforms", "ERP, CRM and core platforms configured to fit the business, not the other way round."],
          ["Experience Design", "Research, service design and interfaces that respect the people using them."],
          ["Green Software", "Measuring and cutting the energy and carbon cost of the software you run."],
          ["Integration and APIs", "Connecting the systems you have so data moves once, and correctly."],
          ["Managed Services", "A standing team that runs, secures and improves what has been built."],
          ["Quality Engineering", "Testing built into delivery, so releases are routine rather than events."],
          ["Strategy and Advisory", "Clear technology choices, costed and sequenced, before anything is built."],
          ["Technology Due Diligence", "An independent read on a technology estate before you invest in it."],
          ["Workforce Enablement", "Training and coaching so your own teams can run and extend what we build together."],
        ]),
      },
      {
        label: "Industries",
        links: under("/what-we-do/industries", [
          ["Banking and Payments", "Core modernization, payments and compliance for banks and fintechs."],
          ["Education", "Student systems and learning platforms for universities and schools."],
          ["Energy and Utilities", "Metering, grid data and customer platforms for the energy transition."],
          ["Healthcare", "Patient records, scheduling and clinical systems that staff can rely on."],
          ["Insurance", "Policy, claims and underwriting platforms for carriers and brokers."],
          ["Life Sciences", "Validated systems and research data platforms for regulated work."],
          ["Logistics and Transport", "Planning, tracking and settlement for freight, rail and fleets."],
          ["Manufacturing", "Connected plants, supply planning and the systems between them."],
          ["Public Sector", "Digital services for citizens, built to be maintained for decades."],
          ["Retail and Consumer", "Commerce, pricing and supply systems for retailers and brands."],
          ["Software and Platforms", "Engineering depth for companies whose product is software."],
          ["Telecommunications", "Billing, provisioning and network data for operators."],
        ]),
      },
    ],
  },
  { id: "what-we-think", label: "What we think", href: "/insights", summary: "Research, perspectives and field notes from our work." },
  {
    id: "who-we-are",
    label: "Who we are",
    href: "/about",
    summary: "An independent consultancy, owned by the people who work in it.",
    groups: [
      {
        label: "Our organization",
        links: under("/about", [
          ["How We Work", "Small senior teams, short cycles and a plan for handing over from the first week."],
          ["Leadership", "The partners and practice leads responsible for our work."],
          ["Locations", "Our studios, and how to reach each of them."],
          ["Partners", "The technology companies we build with, and why we chose them."],
          ["Sustainability Report", "Our footprint, our targets and what we did about both this year."],
        ]),
      },
      {
        label: "Awards and rankings",
        links: under("/about", [
          ["Awards and Recognition", "What clients, colleagues and independent bodies have said about our work."],
          ["Industry Analyst Recognition", "How independent analysts rate our services."],
        ]),
      },
      {
        label: "Media",
        links: [
          { label: "Media Relations", href: "/newsroom/media-relations", summary: "Press contacts, company facts and brand assets." },
          { label: "Newsroom", href: "/newsroom", summary: "Announcements and news from KIASA." },
        ],
      },
    ],
  },
  {
    id: "careers",
    label: "Careers",
    href: "/careers",
    summary: "Do the best work of your career, with people who take the craft seriously.",
    groups: [
      {
        label: "Find a job",
        links: under("/careers", [
          ["Search for Jobs", "Every open role, in one place."],
          ["Career Areas", "Engineering, design, data, delivery and advisory."],
          ["Early Careers", "Graduate roles and internships."],
        ]),
      },
      {
        label: "Life at KIASA",
        links: under("/careers", [
          ["Working Here", "What a week at KIASA looks like."],
          ["Benefits", "Pay, leave, health and the practical details."],
          ["Learning and Growth", "Time and budget set aside for getting better at your craft."],
          ["Careers Blog", "Stories from the people who work here."],
        ]),
      },
      {
        label: "How we hire",
        links: under("/careers", [
          ["Hiring Journey", "Each step, from application to offer."],
          ["Interview Tips", "What we look for, and how to prepare."],
        ]),
      },
    ],
  },
];

/** The region menu behind the globe. */
export const regions = [
  { region: "Global", language: "English", current: true },
  { region: "Asia Pacific", language: "English", current: false },
  { region: "Europe", language: "English", current: false },
  { region: "North America", language: "English", current: false },
  { region: "Deutschland", language: "Deutsch", current: false },
  { region: "日本", language: "日本語", current: false },
];

/** Each of these finds something in the pages listed in pages.ts. */
export const popularSearches = ["Cloud migration", "Managed services", "Artificial intelligence", "Case study", "Jobs"];

export const hero = {
  /** Two lines; the second is set in from the first. */
  headline: ["Where change", "takes root"] as const,
  kicker: "Grown, not bolted on",
  body: "Most technology programs fail quietly, after the launch. KIASA designs, builds and runs digital systems alongside the people who will own them, so the change is still working years later.",
  cta: { label: "See what we do", href: "/what-we-do" },
};

export type StoryKind = "Announcement" | "Perspective" | "Research report" | "Case study";
/** How a card is dressed: solid green, light with a drawing, dark with a drawing, or a photograph under pale type. */
export type StorySurface = "leaf" | "paper" | "night" | "photo";
/** A line drawing (see plates.tsx) or a photograph. */
export type StoryArt = "veins" | "strata" | "matrix" | "pulse" | "rings" | "blue-leaf" | "forest-road" | "leaf-tip";
export type Story = {
  id: string;
  kind: StoryKind;
  title: string;
  summary: string;
  /** A date for announcements, a reading time for everything else. */
  detail: string;
  href: string;
  cta: string;
  surface: StorySurface;
  art: StoryArt;
};

/** The eight cards under the hero, in reading order (two rows of four). */
export const stories: Story[] = [
  {
    id: "canopy",
    kind: "Announcement",
    title: "KIASA launches Canopy, a managed platform team for mid-size enterprises",
    summary: "Canopy gives companies without a large engineering department a standing team that runs their cloud platform, keeps it secure and reports back each month in plain language.",
    detail: "September 29, 2026",
    href: "/newsroom/kiasa-launches-canopy",
    cta: "Read the announcement",
    surface: "leaf",
    art: "veins",
  },
  {
    id: "second-year",
    kind: "Perspective",
    title: "Why the second year of a cloud migration matters more than the first",
    summary: "The move itself is the easy part. Costs, habits and ownership settle in year two, and that is where most of the promised value is won or lost.",
    detail: "8 minute read",
    href: "/insights/second-year-of-a-cloud-migration",
    cta: "Read the perspective",
    surface: "paper",
    art: "strata",
  },
  {
    id: "maintenance-dividend",
    kind: "Research report",
    title: "The maintenance dividend",
    summary: "We asked 140 engineering leaders where their budgets go. On average, 61% is spent keeping existing systems running. The best performers spend half that, and reinvest the rest.",
    detail: "32 page report",
    href: "/insights/the-maintenance-dividend",
    cta: "Read the report",
    surface: "photo",
    art: "blue-leaf",
  },
  {
    id: "back-office-ai",
    kind: "Research report",
    title: "AI in the back office: where the first real savings are showing up",
    summary: "Forget the demos. Across 60 finance, claims and supply teams, the returns so far come from four unglamorous tasks. We name them, with numbers.",
    detail: "24 page report",
    href: "/insights/ai-in-the-back-office",
    cta: "Read the report",
    surface: "paper",
    art: "matrix",
  },
  {
    id: "halden-mutual",
    kind: "Case study",
    title: "How Halden Mutual settles claims in two days, not nine",
    summary: "A 90-year-old insurer replaced its claims core without a freeze, one product line at a time. Its customers noticed only that things got faster.",
    detail: "6 minute read",
    href: "/client-stories/halden-mutual",
    cta: "Read the case study",
    surface: "photo",
    art: "forest-road",
  },
  {
    id: "platform-pulse",
    kind: "Research report",
    title: "Platform pulse: what engineering leaders will fund in 2027",
    summary: "Budgets are flat; expectations are not. Our annual survey of 320 technology leaders shows where the money moves next year, and what is being cut to pay for it.",
    detail: "28 page report",
    href: "/insights/platform-pulse-2027",
    cta: "Read the report",
    surface: "night",
    art: "pulse",
  },
  {
    id: "green-software",
    kind: "Perspective",
    title: "Green software is mostly just good software",
    summary: "The code that wastes the least energy is usually the code that is simplest to run. A practical look at carbon as an engineering measure.",
    detail: "7 minute read",
    href: "/insights/green-software-is-good-software",
    cta: "Read the perspective",
    surface: "paper",
    art: "rings",
  },
  {
    id: "security-debt",
    kind: "Research report",
    title: "Security debt: the quiet risk on the balance sheet",
    summary: "Unpatched systems behave like unpaid loans: the interest compounds. A way to measure the exposure, and a plan for paying it down.",
    detail: "20 page report",
    href: "/insights/security-debt",
    cta: "Read the report",
    surface: "photo",
    art: "leaf-tip",
  },
];

export const voice = {
  quote: "A system is finished when the people who run it no longer need us. We plan for that day from the first week.",
  name: "Elena Marsh",
  role: "Managing Partner, KIASA",
  /** Describes the placeholder photograph; replace both together. */
  imageAlt: "A single drop of dew resting on a dark green leaf.",
};

export const spotlight = {
  heading: "Client spotlight",
  film: {
    title: "Grown with KIASA",
    description: "The people who run the systems we helped build tell the story in their own words. A short film series from the field, hosted by our managing partner.",
    cta: { label: "Learn more", href: "/client-stories/grown-with-kiasa" },
    episode: "Episode 3",
    caption: "Varda Energy: the quiet migration",
    duration: "4:12",
    imageAlt: "A road crossing a turquoise river on a small bridge, seen from above a dense forest.",
  },
  stories: [
    { title: "Halden Mutual settles claims in two days, not nine", href: "/client-stories/halden-mutual" },
    { title: "Osprey Freight plans 4,000 routes a night on one platform", href: "/client-stories/osprey-freight" },
    { title: "Tessera Health brings 38 clinics onto a single patient record", href: "/client-stories/tessera-health" },
    { title: "Varda Energy reads two million meters without a mainframe", href: "/client-stories/varda-energy" },
  ],
};

export type RecognitionTone = "leaf" | "dew" | "forest";
export const recognition = {
  heading: "Recognition and awards",
  items: [
    {
      title: "A partner clients keep",
      body: "Nine in ten of the clients we worked with in 2023 are still working with us today, and 94% say they would recommend KIASA to a peer.",
      cta: { label: "See related awards", href: "/about/awards-and-recognition" },
      tone: "leaf" as RecognitionTone,
    },
    {
      title: "A good place to do good work",
      body: "Named one of the best mid-size technology workplaces for the third year running, on the strength of what our own people say about us.",
      cta: { label: "See related awards", href: "/about/awards-and-recognition" },
      tone: "dew" as RecognitionTone,
    },
    {
      title: "A trusted pair of hands",
      body: "Rated a Leader for application modernization services by independent analysts, with the highest score of any firm for delivery.",
      cta: { label: "See related awards", href: "/about/industry-analyst-recognition" },
      tone: "forest" as RecognitionTone,
    },
  ],
};

export const careers = {
  eyebrow: "Careers",
  heading: "Grow alongside people who take the craft seriously",
  body: "Small senior teams, real ownership and time set aside to learn. Come and do work you will still be proud of in ten years.",
  cta: { label: "Join us", href: "/careers" },
  imageAlt: "Three colleagues talking at a long table in a bright studio, seen through the leaves of a plant.",
};

export type NewsItem = { date: string; title: string; href: string };
/** Newest first. Dates are ISO days. */
export const news: { heading: string; items: NewsItem[] } = {
  heading: "KIASA news",
  items: [
    { date: "2026-09-29", title: "KIASA launches Canopy, a managed platform team for mid-size enterprises", href: "/newsroom/kiasa-launches-canopy" },
    { date: "2026-09-22", title: "KIASA and Halden Mutual extend their partnership through 2030", href: "/newsroom/halden-mutual-partnership" },
    { date: "2026-09-10", title: "KIASA completes an independent security audit of its managed services", href: "/newsroom/managed-services-security-audit" },
    { date: "2026-08-27", title: "New research: engineering leaders spend 61% of their budgets keeping systems running", href: "/newsroom/maintenance-dividend-research" },
    { date: "2026-08-12", title: "KIASA appoints Daniel Okafor as Chief Delivery Officer", href: "/newsroom/chief-delivery-officer" },
    { date: "2026-07-30", title: "KIASA publishes its first sustainability report", href: "/newsroom/first-sustainability-report" },
    { date: "2026-07-16", title: "KIASA opens a second engineering studio", href: "/newsroom/second-engineering-studio" },
  ],
};

export const footer = {
  links: [
    { label: "Preference Center", href: "/preferences" },
    { label: "Careers", href: "/careers" },
    { label: "About Us", href: "/about" },
    { label: "Contact Us", href: "/contact" },
    { label: "Locations", href: "/about/locations" },
    { label: "Sitemap", href: "/sitemap" },
    { label: "Privacy Statement", href: "/privacy" },
    { label: "Terms & Conditions", href: "/terms" },
    { label: "Cookie Policy/Settings", href: "/cookies" },
    { label: "Accessibility Statement", href: "/accessibility" },
  ] satisfies NavLink[],
  legal: "© 2026 KIASA. All rights reserved.",
  sampleNotice: "Sample content: the names, figures, clients and awards on this page are placeholders for the design review.",
};
