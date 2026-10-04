import type { CardItem, ContactsBlock, CtaBlock, NewsBlock, PageDoc, ProseItem, SplitBlock, StatsBlock } from "../blocks";
import { news } from "../site";

/** The newsroom: its front page, media relations and the seven news releases.
 * SAMPLE CONTENT, like the rest of the site: every person, client, figure and
 * quotation here is invented for the design review. */

type PhotoKey = SplitBlock["image"];

/** The press office, the same on every page of the newsroom. */
const pressContacts: ContactsBlock = {
  type: "contacts",
  heading: "Media contacts",
  intro: "Our press office answers every request the same working day. For anything urgent outside office hours, call the global number.",
  items: [
    { name: "Hannah Lindqvist", role: "Head of Communications", email: "press@kiasa.tech", phone: "+44 20 3870 4410" },
    { name: "Marcus Bell", role: "Media Relations, North America", email: "press.americas@kiasa.tech", phone: "+1 416 555 0148" },
    { name: "Nicole Ong", role: "Media Relations, Asia Pacific", email: "press.apac@kiasa.tech", phone: "+65 6812 4470" },
  ],
};

/** The paragraph at the foot of every release. */
const boilerplate =
  "KIASA is an independent technology consultancy. We design, build and run digital systems alongside the people who will own them, for clients in insurance, energy, healthcare, logistics, the public sector and other industries. Founded in London in 2012 and owned by the people who work in it through its partners and an employee ownership trust, KIASA has 420 people in eight studios across Europe and Africa, North America and Asia Pacific. Visit kiasa.tech to learn more.";

const kindOf: Record<string, string> = {
  "/newsroom/kiasa-launches-canopy": "Announcement",
  "/newsroom/halden-mutual-partnership": "Client news",
  "/newsroom/managed-services-security-audit": "Announcement",
  "/newsroom/maintenance-dividend-research": "Research",
  "/newsroom/chief-delivery-officer": "Appointment",
  "/newsroom/first-sustainability-report": "Sustainability",
  "/newsroom/second-engineering-studio": "Studios",
};

const releases = news.items.map(item => ({ ...item, kind: kindOf[item.href] ?? "News release" }));

/** Three other releases, newest first. */
const moreNews = (href: string): NewsBlock => ({
  type: "news",
  eyebrow: "Newsroom",
  heading: "More news from KIASA",
  items: releases.filter(item => item.href !== href).slice(0, 3),
  cta: { label: "All news", href: "/newsroom" },
});

type Release = {
  href: string;
  title: string;
  /** As written: "September 29, 2026". */
  date: string;
  city: string;
  deck: string;
  image: PhotoKey;
  body: ProseItem[];
  brief: string[];
  stats: Omit<StatsBlock, "type">;
  related: CardItem[];
  cta: Omit<CtaBlock, "type">;
};

const release = (r: Release): PageDoc => ({
  href: r.href,
  title: r.title,
  section: "News",
  summary: r.date,
  blocks: [
    { type: "hero", variant: "article", eyebrow: "News release", title: r.title, lead: r.deck, image: r.image, meta: [r.date, r.city] },
    {
      type: "prose",
      items: [...r.body, { h: "About KIASA" }, { p: boilerplate }],
      aside: { heading: "In brief", points: r.brief },
    },
    { type: "stats", tone: "paper", ...r.stats },
    { type: "cards", eyebrow: "Related", heading: "Read more on this", items: r.related },
    pressContacts,
    moreNews(r.href),
    { type: "cta", ...r.cta },
  ],
});

