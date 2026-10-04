import type { LinksBlock, PageDoc } from "../blocks";
import { navigation, voice } from "../site";

/**
 * SAMPLE CONTENT: the "What we do" hub, after the model's services index: a
 * photograph and a promise, a statement, every capability and industry, the
 * numbers, how we engage, client work, a quotation, what we think, a closing call.
 */

/** Every capability and industry, straight from the navigation so the two never drift apart. */
const groups: LinksBlock["groups"] = (navigation.find(item => item.id === "what-we-do")?.groups ?? []).map(group => ({
  label: group.label,
  links: group.links.map(link => ({ title: link.label, href: link.href, summary: link.summary })),
}));

export const whatWeDoPages: PageDoc[] = [
  {
    href: "/what-we-do",
    title: "What we do",
    section: "KIASA",
    summary: "The work we take on, and the industries we know best.",
    blocks: [
      {
        type: "hero",
        variant: "photo",
        eyebrow: "What we do",
        title: "Built to keep working, years after launch",
        lead: "We design, build and run digital systems alongside the people who will own them.",
        body: [
          "Fourteen capabilities, from the first strategy conversation to the night shift, and twelve industries we know from the inside.",
          "Small senior teams, short cycles, and a plan for handing over from the first week.",
        ],
        cta: { label: "Talk to us", href: "/contact" },
        image: "forest-canopy",
      },
      {
        type: "intro",
        eyebrow: "Our approach",
        text: "Most technology programs fail quietly, after the launch, when the people who built a system leave and the people who run it inherit something they do not understand. We work the other way round: your people build with us, and the system is still working, and still changing, years later.",
        body: [
          "We take on fewer, longer engagements. Most of our clients started with one problem and stayed because the first piece of work kept paying off.",
          "We are independent. We do not resell software and we are owned by the people who work here, so our advice answers to you and nobody else.",
        ],
        cta: { label: "How we work", href: "/about/how-we-work" },
      },
      {
        type: "links",
        eyebrow: "Capabilities and industries",
        heading: "Find the work that fits",
        intro: "What we do, and the industries where we have done it most. Each page shows the services, the client work and the people to talk to.",
        groups,
      },
      {
        type: "stats",
        tone: "paper",
        eyebrow: "By the numbers",
        heading: "A partner clients keep",
        items: [
          { value: "9 in 10", label: "of the clients we worked with in 2023 are still working with us today." },
          { value: "94%", label: "of our clients say they would recommend KIASA to a peer." },
          { value: "8 in 10", label: "systems we have built are run day to day by the client's own team within a year of launch." },
          { value: "61%", label: "of the average technology budget goes on keeping existing systems running. We help clients spend less of it." },
        ],
        source: "KIASA client survey, 2026; KIASA program records; The maintenance dividend, KIASA research, 2026.",
      },
      {
        type: "features",
        eyebrow: "How we engage",
        heading: "From the first question to the last handover",
        intro: "Clients come to us at different points. Most stay for more than one.",
        numbered: true,
        items: [
          { title: "Decide", text: "Clear technology choices, costed and sequenced, before anything is built. Usually six weeks.", link: { label: "Strategy and Advisory", href: "/what-we-do/capabilities/strategy-and-advisory" } },
          { title: "Build", text: "One small, senior team from first prototype to steady release, with your people in it from day one.", link: { label: "Digital Product Engineering", href: "/what-we-do/capabilities/digital-product-engineering" } },
          { title: "Run", text: "A named, standing team that keeps systems running, secure and improving, and reports back in plain language.", link: { label: "Managed Services", href: "/what-we-do/capabilities/managed-services" } },
          { title: "Hand over", text: "Training and coaching so your own teams can run and extend what we built together, planned from the first week.", link: { label: "Workforce Enablement", href: "/what-we-do/capabilities/workforce-enablement" } },
        ],
      },
      {
        type: "media",
        eyebrow: "Client work",
        heading: "Our work in action",
        intro: "How the systems we helped build are working today, told by the people who run them.",
        items: [
          { image: "forest-path", eyebrow: "Insurance", title: "How Halden Mutual settles claims in two days, not nine", text: "A 90-year-old insurer replaced its claims core without a freeze, one product line at a time.", href: "/client-stories/halden-mutual", cta: "Read the case study" },
          { image: "light-trails", eyebrow: "Logistics", title: "Osprey Freight plans 4,000 routes a night on one platform", text: "Eleven planning teams, one platform, and a routing model dispatchers trust.", href: "/client-stories/osprey-freight", cta: "Read the case study" },
          { image: "tablet-hand", eyebrow: "Healthcare", title: "Tessera Health brings 38 clinics onto a single patient record", text: "One record, one booking flow and a team of its own to run them.", href: "/client-stories/tessera-health", cta: "Read the case study" },
          { image: "wind-road", eyebrow: "Energy and utilities", title: "Varda Energy reads two million meters without a mainframe", text: "Thirty years of billing logic moved to the cloud in four planned waves.", href: "/client-stories/varda-energy", cta: "Read the case study" },
        ],
      },
      {
        type: "quote",
        text: voice.quote,
        name: voice.name,
        role: voice.role,
        image: "leaf-dew",
      },
      {
        type: "cards",
        eyebrow: "What we think",
        heading: "Research and perspectives from our work",
        cta: { label: "See all insights", href: "/insights" },
        items: [
          { kind: "Research report", title: "The maintenance dividend", summary: "We asked 140 engineering leaders where their budgets go. On average, 61% is spent keeping existing systems running.", href: "/insights/the-maintenance-dividend", art: "leaf-drops", surface: "photo" },
          { kind: "Perspective", title: "Why the second year of a cloud migration matters more than the first", summary: "The move itself is the easy part. Costs, habits and ownership settle in year two.", href: "/insights/second-year-of-a-cloud-migration", art: "strata" },
          { kind: "Research report", title: "AI in the back office: where the first real savings are showing up", summary: "Across 60 finance, claims and supply teams, the returns so far come from four unglamorous tasks.", href: "/insights/ai-in-the-back-office", art: "matrix" },
          { kind: "Research report", title: "Platform pulse: what engineering leaders will fund in 2027", summary: "Our annual survey of 320 technology leaders shows where the money moves next year.", href: "/insights/platform-pulse-2027", art: "pulse", surface: "night" },
        ],
      },
      {
        type: "cta",
        heading: "Get a clear view of what's next",
        text: "Tell us what you are working on. A partner will reply within two working days.",
        cta: { label: "Contact us", href: "/contact" },
        secondary: { label: "See our client stories", href: "/client-stories" },
        image: "hiker-valley",
      },
    ],
  },
];
