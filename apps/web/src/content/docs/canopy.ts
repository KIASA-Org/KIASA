import type { PageDoc } from "../blocks";

/** KIASA Canopy, in the form of the model's practice pages (Accenture Construct):
 * hero, the problem, data, what we do differently, capabilities in action, the
 * lifecycle, industries, a closing call. Sample content. */
export const canopyPages: PageDoc[] = [
  {
    href: "/canopy",
    title: "KIASA Canopy",
    section: "Announcement",
    summary: "A standing team that runs your cloud platform, keeps it secure and reports back each month in plain language.",
    practice: {
      name: "KIASA Canopy",
      nav: [
        { label: "Home", href: "/" },
        { label: "Who we are", href: "/about" },
        { label: "Contact us", href: "/contact" },
      ],
    },
    blocks: [
      {
        type: "hero",
        variant: "photo",
        eyebrow: "KIASA Canopy",
        title: "You own the outcome. We handle the complexity.",
        lines: ["You own the outcome.", "We handle the complexity."],
        body: [
          "KIASA Canopy brings platform engineering, cloud operations, security and plain-language reporting together under one standing team, so a mid-size enterprise can run its platform like a large one without building the department to do it.",
          "One team, accountable from your first decision to every month your platform runs.",
        ],
        cta: { label: "Talk to us", href: "/contact" },
        image: "canopy-bridge",
      },
      {
        type: "intro",
        eyebrow: "The problem",
        heading: "Platforms are fragmented. Running them does not have to be.",
        text: "A mid-size enterprise runs on dozens of cloud services, three or four vendors and a handful of people who know how it all fits together. When one of them leaves, or an alert fires at two in the morning, the gaps show. Canopy closes them with one team that owns the whole platform.",
        body: [
          "Most companies of a few hundred to a few thousand people did not set out to run a cloud platform. They moved to the cloud to ship faster, and found themselves responsible for networks, identity, patching, cost and compliance, often with no one whose whole job is to look after it.",
          "Hiring that department takes years and costs more than the platform. Handing it to a large outsourcer means tickets, handoffs and a monthly report nobody reads. Canopy is a third way: a small senior team that knows your platform by name, runs it day to day, and tells you plainly how it is doing.",
        ],
      },
      {
        type: "stats",
        tone: "paper",
        eyebrow: "Data",
        heading: "The cost of running it alone",
        items: [
          { value: "61%", label: "of the average engineering budget goes on keeping existing systems running, not on building anything new." },
          { value: "7 in 10", label: "mid-size companies run their cloud platform with fewer than five dedicated platform engineers." },
          { value: "38%", label: "of technology leaders say their last serious incident was reported by a customer before their own monitoring caught it." },
        ],
        source: "KIASA, The maintenance dividend (140 engineering leaders, 2026) and Platform pulse: what engineering leaders will fund in 2027 (320 technology leaders).",
      },
      {
        type: "features",
        eyebrow: "Our approach",
        heading: "Here's what we do differently",
        intro: "Canopy is not a help desk and not a staffing contract. It is one team that takes responsibility for the platform as a whole, and is measured on how it runs.",
        items: [
          {
            title: "One team, one number to call",
            text: "The same named engineers run your platform every month. They know why it was built the way it was, so an incident starts with a fix, not a briefing.",
            pattern: "orbit",
          },
          {
            title: "Security that is run, not audited once a year",
            text: "Patching, access reviews and vulnerability scans happen on a schedule you can see. Critical fixes go out within 48 hours, and every change is logged.",
            pattern: "veins",
          },
          {
            title: "A monthly report you can read",
            text: "Each month you get two pages in plain language: what ran, what broke, what it cost, what we changed and what we recommend next. No dashboards to decode.",
            pattern: "pulse",
          },
          {
            title: "Built to be handed back",
            text: "Everything we run is documented in your accounts, in your name. If you decide to bring the platform in house, we train your team and step back on a date you choose.",
            pattern: "branches",
          },
        ],
      },
      {
        type: "media",
        eyebrow: "Client stories",
        heading: "Our capabilities in action",
        intro: "Canopy has a new name, but not a new team. These platforms are run today by the people who now make up Canopy.",
        items: [
          {
            image: "rail-tracks",
            eyebrow: "Osprey Freight",
            title: "The platform behind 4,000 routes a night, run by a standing team",
            text: "Overnight planning runs finish before the first trucks leave, and the on-call rota has not missed a morning in two years.",
            href: "/client-stories/osprey-freight",
            cta: "Explore",
          },
          {
            image: "desk-window",
            eyebrow: "Tessera Health",
            title: "38 clinics on one patient record, patched within 48 hours",
            text: "Clinical systems stay available through working hours while security fixes go out on a published schedule.",
            href: "/client-stories/tessera-health",
            cta: "Explore",
          },
          {
            image: "power-lines",
            eyebrow: "Varda Energy",
            title: "Two million meters read every day, with no mainframe to keep alive",
            text: "Cloud costs for meter data fell by a fifth in the first year, reported line by line each month.",
            href: "/client-stories/varda-energy",
            cta: "Explore",
          },
          {
            image: "forest-path",
            eyebrow: "Halden Mutual",
            title: "A claims platform kept running while it was rebuilt",
            text: "Claims now settle in two days instead of nine, on a platform Halden Mutual's own engineers can run alongside ours.",
            href: "/client-stories/halden-mutual",
            cta: "Explore",
          },
        ],
      },
      {
        type: "accordion",
        tone: "paper",
        eyebrow: "How Canopy works",
        heading: "Support across the platform lifecycle",
        intro: "Most clients join Canopy with a platform already running. We start where you are, and the same team stays with you through every phase.",
        items: [
          {
            title: "Assess",
            body: [
              "We read your architecture, accounts, alerts and bills, and talk to the people who run the platform today. You get a written view of what you have, what it costs, where the risks are and what we would change first.",
              "The assessment is priced on its own. You can keep it and walk away.",
            ],
            stat: { value: "4 weeks", label: "to a costed, written view of your platform and its risks." },
            link: { label: "Strategy and Advisory", href: "/what-we-do/capabilities/strategy-and-advisory" },
          },
          {
            title: "Stabilize",
            body: [
              "We bring monitoring, backups, access and patching under one set of runbooks, close the gaps the assessment found, and set up an on-call rota with named engineers.",
              "Nothing is migrated for the sake of it. We change what reduces risk or cost, and leave what works.",
            ],
            stat: { value: "90 days", label: "to bring alerts, backups and patching under one runbook." },
            link: { label: "Cloud and Platform Engineering", href: "/what-we-do/capabilities/cloud-and-platform-engineering" },
          },
          {
            title: "Secure",
            body: [
              "Vulnerability scanning, access reviews and patching run on a schedule you can see. We keep the evidence your auditors and insurers ask for, and walk them through it when they visit.",
              "Our own managed services controls are independently audited every year.",
            ],
            stat: { value: "48 hours", label: "to patch a critical vulnerability, from disclosure to production." },
            link: { label: "Cybersecurity", href: "/what-we-do/capabilities/cybersecurity" },
          },
          {
            title: "Run",
            body: [
              "Our engineers watch the platform around the clock from studios in three regions. When something breaks, the person who picks up already knows your systems.",
              "Every incident gets a short written review: what happened, why, and what we changed so it does not happen again.",
            ],
            stat: { value: "15 min", label: "to a named engineer working on a critical incident, at any hour." },
            link: { label: "Managed Services", href: "/what-we-do/capabilities/managed-services" },
          },
          {
            title: "Improve and report",
            body: [
              "Each month we report in plain language on availability, incidents, security and cost, and recommend the next few improvements with a price beside each one.",
              "You decide what we do next. Savings we find are shown as savings, not absorbed into the fee.",
            ],
            stat: { value: "18%", label: "average cut in cloud spend in a client's first year with our managed platform team." },
            link: { label: "Green Software", href: "/what-we-do/capabilities/green-software" },
          },
        ],
      },
      {
        type: "accordion",
        eyebrow: "Industries",
        heading: "The worlds we've run",
        intro: "Every industry has its own busy hours, regulators and ways to fail. We have run platforms through all of them.",
        items: [
          {
            title: "Insurance",
            body: [
              "Claims and policy platforms that cannot go down during a storm season or a renewal peak, with the audit trails regulators expect.",
              "We help run the platform that lets Halden Mutual settle claims in two days instead of nine.",
            ],
            link: { label: "Insurance", href: "/what-we-do/industries/insurance" },
          },
          {
            title: "Logistics and transport",
            body: [
              "Planning and tracking systems whose busiest hours are overnight, when most support desks are asleep.",
              "Osprey Freight's platform plans 4,000 routes a night, and our on-call engineers are awake when it does.",
            ],
            link: { label: "Logistics and Transport", href: "/what-we-do/industries/logistics-and-transport" },
          },
          {
            title: "Healthcare",
            body: [
              "Patient records and scheduling that clinicians rely on all day, kept patched and available without interrupting care.",
              "Tessera Health's 38 clinics share one patient record that we help keep running and secure.",
            ],
            link: { label: "Healthcare", href: "/what-we-do/industries/healthcare" },
          },
          {
            title: "Energy and utilities",
            body: [
              "Metering and grid data at volume, with costs that have to be justified to a regulator line by line.",
              "Varda Energy reads two million meters on a cloud platform that replaced its mainframe.",
            ],
            link: { label: "Energy and Utilities", href: "/what-we-do/industries/energy-and-utilities" },
          },
          {
            title: "Banking and payments",
            body: [
              "Payment and core banking platforms where every change needs evidence, and an outage is measured in transactions lost.",
              "For regional banks and payment firms, we run the cloud foundations under strict change control and report against what their regulators expect.",
            ],
            link: { label: "Banking and Payments", href: "/what-we-do/industries/banking-and-payments" },
          },
        ],
      },
      {
        type: "cta",
        heading: "Get a clear view of what's next",
        text: "Tell us about your platform. A partner will reply within two working days, and the first conversation is about what you need, not what we sell.",
        cta: { label: "Talk to us", href: "/contact" },
        secondary: { label: "Read the announcement", href: "/newsroom/kiasa-launches-canopy" },
        image: "forest-canopy",
      },
    ],
  },
];