const newsroom: PageDoc = {
  href: "/newsroom",
  title: "Newsroom",
  section: "Media",
  summary: "Announcements and news from KIASA.",
  blocks: [
    {
      type: "hero",
      variant: "photo",
      eyebrow: "Media",
      title: "Newsroom",
      lead: "Announcements, research and appointments from KIASA, newest first.",
      body: [
        "Every release names a person you can call about it. Journalists can reach our press office any working day and expect an answer the same day.",
      ],
      cta: { label: "Media relations", href: "/newsroom/media-relations" },
      image: "skyline-day",
    },
    {
      type: "intro",
      eyebrow: "On the record",
      text: "This is where KIASA puts its news on the record: new services, client partnerships, research, appointments and the numbers behind our own operations. We publish when something has happened, not when it is about to.",
      body: [
        "Releases go out at 9:00 London time unless a release says otherwise. Each one stays here unedited, and any later correction is noted at the foot of the page.",
        "Client names appear only with the client's written agreement, and every figure we publish has a source we will share on request.",
      ],
      cta: { label: "Get releases by email", href: "/preferences" },
    },
    {
      type: "news",
      eyebrow: "Latest",
      heading: "News releases",
      intro: "Seven releases from the last three months, newest first.",
      items: releases,
    },
    {
      type: "cards",
      eyebrow: "In focus",
      heading: "The stories behind the news",
      intro: "The service, the research, the client and the report that this season's releases were about.",
      items: [
        {
          kind: "Announcement",
          title: "KIASA Canopy: a standing team for your cloud platform",
          summary: "Platform engineering, cloud operations, security and a monthly report in plain language, under one team, for a fixed monthly fee.",
          href: "/canopy",
          art: "veins",
          surface: "leaf",
        },
        {
          kind: "Research report",
          title: "The maintenance dividend",
          summary: "140 engineering leaders told us where their budgets go. On average, 61% is spent keeping existing systems running.",
          href: "/insights/the-maintenance-dividend",
          art: "leaf-dew",
        },
        {
          kind: "Case study",
          title: "How Halden Mutual settles claims in two days, not nine",
          summary: "A 90-year-old insurer replaced its claims core one product line at a time, without a freeze.",
          href: "/client-stories/halden-mutual",
          art: "forest-path",
        },
        {
          kind: "Report",
          title: "Our first sustainability report",
          summary: "What our work and our travel emitted in 2025, the targets we have set for 2030, and what we have already changed.",
          href: "/about/sustainability-report",
          art: "rings",
          surface: "paper",
        },
      ],
    },
    {
      type: "stats",
      tone: "paper",
      eyebrow: "KIASA at a glance",
      heading: "The firm in four numbers",
      items: [
        { value: "420", label: "People across engineering, design, data, delivery and advisory." },
        { value: "8", label: "Studios in three regions, from Lisbon to Melbourne, two of them engineering studios." },
        { value: "9 in 10", label: "Clients we worked with in 2023 who are still working with us today." },
        { value: "2012", label: "The year KIASA was founded, in London." },
      ],
      source: "KIASA company records, September 2026.",
    },
    {
      type: "media",
      eyebrow: "From the field",
      heading: "Client stories",
      intro: "What the systems behind our releases are doing now, told by the people who run them.",
      items: [
        { image: "harbour-crane", eyebrow: "Logistics", title: "Osprey Freight plans 4,000 routes a night on one platform", href: "/client-stories/osprey-freight" },
        { image: "tablet-hand", eyebrow: "Healthcare", title: "Tessera Health brings 38 clinics onto a single patient record", href: "/client-stories/tessera-health" },
        { image: "wind-road", eyebrow: "Energy", title: "Varda Energy reads two million meters without a mainframe", href: "/client-stories/varda-energy" },
        { image: "field-tree", eyebrow: "Film series", title: "Grown with KIASA", text: "Short films from the field, hosted by our managing partner.", href: "/client-stories/grown-with-kiasa", cta: "Watch" },
      ],
    },
    pressContacts,
    {
      type: "cta",
      heading: "Get the news as it is published",
      text: "Choose News in the Preference Center and we will send each release the morning it goes out. Nothing else, unless you ask for it.",
      cta: { label: "Subscribe to news", href: "/preferences" },
      secondary: { label: "Email the press office", href: "mailto:press@kiasa.tech" },
      image: "dusk-city",
    },
  ],
};

const mediaRelations: PageDoc = {
  href: "/newsroom/media-relations",
  title: "Media Relations",
  section: "Media",
  summary: "Press contacts, company facts and brand assets.",
  blocks: [
    {
      type: "hero",
      variant: "split",
      eyebrow: "Media",
      title: "Media relations",
      lead: "Press contacts, company facts and brand assets in one place. Our press office answers every request the same working day.",
      cta: { label: "Email the press office", href: "mailto:press@kiasa.tech" },
      image: "camera-hands",
    },
    {
      type: "intro",
      eyebrow: "How we work with journalists",
      text: "We would rather give you a straight answer than a polished one. Ask us about our clients, our numbers or our mistakes, and we will tell you what we can, and say plainly what we cannot.",
      body: [
        "If you want to speak to a client, we will ask them on your behalf and pass on their answer within two working days. We never speak for a client without their agreement.",
        "Every figure we publish has a source. Ask for it and we will send the method and, for research, the full questionnaire and sample.",
      ],
    },
    { ...pressContacts, heading: "Press contacts" },
    {
      type: "stats",
      tone: "paper",
      eyebrow: "Company facts",
      heading: "KIASA in brief",
      items: [
        { value: "2012", label: "Founded in London, to build systems that outlast the project." },
        { value: "420", label: "People, in eight studios across three regions." },
        { value: "100%", label: "Owned by the people who work in it: its partners, and an employee ownership trust." },
        { value: "94%", label: "Of clients say they would recommend KIASA to a peer." },
      ],
      source: "KIASA company records and annual client survey, September 2026.",
    },
    {
      type: "accordion",
      eyebrow: "Fact sheet",
      heading: "What reporters ask us most",
      items: [
        {
          title: "What does KIASA do?",
          body: [
            "KIASA is an independent technology consultancy. We design, build and run digital systems alongside the people who will own them: core platforms, data and AI, cloud foundations, security and the products customers use.",
            "Our work is organized into 14 capabilities and 12 industries. Most engagements are run by small senior teams over 6 to 18 months, with a plan for handing over from the first week.",
          ],
          link: { label: "What we do", href: "/what-we-do" },
        },
        {
          title: "Who owns KIASA?",
          body: [
            "KIASA is owned by its people. Partners hold just under half of the shares; the rest are held for employees through an employee ownership trust that anyone can join after a year at KIASA. There are no outside investors.",
            "Owners share the annual profit equally, whatever their level, and vote on new partners at the annual meeting.",
          ],
          link: { label: "Who we are", href: "/about" },
        },
        {
          title: "Who leads the firm?",
          body: [
            "Elena Marsh is Managing Partner, elected by her peers in 2021. Daniel Okafor is Chief Delivery Officer, responsible for how every engagement is staffed, run and handed over. A board of seven meets monthly and publishes its decisions to everyone in the firm.",
          ],
          link: { label: "Leadership", href: "/about/leadership" },
        },
        {
          title: "Where does KIASA work?",
          body: [
            "From eight studios in three regions: Lisbon, Amsterdam, London and Nairobi in Europe and Africa; Toronto and Austin in North America; Singapore and Melbourne in Asia Pacific. Lisbon and Melbourne are our engineering studios.",
          ],
          link: { label: "Locations", href: "/about/locations" },
        },
        {
          title: "Can I quote your research?",
          body: [
            "Yes. Please attribute it to KIASA and name the report. We can put you in touch with the authors, and send the underlying data for any chart.",
          ],
          link: { label: "What we think", href: "/insights" },
        },
        {
          title: "How do I check a fact before publication?",
          body: [
            "Email the press office with the sentence you want to check. We will confirm or correct it the same working day, and tell you who the source is.",
          ],
        },
      ],
    },
    {
      type: "people",
      eyebrow: "Spokespeople",
      heading: "Who can speak on what",
      intro: "Each of them gives interviews in person, by video or in writing. Ask the press office to arrange it.",
      items: [
        { name: "Elena Marsh", role: "Managing Partner", bio: "The firm's direction, employee ownership, and what mid-size organizations should expect from a technology partner." },
        { name: "Daniel Okafor", role: "Chief Delivery Officer", bio: "How engagements are staffed, run and handed over, and large programs run without a freeze." },
        { name: "Kwame Asante", role: "Partner, Managed Services", bio: "KIASA Canopy, platform operations for mid-size enterprises, and reporting technology to a board." },
        { name: "Aiko Tanaka", role: "Director of Research", bio: "The maintenance dividend, Platform pulse and how technology budgets are spent." },
        { name: "Hiroshi Nakamura", role: "Chief Information Security Officer", bio: "Security debt, independent audits and running secure platforms for clients." },
        { name: "Freya Holm", role: "Lead, Green Software", bio: "KIASA's footprint and targets, and the carbon cost of software." },
      ],
    },
    {
      type: "features",
      eyebrow: "Brand assets",
      heading: "Logos, photographs and boilerplate",
      intro: "Ask the press office for any of these. We send them the same day, with short notes on how to use them.",
      items: [
        { title: "The KIASA mark", text: "The leaf and the wordmark, in light and dark versions, as vector files. Please do not redraw, recolor or crop the leaf.", pattern: "veins", link: { label: "Request the mark", href: "mailto:press@kiasa.tech" } },
        { title: "Leadership photographs", text: "Recent photographs of our spokespeople, cleared for editorial use, with captions and credits.", pattern: "rings", link: { label: "Request photographs", href: "mailto:press@kiasa.tech" } },
        { title: "Studio photography", text: "Our studios and teams at work, photographed with the agreement of everyone shown.", pattern: "contours", link: { label: "Request photography", href: "mailto:press@kiasa.tech" } },
        { title: "Biographies", text: "Short and long biographies of the partnership board and practice leads.", pattern: "branches", link: { label: "See leadership", href: "/about/leadership" } },
        { title: "Boilerplate", text: "The paragraph that closes every release, in English, German and Japanese, updated each quarter.", pattern: "waves", link: { label: "Request boilerplate", href: "mailto:press@kiasa.tech" } },
        { title: "Colors and type", text: "The night green, leaf green and dew blue of our visual language, and the two typefaces we set it in.", pattern: "orbit", link: { label: "Request the guide", href: "mailto:press@kiasa.tech" } },
      ],
    },
    {
      type: "news",
      eyebrow: "Newsroom",
      heading: "Recent releases",
      items: releases.slice(0, 4),
      cta: { label: "All news", href: "/newsroom" },
    },
    {
      type: "cta",
      heading: "Working on a story?",
      text: "Tell us your deadline and what you need. We will find the right person and the right numbers, or tell you quickly that we cannot help.",
      cta: { label: "Email the press office", href: "mailto:press@kiasa.tech" },
      secondary: { label: "Visit the newsroom", href: "/newsroom" },
    },
  ],
};

const canopyLaunch = release({
  href: "/newsroom/kiasa-launches-canopy",
  title: "KIASA launches Canopy, a managed platform team for mid-size enterprises",
  date: "September 29, 2026",
  city: "London",
  deck: "Canopy gives companies without a large engineering department a standing team that runs their cloud platform, keeps it secure and reports back each month in plain language.",
  image: "forest-canopy",
  body: [
    { p: "LONDON, September 29, 2026: KIASA, the independent technology consultancy, today launched KIASA Canopy, a managed platform team for mid-size enterprises. Canopy brings platform engineering, cloud operations, security and plain-language reporting together under one standing team, for a fixed monthly fee." },
    { p: "Many organizations with 500 to 5,000 employees now run platforms as complex as those of much larger firms, with a fraction of the staff. Canopy is built for them: a named team of six to ten engineers who learn a client's platform, run it day to day, and report each month on cost, reliability and risk in language a board can act on." },
    { h: "What Canopy includes" },
    {
      list: [
        "Platform engineering: infrastructure as code, deployment pipelines and the internal tools developers use every day.",
        "Cloud operations: monitoring, incident response around the clock, and capacity and cost management.",
        "Security: patching, access reviews, vulnerability scanning and a recovery plan that is tested every quarter.",
        "Reporting: a monthly review in plain language, with the numbers behind it and a short list of decisions for the client.",
        "Handover: documentation and training, so the client's own people can take back any part of the work when they choose.",
      ],
    },
    { quote: "Mid-size companies have been told to choose between building a platform department they cannot staff and buying a service they cannot see inside. Canopy is a third option: a team that runs the platform as if it were its own, and explains every month what it did and why.", by: "Elena Marsh, Managing Partner, KIASA" },
    { h: "Built on work already running" },
    { p: "Canopy grows out of KIASA's managed services practice, which runs platforms today for clients in insurance, energy, logistics and healthcare. In September the practice completed an independent security audit of its operations, with no exceptions reported." },
    { p: "Two organizations moved their platforms onto Canopy during a pilot that began in April 2026: Marlow Cold Chain, a refrigerated logistics company with 1,800 employees, and Linden Row, an insurance broker with offices in nine cities." },
    { quote: "We had a platform we were proud of and nobody left who wanted to run it at three in the morning. Canopy took that on in six weeks, and the monthly report is the first technology document our board reads from start to finish.", by: "Inês Carvalho, Chief Operating Officer, Marlow Cold Chain" },
    { h: "Availability" },
    { p: "KIASA Canopy is available from today in Europe, North America and Asia Pacific. Each engagement starts with a four-week assessment of the client's platform at a fixed price, after which the client decides whether to continue." },
  ],
  brief: [
    "A standing team of six to ten engineers runs a client's cloud platform day to day.",
    "One fixed monthly fee covers engineering, operations, security and reporting.",
    "A plain-language report each month on cost, reliability and risk.",
    "Every engagement starts with a four-week assessment at a fixed price.",
    "Available now in Europe, North America and Asia Pacific.",
  ],
  stats: {
    eyebrow: "Canopy at launch",
    heading: "One team, accountable every month",
    items: [
      { value: "6 to 10", label: "Engineers in each standing team, named and known to the client." },
      { value: "24/7", label: "Incident response, with a first reply within 15 minutes." },
      { value: "4 weeks", label: "For the fixed-price assessment that starts every engagement." },
      { value: "6 weeks", label: "For the pilot clients to move their platforms onto Canopy." },
    ],
    source: "KIASA Canopy service description and pilot results, September 2026.",
  },
  related: [
    { kind: "Practice", title: "Discover KIASA Canopy", summary: "You own the outcome. We handle the complexity. See how the standing team works.", href: "/canopy", art: "veins", surface: "leaf" },
    { kind: "Capability", title: "Managed Services", summary: "A standing team that runs, secures and improves what has been built.", href: "/what-we-do/capabilities/managed-services", art: "orbit", surface: "paper" },
    { kind: "Perspective", title: "Why the second year of a cloud migration matters more than the first", summary: "Costs, habits and ownership settle in year two, and that is where most of the value is won or lost.", href: "/insights/second-year-of-a-cloud-migration", art: "fog-forest" },
    { kind: "Capability", title: "Cloud and Platform Engineering", summary: "Cloud foundations and internal platforms that make the right way the easy way.", href: "/what-we-do/capabilities/cloud-and-platform-engineering", art: "strata", surface: "night" },
  ],
  cta: {
    heading: "Talk to the Canopy team",
    text: "Tell us about your platform and who runs it today. We will tell you within a week whether Canopy is a fit.",
    cta: { label: "Talk to us", href: "/contact" },
    secondary: { label: "Discover KIASA Canopy", href: "/canopy" },
    image: "hiker-valley",
  },
});

const haldenPartnership = release({
  href: "/newsroom/halden-mutual-partnership",
  title: "KIASA and Halden Mutual extend their partnership through 2030",
  date: "September 22, 2026",
  city: "London",
  deck: "After replacing the insurer's claims core without a freeze, the two organizations will move policy administration onto the same platform, with Halden's own platform team in the lead.",
  image: "arch-bridge",
  body: [
    { p: "LONDON, September 22, 2026: KIASA and Halden Mutual today announced the extension of their partnership through the end of 2030. KIASA will work alongside the insurer's own platform team as it moves policy administration onto the claims platform the two organizations built together." },
    { p: "Between 2023 and 2025, the two teams replaced Halden Mutual's claims core one product line at a time: travel, then motor, then home, then small business. There was no product freeze and no planned downtime, and the old system was switched off in March 2026. A straightforward claim now settles in two days on average, down from nine." },
    { h: "What the extension covers" },
    {
      list: [
        "Policy administration for travel, motor, home and small business insurance, moved onto the same platform as claims, one product line at a time from 2027.",
        "A shared data model for policies and claims, so pricing and underwriting teams work from the same figures.",
        "KIASA engineers working inside Halden Mutual's platform team, which already runs and extends the claims platform, with a smaller KIASA role each year.",
        "An annual independent review of the platform's security and resilience, reported to Halden's board.",
      ],
    },
    { quote: "We did not want a supplier for life. We wanted our claims to be fast and our own people to understand the systems behind them. Both are true now, and that is why we are doing the next part together.", by: "Rafael Duarte, Chief Information Officer, Halden Mutual" },
    { h: "How the work is organized" },
    { p: "The work follows the method that moved claims. Each product line moves on its own, and old and new systems run in parallel for six weeks afterward, with every difference investigated before the old system's share is switched off." },
    { quote: "The claims work proved that a large change can be made in small, safe steps. This next stage is mostly about Halden's team leading and ours stepping back. Success in 2030 looks like them not needing us for the platform at all.", by: "Daniel Okafor, Chief Delivery Officer, KIASA" },
    { h: "About Halden Mutual" },
    { p: "Halden Mutual has insured homes, cars, travelers and small businesses in Northern Europe since 1936. It holds 1.2 million policies across four product lines." },
  ],
  brief: [
    "The partnership is extended through 2030.",
    "Claims now settle in two days on average, down from nine.",
    "Policy administration moves onto the same platform from 2027.",
    "Halden Mutual's own platform team leads the work, with KIASA alongside.",
  ],
  stats: {
    eyebrow: "The work so far",
    heading: "Three years of claims, in numbers",
    items: [
      { value: "2 days", label: "Average time to settle a straightforward claim, down from nine." },
      { value: "0", label: "Weeks of product freeze during the three-year replacement." },
      { value: "35%", label: "Less handler time spent on each claim." },
      { value: "27%", label: "Fewer complaints about claims in 2025 than in 2022." },
    ],
    source: "Halden Mutual claims and complaints data, 2022 to 2026.",
  },
  related: [
    { kind: "Case study", title: "How Halden Mutual settles claims in two days, not nine", summary: "A 90-year-old insurer replaced its claims core without a freeze, one product line at a time.", href: "/client-stories/halden-mutual", art: "forest-path" },
    { kind: "Industry", title: "Insurance", summary: "Policy, claims and underwriting platforms for carriers and brokers.", href: "/what-we-do/industries/insurance", art: "rings", surface: "paper" },
    { kind: "Capability", title: "Application Modernization", summary: "Moving the systems a business depends on to foundations that can change, without stopping the business.", href: "/what-we-do/capabilities/application-modernization", art: "strata", surface: "night" },
    { kind: "Capability", title: "Workforce Enablement", summary: "Training and coaching so your own teams can run and extend what we build together.", href: "/what-we-do/capabilities/workforce-enablement", art: "branches", surface: "leaf" },
  ],
  cta: {
    heading: "Replacing a core system without stopping the business?",
    text: "Tell us what it does today and what it is holding back. A partner will reply within two working days.",
    cta: { label: "Contact us", href: "/contact" },
    secondary: { label: "Read the case study", href: "/client-stories/halden-mutual" },
  },
});

const securityAudit = release({
  href: "/newsroom/managed-services-security-audit",
  title: "KIASA completes an independent security audit of its managed services",
  date: "September 10, 2026",
  city: "London",
  deck: "A twelve-month examination of the controls that protect the platforms KIASA runs for its clients found no exceptions. Clients can read the full report.",
  image: "steel-tower",
  body: [
    { p: "LONDON, September 10, 2026: KIASA today announced that its managed services practice has completed an independent audit of its security controls, covering the twelve months to the end of July 2026. The examination, carried out by Ashgrove Assurance, an independent audit firm, tested 94 controls across the 31 client platforms KIASA runs, and reported no exceptions." },
    { p: "The audit looked at how KIASA's teams operate, not only at what its policies say. Auditors sampled real changes, incidents, access requests and recovery tests from across the year, and checked the evidence behind each one." },
    { h: "What was examined" },
    {
      list: [
        "Access: who can reach client systems, how access is granted and removed, and how often it is reviewed.",
        "Change: how every change to a client platform is proposed, reviewed, tested and recorded.",
        "Incidents: how problems are detected, escalated, resolved and explained to clients afterwards.",
        "Recovery: whether backups can be restored, and how long a full recovery takes in practice.",
        "Suppliers: how the third parties KIASA relies on are chosen, reviewed and monitored.",
      ],
    },
    { quote: "Clients trust us with the systems their business runs on. They should not have to take our word for how we look after them. Now they can read an independent account of it, control by control.", by: "Hiroshi Nakamura, Chief Information Security Officer, KIASA" },
    { h: "What it means for clients" },
    { p: "Clients of KIASA's managed services, including the new KIASA Canopy service, can request the full report under a confidentiality agreement. It will be renewed every year, and future reports will extend the scope to KIASA's own internal systems." },
    { quote: "An audit with no exceptions is a good day, but the real value is in the discipline it takes to get there every single day. We will publish the result each year, whatever it says.", by: "Daniel Okafor, Chief Delivery Officer, KIASA" },
  ],
  brief: [
    "An independent firm examined KIASA's managed services controls over twelve months.",
    "94 controls were tested across 31 client platforms.",
    "No exceptions were reported.",
    "Clients can read the full report under a confidentiality agreement.",
    "The audit will be repeated, and the result published, every year.",
  ],
  stats: {
    eyebrow: "The audit",
    heading: "Twelve months, tested",
    items: [
      { value: "94", label: "Controls tested, from access reviews to full recovery tests." },
      { value: "31", label: "Client platforms in scope, across four industries." },
      { value: "0", label: "Exceptions reported by the auditors." },
      { value: "12 months", label: "Of evidence examined, to the end of July 2026." },
    ],
    source: "Independent audit report on KIASA managed services, September 2026.",
  },
  related: [
    { kind: "Capability", title: "Cybersecurity", summary: "Security designed in from the first sketch, and tested the way an attacker would.", href: "/what-we-do/capabilities/cybersecurity", art: "matrix", surface: "night" },
    { kind: "Research report", title: "Security debt: the quiet risk on the balance sheet", summary: "Unpatched systems behave like unpaid loans: the interest compounds.", href: "/insights/security-debt", art: "bridge-cables" },
    { kind: "Capability", title: "Managed Services", summary: "A standing team that runs, secures and improves what has been built.", href: "/what-we-do/capabilities/managed-services", art: "orbit", surface: "paper" },
    { kind: "Practice", title: "KIASA Canopy", summary: "A standing team that runs your cloud platform, keeps it secure and reports back each month.", href: "/canopy", art: "veins", surface: "leaf" },
  ],
  cta: {
    heading: "Want to read the report?",
    text: "Clients and prospective clients of our managed services can request the full audit report under a confidentiality agreement.",
    cta: { label: "Request the report", href: "/contact" },
    secondary: { label: "Managed Services", href: "/what-we-do/capabilities/managed-services" },
  },
});

const maintenanceResearch = release({
  href: "/newsroom/maintenance-dividend-research",
  title: "New research: engineering leaders spend 61% of their budgets keeping systems running",
  date: "August 27, 2026",
  city: "Toronto",
  deck: "KIASA's study of 140 engineering leaders finds that the top fifth spend half as much on keeping systems running as the average, and reinvest most of the difference in new work.",
  image: "leaf-drops",
  body: [
    { p: "TORONTO, August 27, 2026: Engineering leaders spend, on average, 61% of their budgets keeping existing systems running, according to The maintenance dividend, a report published today by KIASA. The top fifth of organizations spend 31%, half the average, and release changes 2.6 times as often as everyone else." },
    { p: "KIASA interviewed and surveyed 140 engineering leaders at organizations of 500 to 15,000 people, in eight industries and nine countries, between April and June 2026. Where leaders shared budget documents, 58 of the 140, their answers were checked against them." },
    { h: "Key findings" },
    {
      list: [
        "61% of the average engineering budget goes on keeping existing systems running. The bottom fifth spend 78%, leaving little for anything new.",
        "Age explains less than a tenth of the difference in running cost. Systems with no clear owner cost 1.9 times as much to run as owned systems of the same size and age.",
        "Of the organizations that completed a full rewrite in the last five years, 41% now spend more on maintenance than before.",
        "The top fifth reinvest 72% of what they free up in new product work.",
        "Only one leader in five said the split had improved in the last two years.",
      ],
    },
    { quote: "Upkeep is not waste. Some of it is the cost of having systems that work. But most organizations cannot say which part is necessary and which part is habit, and the ones that can are the ones moving fastest.", by: "Aiko Tanaka, Director of Research, KIASA" },
    { h: "What leaders can do now" },
    { p: "The report closes with five steps: measure the split by system using budget data, give every system a named owner, automate the regression tests on the five most-changed systems, shrink releases until a bad one can be rolled back in minutes, and agree in advance where the freed budget will go." },
    { quote: "Every organization we spoke to wanted to spend more on new work. The ones that managed it stopped treating maintenance as a fixed cost and started managing it like any other investment.", by: "Daniel Okafor, Chief Delivery Officer, KIASA, and an author of the report" },
    { h: "Methodology" },
    { p: "The study combined a survey and interviews, conducted between April and June 2026. Respondents held the most senior engineering or technology role in their organization or business unit. Self-reported figures were, on average, four points more optimistic than budget documents. The full method is published in the report." },
  ],
  brief: [
    "KIASA studied 140 engineering leaders in nine countries.",
    "On average, 61% of engineering budgets go on keeping systems running.",
    "The top fifth spend 31%, and release 2.6 times as often.",
    "Ownership, test automation and release size matter far more than age.",
    "41% of full rewrites were followed by higher maintenance costs.",
  ],
  stats: {
    eyebrow: "The maintenance dividend",
    heading: "Where engineering budgets go",
    items: [
      { value: "61%", label: "Average share of the engineering budget spent keeping existing systems running." },
      { value: "31%", label: "The same share for the top fifth of organizations: half the average." },
      { value: "78%", label: "The same share for the bottom fifth." },
      { value: "2.6x", label: "How often the top fifth release changes, compared with everyone else." },
    ],
    source: "KIASA, The maintenance dividend 2026. Survey of 140 engineering leaders, April to June 2026.",
  },
  related: [
    { kind: "Research report", title: "The maintenance dividend", summary: "The full report, with the method, the questionnaire and a plan for paying down upkeep.", href: "/insights/the-maintenance-dividend", art: "leaf-drop" },
    { kind: "Research report", title: "Platform pulse: what engineering leaders will fund in 2027", summary: "Our annual survey of 320 technology leaders shows where the money moves next year.", href: "/insights/platform-pulse-2027", art: "pulse", surface: "night" },
    { kind: "Research report", title: "Security debt: the quiet risk on the balance sheet", summary: "A way to measure the exposure of unpatched systems, and a plan for paying it down.", href: "/insights/security-debt", art: "matrix", surface: "paper" },
    { kind: "Capability", title: "Application Modernization", summary: "Moving the systems a business depends on to foundations that can change.", href: "/what-we-do/capabilities/application-modernization", art: "strata", surface: "leaf" },
  ],
  cta: {
    heading: "How does your budget compare?",
    text: "Read the full report, or ask the authors to walk your leadership team through the findings.",
    cta: { label: "Read the report", href: "/insights/the-maintenance-dividend" },
    secondary: { label: "Talk to the authors", href: "/contact" },
    image: "mountain-lake",
  },
});

const chiefDeliveryOfficer = release({
  href: "/newsroom/chief-delivery-officer",
  title: "KIASA appoints Daniel Okafor as Chief Delivery Officer",
  date: "August 12, 2026",
  city: "London",
  deck: "Okafor, who led KIASA's logistics work, including Osprey Freight, becomes responsible for how every engagement is staffed, run and handed over.",
  image: "glass-roof",
  body: [
    { p: "LONDON, August 12, 2026: KIASA today announced the appointment of Daniel Okafor as Chief Delivery Officer, effective September 1, 2026. He becomes responsible for how every KIASA engagement is staffed, run and handed over, across all eight studios, including the two engineering studios in Lisbon and Melbourne." },
    { p: "Okafor joined KIASA in 2015 as a lead engineer and went on to lead the firm's logistics work. That included the program that moved Osprey Freight's route planning onto one platform, which now plans 4,000 routes a night." },
    { h: "The role" },
    { p: "The Chief Delivery Officer is a new role at KIASA. It brings together responsibilities that were previously held in each region:" },
    {
      list: [
        "One set of delivery standards for every engagement, wherever it is run from.",
        "How teams are staffed, drawing on people from more than one studio where the work needs it.",
        "A written handover plan for every engagement, agreed in its first week.",
        "A quarterly review of every active engagement with the partner responsible for it.",
      ],
    },
    { quote: "Daniel has spent eleven years showing what good delivery looks like, mostly by doing it. Clients trust him because he tells them early when something is wrong. I want every KIASA team to work that way.", by: "Elena Marsh, Managing Partner, KIASA" },
    { quote: "The best compliment a client can pay us is that they no longer need us for the thing we built. My job is to make that the normal outcome, in every studio and on every engagement.", by: "Daniel Okafor, Chief Delivery Officer, KIASA" },
    { h: "Biography" },
    { p: "Daniel Okafor trained as a civil engineer before moving into software. Before KIASA he built logistics and settlement systems for freight operators. He is a mentor in KIASA's graduate program and a trustee of the employee ownership trust." },
  ],
  brief: [
    "Daniel Okafor becomes Chief Delivery Officer on September 1, 2026.",
    "The role is new, bringing staffing, delivery standards and handover under one leader.",
    "He joined KIASA in 2015 and led its logistics work, including Osprey Freight.",
  ],
  stats: {
    eyebrow: "The remit",
    heading: "What the role covers",
    items: [
      { value: "8", label: "Studios working to one set of delivery standards." },
      { value: "2", label: "Engineering studios, in Lisbon and Melbourne." },
      { value: "60+", label: "Active client engagements, each reviewed every quarter." },
      { value: "11 years", label: "At KIASA, from lead engineer to Chief Delivery Officer." },
    ],
    source: "KIASA company records, August 2026.",
  },
  related: [
    { kind: "Our organization", title: "Leadership", summary: "The partners and practice leads responsible for our work.", href: "/about/leadership", art: "branches", surface: "paper" },
    { kind: "Our organization", title: "How We Work", summary: "Small senior teams, short cycles and a plan for handing over from the first week.", href: "/about/how-we-work", art: "light-trails" },
    { kind: "Case study", title: "Osprey Freight plans 4,000 routes a night on one platform", summary: "The logistics program Daniel Okafor led, told by the people who run the platform now.", href: "/client-stories/osprey-freight", art: "harbour-crane" },
    { kind: "Capability", title: "Managed Services", summary: "A standing team that runs, secures and improves what has been built.", href: "/what-we-do/capabilities/managed-services", art: "orbit", surface: "night" },
  ],
  cta: {
    heading: "Meet the people responsible for our work",
    text: "The partners and practice leads who answer for every engagement.",
    cta: { label: "See leadership", href: "/about/leadership" },
    secondary: { label: "Contact us", href: "/contact" },
  },
});

const sustainabilityReport = release({
  href: "/newsroom/first-sustainability-report",
  title: "KIASA publishes its first sustainability report",
  date: "July 30, 2026",
  city: "Amsterdam",
  deck: "The report sets out what KIASA emitted in the year to June 30, 2026, commits to halving emissions per person by 2030, and starts measuring the energy cost of the software it runs for clients.",
  image: "young-leaves",
  body: [
    { p: "AMSTERDAM, July 30, 2026: KIASA today published its first sustainability report, covering the year to June 30, 2026. Measured under the Greenhouse Gas Protocol across all three scopes, and reviewed by an independent assurance provider, it sets a baseline that every later report will be judged against." },
    { p: "KIASA emitted 1,840 tonnes of carbon dioxide equivalent in the year, or 4.4 tonnes per person. Business travel accounted for 62% of the total, nine tenths of it flights. Purchased goods and services, including hardware and cloud, made up 21%; the studios 9%; and commuting and working from home 8%." },
    { h: "Five targets" },
    {
      list: [
        "Halve emissions per person by June 2030, from 4.4 tonnes to 2.2 tonnes, without counting offsets toward the target.",
        "Cut emissions from air travel by 30% by 2028, compared with 2026.",
        "Run every studio on renewable electricity by the end of 2027. Six of eight buy it directly today.",
        "Report an energy and carbon measure for 25 client platforms by the end of 2027.",
        "Place 80% of supplier spend with suppliers who publish their own targets, by 2028.",
      ],
    },
    { quote: "We spend our days telling clients to measure before they change anything. This report is us taking our own advice, and publishing the numbers whether or not they flatter us.", by: "Elena Marsh, Managing Partner, KIASA" },
    { h: "What changed this year" },
    { p: "Amsterdam and Melbourne moved to renewable electricity contracts. Every flight now needs a written reason, and rail is the default for trips under six hours. Laptops are kept for four years instead of three, and the first six platforms KIASA runs for clients now carry an energy measure in their monthly report." },
    { quote: "Most of our footprint is in the air, and that is a habit, not a technology problem. Most of our influence is in the software we run for clients. This report is honest about the first and starts measuring the second.", by: "Freya Holm, Lead, Green Software, KIASA" },
  ],
  brief: [
    "KIASA's first sustainability report covers the year to June 30, 2026.",
    "Emissions were 1,840 tonnes of carbon dioxide equivalent, 4.4 tonnes per person.",
    "Business travel was 62% of the footprint.",
    "The first target is to halve emissions per person by 2030, without offsets.",
    "Offsets and removal credits are reported separately and never counted toward a target.",
  ],
  stats: {
    eyebrow: "The year to June 30, 2026",
    heading: "What the report measured",
    items: [
      { value: "1,840 t", label: "Of carbon dioxide equivalent emitted across scopes 1, 2 and 3." },
      { value: "4.4 t", label: "Per person, the baseline for every target." },
      { value: "62%", label: "Of emissions came from business travel, most of it by air." },
      { value: "81%", label: "Of the electricity used in our studios came from renewable sources." },
    ],
    source: "KIASA Sustainability Report 2026. Measured under the Greenhouse Gas Protocol; method and figures reviewed by an independent assurance provider.",
  },
  related: [
    { kind: "Report", title: "Sustainability Report", summary: "Our footprint, our targets and what we did about both this year.", href: "/about/sustainability-report", art: "rings", surface: "leaf" },
    { kind: "Capability", title: "Green Software", summary: "Measuring and cutting the energy and carbon cost of the software you run.", href: "/what-we-do/capabilities/green-software", art: "veins", surface: "paper" },
    { kind: "Perspective", title: "Green software is mostly just good software", summary: "The code that wastes the least energy is usually the code that is simplest to run.", href: "/insights/green-software-is-good-software", art: "bamboo" },
    { kind: "Industry", title: "Energy and Utilities", summary: "Metering, grid data and customer platforms for the energy transition.", href: "/what-we-do/industries/energy-and-utilities", art: "waves", surface: "night" },
  ],
  cta: {
    heading: "Read the full report",
    text: "Our footprint, our targets and the method behind every number.",
    cta: { label: "Sustainability report", href: "/about/sustainability-report" },
    secondary: { label: "Green Software", href: "/what-we-do/capabilities/green-software" },
    image: "wheat",
  },
});

const secondStudio = release({
  href: "/newsroom/second-engineering-studio",
  title: "KIASA opens a second engineering studio",
  date: "July 16, 2026",
  city: "Melbourne",
  deck: "The Melbourne studio joins Lisbon as KIASA's second engineering studio. Nine hours apart, the two now hand the platforms KIASA runs for clients from one to the other each day.",
  image: "city-haze",
  body: [
    { p: "MELBOURNE, July 16, 2026: KIASA today opened its second engineering studio, at Level 4, 88 Flinders Lane, Melbourne. The studio opens with 35 people and expects to grow to 70 by the end of 2028. It joins KIASA's first engineering studio, in Lisbon, and the firm's studio in Singapore in the Asia Pacific region." },
    { p: "Engineering studios are where KIASA's longer-running work is built and run: managed platforms, quality engineering and the larger modernization programs. Lisbon and Melbourne are nine hours apart. At the end of each working day, one studio hands the platforms it has been watching to the other in a short written handover, read aloud on a call, so nothing is lost overnight and nobody's day is stretched to cover it." },
    { h: "The studio" },
    {
      list: [
        "35 people at opening, in platform engineering, quality engineering, data, design and advisory.",
        "On-call cover for the platforms KIASA runs for clients in Asia Pacific, from the first day.",
        "A software engineering apprenticeship, shared with London, and graduate roles for the September 2027 intake.",
        "A building chosen for its access by public transport, with step-free access throughout and renewable electricity from the first day.",
      ],
    },
    { quote: "Clients in Asia Pacific have asked for an engineering team in their own time zone for years. Melbourne gives them that, and gives Lisbon a partner studio that is at work while it sleeps.", by: "Mei Lin Tan, Partner, Asia Pacific, KIASA" },
    { quote: "We do not use time zones to stretch anyone's day. Engineers in Lisbon and Melbourne work their own hours, and the next studio picks up where they left off. The handover is the craft.", by: "Kwame Asante, Partner, Managed Services, KIASA" },
    { h: "Hiring" },
    { p: "The studio is hiring now, from apprentices and graduates to user researchers and enterprise architects. Every role is listed on KIASA's careers site, and every offer names its level and where it sits in that level's published salary band." },
  ],
  brief: [
    "KIASA's second engineering studio opens in Melbourne.",
    "35 people at opening, growing to 70 by the end of 2028.",
    "Lisbon and Melbourne, nine hours apart, hand client platforms from one to the other each day.",
    "Apprenticeships and graduate roles for 2027 are open now.",
  ],
  stats: {
    eyebrow: "Melbourne",
    heading: "The studio at opening",
    items: [
      { value: "35", label: "People on the first day, in engineering, data, design and advisory." },
      { value: "70", label: "People planned by the end of 2028." },
      { value: "9 hours", label: "Between Lisbon and Melbourne, so one of them is always at work." },
      { value: "23 hours", label: "Of every weekday, at least one KIASA studio is at work." },
    ],
    source: "KIASA, July 2026.",
  },
  related: [
    { kind: "Careers", title: "Search for Jobs", summary: "Every open role, in one place, including those in Melbourne.", href: "/careers/search-for-jobs", art: "matrix", surface: "leaf" },
    { kind: "Careers", title: "Early Careers", summary: "Graduate roles, internships and apprenticeships, in Melbourne and our other studios.", href: "/careers/early-careers", art: "college-lawn" },
    { kind: "Our organization", title: "Locations", summary: "Our studios, and how to reach each of them.", href: "/about/locations", art: "contours", surface: "paper" },
    { kind: "Capability", title: "Managed Services", summary: "A standing team that runs, secures and improves what has been built.", href: "/what-we-do/capabilities/managed-services", art: "pulse", surface: "night" },
  ],
  cta: {
    heading: "Build something that lasts",
    text: "See every open role in Melbourne, Lisbon and our other studios.",
    cta: { label: "Search for jobs", href: "/careers/search-for-jobs" },
    secondary: { label: "Our studios", href: "/about/locations" },
    image: "night-traffic",
  },
});

export const newsroomPages: PageDoc[] = [
  newsroom,
  mediaRelations,
  canopyLaunch,
  haldenPartnership,
  securityAudit,
  maintenanceResearch,
  chiefDeliveryOfficer,
  sustainabilityReport,
  secondStudio,
];
