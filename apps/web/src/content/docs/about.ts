import type { PageDoc } from "../blocks";

/** Who we are: the hub and its seven pages. Sample content, like the rest of the site. */
export const aboutPages: PageDoc[] = [
  // ─── Who we are ──────────────────────────────────────────────────────────
  {
    href: "/about",
    title: "Who we are",
    section: "KIASA",
    summary: "An independent consultancy, owned by the people who work in it.",
    blocks: [
      {
        type: "hero",
        variant: "photo",
        eyebrow: "Who we are",
        title: "Independent, and owned by the people who work here",
        lead: "KIASA is an independent technology consultancy. We design, build and run digital systems alongside the people who will own them.",
        body: [
          "We have no parent company, no outside shareholders and nothing to resell. The firm belongs to the people who work in it, so the only thing we answer to is whether the work holds up.",
        ],
        cta: { label: "See how we work", href: "/about/how-we-work" },
        image: "forest-canopy",
      },
      {
        type: "intro",
        eyebrow: "Our purpose",
        heading: "Where change takes root",
        text: "Most technology programs fail quietly, after the launch. We exist to make change last: systems that the people who run them understand, can afford and can keep improving long after our team has moved on to the next piece of work.",
        body: [
          "Since 2012 we have worked with mid-size organizations in insurance, logistics, healthcare, energy and the public sector. They are large enough for their systems to be complicated, and small enough that every decision about them matters.",
          "We take on fewer clients than we could, and stay with them longer. Most of our work comes from organizations we have worked with before, or from people who moved there from one.",
        ],
        cta: { label: "What we do", href: "/what-we-do" },
      },
      {
        type: "stats",
        tone: "paper",
        eyebrow: "KIASA in numbers",
        heading: "A firm built to stay",
        items: [
          { value: "420", label: "people across engineering, design, data, delivery and advisory." },
          { value: "8", label: "studios in three regions, from Lisbon to Melbourne." },
          { value: "9 in 10", label: "of the clients we worked with in 2023 are still working with us today." },
          { value: "94%", label: "of clients say they would recommend KIASA to a peer." },
        ],
        source: "KIASA client survey, June 2026. Headcount as of September 30, 2026.",
      },
      {
        type: "features",
        eyebrow: "Our values",
        heading: "What we hold to",
        intro: "Six commitments we make to every client, and hold each other to inside the firm.",
        items: [
          {
            title: "Plan the handover from the first week",
            text: "Every engagement has a date when your team runs the system without us. We write it down at the start and plan back from it.",
            pattern: "branches",
          },
          {
            title: "Small, senior teams",
            text: "Fewer people, each of whom has done this before. The partner who agrees the work stays on it until it is done.",
            pattern: "rings",
          },
          {
            title: "Say what it costs",
            text: "Fixed prices where we can, honest ranges where we cannot, and no surprises in the running costs a year later.",
            pattern: "pulse",
          },
          {
            title: "Build it to be run",
            text: "We judge a system by its second year: how it is monitored, patched, paid for and changed, not by how the launch went.",
            pattern: "strata",
          },
          {
            title: "Independent advice",
            text: "We take no referral fees or resale margins from any vendor, so a recommendation is only ever about what fits.",
            pattern: "contours",
          },
          {
            title: "Leave things better",
            text: "We measure the energy and carbon cost of what we build and run, and treat waste as a defect to be fixed.",
            pattern: "veins",
          },
        ],
      },
      {
        type: "split",
        eyebrow: "How we work",
        heading: "Small teams, short cycles and a plan for handing over",
        body: [
          "A typical KIASA team is six or seven people, working alongside yours in two-week cycles. You see working software at every review, and your engineers write code with ours from the first sprint.",
          "By the time we leave, the people who will run the system have already been running it for months. That is the measure we hold ourselves to.",
        ],
        cta: { label: "How we work", href: "/about/how-we-work" },
        image: "design-table",
        side: "right",
      },
      {
        type: "people",
        eyebrow: "Leadership",
        heading: "The partners responsible for our work",
        intro: "KIASA is run by partners elected by their peers. Each still leads client work.",
        items: [
          { name: "Elena Marsh", role: "Managing Partner", bio: "Leads the firm and its largest insurance and public sector clients. Joined KIASA as an engineer in 2013." },
          { name: "Daniel Okafor", role: "Chief Delivery Officer", bio: "Responsible for how every engagement is staffed, run and handed over. Appointed in August 2026." },
          { name: "Tomás Ferreira", role: "Chief Technology Officer", bio: "Sets the engineering standards our teams work to, from architecture reviews to on-call practice." },
          { name: "Priya Raman", role: "Chief Financial Officer", bio: "Looks after the firm's finances, its employee ownership trust and how we price our work." },
        ],
      },
      {
        type: "media",
        eyebrow: "More about KIASA",
        heading: "Explore who we are",
        items: [
          {
            image: "city-overlook",
            eyebrow: "Locations",
            title: "Eight studios in three regions",
            text: "Where to find us, and how to reach each studio.",
            href: "/about/locations",
            cta: "Explore",
          },
          {
            image: "glass-roof",
            eyebrow: "Partners",
            title: "The platforms we build on, and why",
            text: "A short list we know deeply, chosen without referral fees.",
            href: "/about/partners",
            cta: "Explore",
          },
          {
            image: "wind-road",
            eyebrow: "Sustainability",
            title: "Our first sustainability report",
            text: "Our footprint, our targets and what we did about both this year.",
            href: "/about/sustainability-report",
            cta: "Explore",
          },
          {
            image: "field-tree",
            eyebrow: "Awards and recognition",
            title: "What others say about our work",
            text: "From clients, colleagues and independent bodies.",
            href: "/about/awards-and-recognition",
            cta: "Explore",
          },
        ],
      },
      {
        type: "news",
        eyebrow: "Newsroom",
        heading: "KIASA news",
        items: [
          { date: "2026-09-29", title: "KIASA launches Canopy, a managed platform team for mid-size enterprises", href: "/newsroom/kiasa-launches-canopy", kind: "Announcement" },
          { date: "2026-09-22", title: "KIASA and Halden Mutual extend their partnership through 2030", href: "/newsroom/halden-mutual-partnership", kind: "News release" },
          { date: "2026-09-10", title: "KIASA completes an independent security audit of its managed services", href: "/newsroom/managed-services-security-audit", kind: "News release" },
          { date: "2026-08-12", title: "KIASA appoints Daniel Okafor as Chief Delivery Officer", href: "/newsroom/chief-delivery-officer", kind: "News release" },
          { date: "2026-07-30", title: "KIASA publishes its first sustainability report", href: "/newsroom/first-sustainability-report", kind: "News release" },
        ],
        cta: { label: "Visit the newsroom", href: "/newsroom" },
      },
      {
        type: "cta",
        heading: "Work with us, or work for us",
        text: "Tell us what you are working on and a partner will reply within two working days. Or see the roles open in our studios today.",
        cta: { label: "Contact us", href: "/contact" },
        secondary: { label: "Explore careers", href: "/careers" },
        image: "misty-valley",
      },
    ],
  },

  // ─── How we work ─────────────────────────────────────────────────────────
  {
    href: "/about/how-we-work",
    title: "How We Work",
    section: "Our organization",
    summary: "Small senior teams, short cycles and a plan for handing over from the first week.",
    blocks: [
      {
        type: "hero",
        variant: "split",
        eyebrow: "How we work",
        title: "Small senior teams, short cycles, a planned handover",
        lead: "We work the same way on a six-week assessment as on a three-year rebuild, and we plan for the day you no longer need us from the first week.",
        cta: { label: "Talk to us", href: "/contact" },
        image: "laptop-notebook",
      },
      {
        type: "intro",
        eyebrow: "Our approach",
        text: "A small team of people who have done it before, working in short cycles alongside yours, with a written plan for the day you run the system without us. That is the whole method. The rest is discipline in keeping to it.",
        body: [
          "We do not hand you a slide deck and leave, and we do not keep fifty people on site for years. Our teams are senior, so they are small, and they stay close to the people who will inherit the work.",
          "Every engagement starts with a measure of success that someone outside technology can check, and ends when it has been met.",
        ],
      },
      {
        type: "steps",
        eyebrow: "The shape of an engagement",
        heading: "How an engagement runs",
        intro: "Most of our work follows five steps. Some clients join at the first, others at the fourth.",
        items: [
          { title: "Understand", text: "Two to four weeks reading the code, the bills and the incident log, and talking to the people who run the system today. We agree one measure of success." },
          { title: "Plan and price", text: "A costed sequence of work, smallest valuable step first. Each phase has a fixed price or an honest range, and a date." },
          { title: "Build in short cycles", text: "Two-week cycles with working software at every review. Your engineers pair with ours and own parts of the system from the start." },
          { title: "Hand over", text: "Runbooks, training and a period where your team is on call with ours beside them, then on their own, on a date set in the first month." },
          { title: "Run or step back", text: "Your team runs the system, or we stay on as a standing team through Managed Services or KIASA Canopy. You choose." },
        ],
      },
      {
        type: "features",
        tone: "paper",
        eyebrow: "Our commitments",
        heading: "What you can expect from us",
        numbered: true,
        items: [
          { title: "The partner stays", text: "The partner who agrees the work is in the reviews and on the phone until it is done, not only at the pitch." },
          { title: "Your people in the team", text: "We plan for your engineers, designers and analysts to work in the team, not to receive its output at the end." },
          { title: "A working demo every two weeks", text: "Progress is shown, never reported. If there is nothing to show, you will hear why the same day." },
          { title: "Costs in the open", text: "You see what we spend, and the running costs of what we build, before you are asked to approve them." },
          { title: "Nothing proprietary", text: "Everything we write lives in your repositories, your accounts and your documentation, from the first commit." },
          { title: "A date for the handover", text: "We set it in the first month, report against it every cycle, and say early if it needs to move." },
        ],
      },
      {
        type: "stats",
        eyebrow: "In practice",
        heading: "What this looks like in the numbers",
        items: [
          { value: "7", label: "people on an average KIASA engagement team." },
          { value: "2 weeks", label: "between working demonstrations, on every engagement." },
          { value: "83%", label: "of handovers completed on or before the date set in the first month." },
          { value: "9 in 10", label: "of the clients we worked with in 2023 are still working with us today." },
        ],
        source: "KIASA delivery records, engagements completed July 2025 to June 2026; client survey, June 2026.",
      },
      {
        type: "quote",
        text: "They put our people in the team from the first week. By the time the last product line moved, our own engineers were the ones explaining the new claims platform to the auditors.",
        name: "Joanna Kowalczyk",
        role: "Head of Claims Technology, Halden Mutual",
        image: "workbench",
      },
      {
        type: "accordion",
        eyebrow: "FAQ",
        heading: "Questions clients ask",
        items: [
          {
            title: "How big is a typical team?",
            body: [
              "Between four and nine people, most often six or seven. We would rather add a cycle than add people: smaller teams make fewer handoffs and fewer mistakes.",
            ],
          },
          {
            title: "Do you work on fixed prices?",
            body: [
              "For assessments and well-understood phases, yes. Where the work cannot be known in advance, we give an honest range and report against it every two weeks, so a change in cost is never a surprise.",
            ],
          },
          {
            title: "Can our own engineers join the team?",
            body: [
              "We plan for it. Most of our teams are mixed from the first sprint, and the handover is far easier when your people wrote part of the system.",
            ],
            link: { label: "Workforce Enablement", href: "/what-we-do/capabilities/workforce-enablement" },
          },
          {
            title: "What happens after the handover?",
            body: [
              "Most clients run the system themselves, and call us for the next piece of work. Some prefer a standing team to run, secure and improve it. We offer both.",
            ],
            link: { label: "Managed Services", href: "/what-we-do/capabilities/managed-services" },
          },
          {
            title: "Where does the work happen?",
            body: [
              "Mostly from our studios, with the team on your site for the moments that need it: discovery, key reviews and the handover. Every studio can draw on people from the others.",
            ],
            link: { label: "Our locations", href: "/about/locations" },
          },
        ],
      },
      {
        type: "media",
        eyebrow: "Client stories",
        heading: "See it in the work",
        items: [
          {
            image: "forest-path",
            eyebrow: "Insurance",
            title: "How Halden Mutual settles claims in two days, not nine",
            href: "/client-stories/halden-mutual",
            cta: "Explore",
          },
          {
            image: "interchange",
            eyebrow: "Logistics",
            title: "Osprey Freight plans 4,000 routes a night on one platform",
            href: "/client-stories/osprey-freight",
            cta: "Explore",
          },
          {
            image: "bright-room",
            eyebrow: "Healthcare",
            title: "Tessera Health brings 38 clinics onto a single patient record",
            href: "/client-stories/tessera-health",
            cta: "Explore",
          },
          {
            image: "power-lines",
            eyebrow: "Energy",
            title: "Varda Energy reads two million meters without a mainframe",
            href: "/client-stories/varda-energy",
            cta: "Explore",
          },
        ],
      },
      {
        type: "cta",
        heading: "Tell us what you are working on",
        text: "A partner will reply within two working days, with a view on whether we are the right people for it.",
        cta: { label: "Contact us", href: "/contact" },
        secondary: { label: "Meet our leadership", href: "/about/leadership" },
      },
    ],
  },

  // ─── Leadership ──────────────────────────────────────────────────────────
  {
    href: "/about/leadership",
    title: "Leadership",
    section: "Our organization",
    summary: "The partners and practice leads responsible for our work.",
    blocks: [
      {
        type: "hero",
        variant: "plain",
        eyebrow: "Leadership",
        title: "The people responsible for our work",
        lead: "KIASA is run by its partners. Each leads client work as well as part of the firm, and each can be reached directly.",
        pattern: "branches",
      },
      {
        type: "intro",
        text: "Our leaders still do the work. Every partner below is responsible for at least one client engagement, and every practice lead spends most of the week with a delivery team rather than in meetings about one.",
        body: [
          "The firm is owned by its people. Partners hold just under half of the shares; the rest are held for employees through a trust that anyone can join after a year at KIASA.",
          "Partners are elected by their peers for five-year terms, and the managing partner is elected the same way. No one outside the firm has a seat at the table.",
        ],
      },
      {
        type: "people",
        eyebrow: "Executive leadership",
        heading: "Partners",
        items: [
          { name: "Elena Marsh", role: "Managing Partner", bio: "Leads the firm and its largest insurance and public sector clients. Joined as an engineer in 2013, elected managing partner in 2021." },
          { name: "Daniel Okafor", role: "Chief Delivery Officer", bio: "Responsible for how every engagement is staffed, run and handed over. Previously led our logistics work, including Osprey Freight." },
          { name: "Tomás Ferreira", role: "Chief Technology Officer", bio: "Sets the engineering standards our teams work to. Still reviews architecture on two client programs each quarter." },
          { name: "Priya Raman", role: "Chief Financial Officer", bio: "Looks after the firm's finances, its employee ownership trust and how we price our work." },
          { name: "Signe Halvorsen", role: "Chief People Officer", bio: "Leads hiring, learning and the way we grow people into senior roles from within." },
          { name: "Kwame Asante", role: "Partner, Managed Services", bio: "Runs the standing teams that operate client platforms, including KIASA Canopy." },
          { name: "Saskia de Vries", role: "Partner, Europe and Africa", bio: "Leads our studios in Lisbon, Amsterdam, London and Nairobi, and our energy clients." },
          { name: "Rafael Ortega", role: "Partner, North America", bio: "Leads our Toronto and Austin studios and our banking and payments work." },
          { name: "Mei Lin Tan", role: "Partner, Asia Pacific", bio: "Leads our Singapore and Melbourne studios and our healthcare clients in the region." },
          { name: "Leila Haddad", role: "Partner, Clients and Growth", bio: "Looks after our longest client relationships and the way we choose new ones." },
          { name: "Hiroshi Nakamura", role: "Chief Information Security Officer", bio: "Responsible for the security of KIASA and of every platform we run on a client's behalf." },
          { name: "Aisha Bello", role: "General Counsel", bio: "Leads legal, risk and contracts, and keeps our terms short enough to read." },
        ],
      },
      {
        type: "quote",
        text: "We are accountable to two groups: the clients who trust us with systems they depend on, and the people who own this firm. Neither is served by work that only looks good at launch.",
        name: "Elena Marsh",
        role: "Managing Partner, KIASA",
        image: "lake-figure",
      },
      {
        type: "people",
        tone: "paper",
        eyebrow: "Practice leads",
        heading: "The leads of our practices",
        intro: "Each practice lead is responsible for the quality of the work in their field, across every studio.",
        items: [
          { name: "Marcus Lindqvist", role: "Lead, Application Modernization", bio: "Has moved more claims and policy cores off mainframes than he will admit to at dinner." },
          { name: "Ananya Iyer", role: "Lead, Artificial Intelligence and Data", bio: "Builds data platforms people trust, and is honest about where AI is not the answer." },
          { name: "Jonas Weber", role: "Lead, Cloud and Platform Engineering", bio: "Designs internal platforms that make the right way the easy way for product teams." },
          { name: "Nadia Petrova", role: "Lead, Cybersecurity", bio: "Runs our security testing and the controls behind our independently audited managed services." },
          { name: "Camila Duarte", role: "Lead, Experience Design", bio: "Leads research and service design, from clinic front desks to freight depots." },
          { name: "Grace Wanjiru", role: "Lead, Managed Services", bio: "Leads the on-call engineers who run client platforms around the clock from three regions." },
          { name: "Freya Holm", role: "Lead, Green Software", bio: "Measures the energy and carbon cost of software, and wrote our first sustainability report." },
          { name: "Samuel Adeyemi", role: "Lead, Strategy and Advisory", bio: "Helps leadership teams make technology choices that are costed and sequenced before anything is built." },
        ],
      },
      {
        type: "split",
        eyebrow: "Governance",
        heading: "How the firm is run",
        body: [
          "A board of seven partners meets monthly and publishes its decisions to everyone in the firm. Two of its seats are held by people elected by staff who are not partners.",
          "Pay bands are published inside the firm, and the gap between the highest and the median salary is capped. Every partner's client work is reviewed by a peer each year, as everyone else's is.",
        ],
        cta: { label: "How we work", href: "/about/how-we-work" },
        image: "vaulted-ceiling",
        side: "left",
      },
      {
        type: "news",
        eyebrow: "Newsroom",
        heading: "Leadership news",
        items: [
          { date: "2026-09-29", title: "KIASA launches Canopy, a managed platform team for mid-size enterprises", href: "/newsroom/kiasa-launches-canopy", kind: "Announcement" },
          { date: "2026-09-22", title: "KIASA and Halden Mutual extend their partnership through 2030", href: "/newsroom/halden-mutual-partnership", kind: "News release" },
          { date: "2026-08-12", title: "KIASA appoints Daniel Okafor as Chief Delivery Officer", href: "/newsroom/chief-delivery-officer", kind: "News release" },
        ],
        cta: { label: "Visit the newsroom", href: "/newsroom" },
      },
      {
        type: "cta",
        heading: "Speak to a partner",
        text: "Tell us what you are working on. The partner closest to it will reply within two working days.",
        cta: { label: "Contact us", href: "/contact" },
        secondary: { label: "Media relations", href: "/newsroom/media-relations" },
      },
    ],
  },

  // ─── Locations ───────────────────────────────────────────────────────────
  {
    href: "/about/locations",
    title: "Locations",
    section: "Our organization",
    summary: "Our studios, and how to reach each of them.",
    blocks: [
      {
        type: "hero",
        variant: "split",
        eyebrow: "Locations",
        title: "Eight studios, three regions, one way of working",
        lead: "We keep our studios small and close to the clients they serve. Here is where to find each of them, and how to get in touch.",
        image: "city-haze",
      },
      {
        type: "intro",
        text: "Each of our studios has between thirty and eighty people: close enough to its clients to be in the room when it matters, and connected to the others so that a team can draw on anyone in the firm.",
        body: [
          "Every studio works the same way, to the same engineering standards, and on the same tools. A team in Lisbon can hand an on-call rota to Toronto at the end of the day without a briefing.",
          "Visitors are welcome by appointment. Write to the studio you would like to visit, or call during local working hours.",
        ],
      },
      {
        type: "locations",
        heading: "Our studios",
        intro: "Grouped by region. Every studio can be reached by phone or email during local working hours.",
        regions: [
          {
            name: "Europe and Africa",
            studios: [
              { city: "Lisbon", country: "Portugal", address: "Rua da Prata 112, 1100-420 Lisboa", phone: "+351 21 340 5120", email: "lisbon@kiasa.tech", image: "cafe-table" },
              { city: "Amsterdam", country: "Netherlands", address: "Keizersgracht 418, 1016 GD Amsterdam", phone: "+31 20 845 3170", email: "amsterdam@kiasa.tech", image: "bridge-night" },
              { city: "London", country: "United Kingdom", address: "41 Great Sutton Street, London EC1V 0DX", phone: "+44 20 3870 4410", email: "london@kiasa.tech", image: "station-roof" },
              { city: "Nairobi", country: "Kenya", address: "14 Riverside Drive, Westlands, Nairobi 00800", phone: "+254 20 765 4300", email: "nairobi@kiasa.tech", image: "field-tree" },
            ],
          },
          {
            name: "North America",
            studios: [
              { city: "Toronto", country: "Canada", address: "320 Adelaide Street West, Suite 600, Toronto, ON M5V 1R1", phone: "+1 416 555 0148", email: "toronto@kiasa.tech", image: "towers-up" },
              { city: "Austin", country: "United States", address: "601 East 5th Street, Floor 3, Austin, TX 78701", phone: "+1 512 555 0172", email: "austin@kiasa.tech", image: "evening-street" },
            ],
          },
          {
            name: "Asia Pacific",
            studios: [
              { city: "Singapore", country: "Singapore", address: "71 Amoy Street, #03-01, Singapore 069891", phone: "+65 6812 4470", email: "singapore@kiasa.tech", image: "skyline-day" },
              { city: "Melbourne", country: "Australia", address: "Level 4, 88 Flinders Lane, Melbourne VIC 3000", phone: "+61 3 9012 5530", email: "melbourne@kiasa.tech", image: "glass-roof" },
            ],
          },
        ],
      },
      {
        type: "stats",
        tone: "paper",
        eyebrow: "Our footprint",
        heading: "Close to clients, around the clock",
        items: [
          { value: "8", label: "studios, none with more than eighty people." },
          { value: "3", label: "regions: Europe and Africa, North America and Asia Pacific." },
          { value: "420", label: "people, most of whom live within an hour of their studio." },
          { value: "23 hours", label: "of every weekday, at least one of our studios is at work." },
        ],
        source: "KIASA, as of September 30, 2026.",
      },
      {
        type: "features",
        eyebrow: "One firm",
        heading: "What every studio shares",
        items: [
          { title: "One way of working", text: "The same engineering standards, review practice and handover plan, wherever the team sits.", pattern: "strata" },
          { title: "Teams across studios", text: "A team is built from the people the work needs, not the people nearest. Most of our engagements draw on two studios or more.", pattern: "orbit" },
          { title: "A room for clients", text: "Every studio has space set aside for clients to work alongside us, for a day or for a month.", pattern: "contours" },
        ],
      },
      {
        type: "split",
        eyebrow: "Following the sun",
        heading: "Handing over at the end of the day, carefully",
        body: [
          "For the platforms we run, studios in three regions mean an engineer is awake when something breaks. Each handover between studios is written, short and read aloud on a call, so nothing is lost overnight.",
          "We do not use time zones to stretch a team's day. Engineers work their own hours, and the next studio picks up.",
        ],
        cta: { label: "Managed Services", href: "/what-we-do/capabilities/managed-services" },
        image: "train-carriage",
        side: "left",
      },
      {
        type: "media",
        eyebrow: "Careers",
        heading: "Work in one of our studios",
        items: [
          { image: "cafe-windows", eyebrow: "Careers", title: "Do the best work of your career", href: "/careers", cta: "Explore" },
          { image: "bright-room", eyebrow: "Life at KIASA", title: "What a week at KIASA looks like", href: "/careers/working-here", cta: "Explore" },
          { image: "desk-window", eyebrow: "Open roles", title: "Search every open role, in every studio", href: "/careers/search-for-jobs", cta: "Explore" },
          { image: "college-lawn", eyebrow: "Early careers", title: "Graduate roles and internships", href: "/careers/early-careers", cta: "Explore" },
        ],
      },
      {
        type: "cta",
        heading: "Visit, or write to us",
        text: "Tell us what you are working on and where you are. The nearest studio will reply within two working days.",
        cta: { label: "Contact us", href: "/contact" },
        secondary: { label: "Who we are", href: "/about" },
      },
    ],
  },

  // ─── Partners ────────────────────────────────────────────────────────────
  {
    href: "/about/partners",
    title: "Partners",
    section: "Our organization",
    summary: "The technology companies we build with, and why we chose them.",
    blocks: [
      {
        type: "hero",
        variant: "split",
        eyebrow: "Partners",
        title: "The platforms we build on, and why",
        lead: "We work on a short list of platforms we know deeply, and recommend them only when they fit the problem in front of us.",
        image: "bridge-cables",
      },
      {
        type: "intro",
        text: "We take no referral fees, resale margins or sales targets from any technology vendor. The advice you get from us is the advice we would give ourselves, and sometimes it is to keep what you already have.",
        body: [
          "The platforms below are the ones our teams build on most often. We chose them because they are well documented, widely understood and can be run by your own people after we leave.",
          "The list changes slowly, and only when our own work shows that something has earned a place, or lost one.",
        ],
      },
      {
        type: "logos",
        eyebrow: "Cloud and infrastructure",
        heading: "Where your systems run",
        items: [
          { name: "Amazon Web Services", note: "Cloud infrastructure" },
          { name: "Microsoft Azure", note: "Cloud infrastructure" },
          { name: "Google Cloud", note: "Cloud infrastructure" },
          { name: "Kubernetes", note: "Container orchestration" },
          { name: "Terraform", note: "Infrastructure as code" },
          { name: "OpenTelemetry", note: "Observability" },
          { name: "Grafana", note: "Monitoring" },
          { name: "Linux", note: "Operating system" },
        ],
      },
      {
        type: "logos",
        tone: "paper",
        eyebrow: "Data and enterprise platforms",
        heading: "What your business runs on",
        items: [
          { name: "PostgreSQL", note: "Databases" },
          { name: "Apache Kafka", note: "Event streaming" },
          { name: "Snowflake", note: "Data warehousing" },
          { name: "Databricks", note: "Data and AI" },
          { name: "dbt", note: "Data transformation" },
          { name: "SAP", note: "Enterprise resource planning" },
          { name: "Salesforce", note: "Customer relationships" },
          { name: "ServiceNow", note: "Service management" },
        ],
      },
      {
        type: "features",
        eyebrow: "Our criteria",
        heading: "How we choose what to build on",
        items: [
          { title: "Your people can run it", text: "If your team cannot hire for it, learn it and operate it without us, we do not recommend it.", pattern: "branches" },
          { title: "It is costed for year three", text: "We price the licenses, hosting and people a platform needs once the launch discounts have ended.", pattern: "pulse" },
          { title: "There is a way out", text: "Open formats, exportable data and standard interfaces, so a later change of mind is a project, not a crisis.", pattern: "waves" },
          { title: "It has earned it in our work", text: "A platform joins the list after it has run well for our clients in production, not after a sales briefing.", pattern: "rings" },
        ],
      },
      {
        type: "split",
        eyebrow: "Independence",
        heading: "Independent by design",
        body: [
          "Because we are owned by the people who work here, there is no parent company with a product to place and no investor expecting a share of license revenue.",
          "When a client asks us to compare platforms, we write down the criteria first, share them, and score each option against them in the open. Clients have chosen against our recommendation, and we have built on their choice just as carefully.",
        ],
        cta: { label: "Strategy and Advisory", href: "/what-we-do/capabilities/strategy-and-advisory" },
        image: "bridge-below",
        side: "left",
      },
      {
        type: "accordion",
        eyebrow: "FAQ",
        heading: "Questions about our partners",
        items: [
          {
            title: "Do you resell licenses?",
            body: ["No. You buy licenses and cloud capacity directly from the vendor, in your name. We help you negotiate, but we do not take a margin."],
          },
          {
            title: "Do you hold partner tiers or badges with these vendors?",
            body: [
              "We do not list them here, because a badge says little about the team you will get. Ask us for the specific experience of the people proposed for your work, and we will put you in touch with clients who can speak to it.",
            ],
          },
          {
            title: "Will you work with a platform that is not on this list?",
            body: [
              "Often. Many clients come to us with systems already in place, and our job is to make them work well. We will tell you honestly if we think another team would serve you better.",
            ],
          },
          {
            title: "How do you decide when a platform leaves the list?",
            body: [
              "When it stops meeting the four criteria above for our clients: usually because its costs rose faster than its value, or because it became harder to leave.",
            ],
          },
        ],
      },
      {
        type: "cta",
        heading: "Choosing a platform?",
        text: "Tell us what you need it to do. We will give you an independent view, with the costs written down.",
        cta: { label: "Contact us", href: "/contact" },
        secondary: { label: "Cloud and Platform Engineering", href: "/what-we-do/capabilities/cloud-and-platform-engineering" },
      },
    ],
  },

  // ─── Sustainability report ───────────────────────────────────────────────
  {
    href: "/about/sustainability-report",
    title: "Sustainability Report",
    section: "Our organization",
    summary: "Our footprint, our targets and what we did about both this year.",
    blocks: [
      {
        type: "hero",
        variant: "split",
        eyebrow: "Sustainability report 2026",
        title: "Our footprint, our targets and what we did this year",
        lead: "Our first sustainability report covers the year to June 30, 2026: what KIASA emitted, where it came from, and the targets we have set to bring it down.",
        cta: { label: "Read the announcement", href: "/newsroom/first-sustainability-report" },
        image: "wind-road",
      },
      {
        type: "intro",
        text: "A consultancy's footprint is mostly flights, offices and the computers our work runs on. None of it is large on its own. All of it is ours to measure and reduce, and this year we measured it properly for the first time.",
        body: [
          "We followed the Greenhouse Gas Protocol across all three scopes, and asked an independent assurance provider to review our method and our numbers before we published them.",
          "This is a baseline. Next year's report will be judged against it, by us and by anyone who reads both.",
        ],
      },
      {
        type: "stats",
        tone: "paper",
        eyebrow: "Our footprint",
        heading: "The year to June 30, 2026",
        items: [
          { value: "1,840 t", label: "of carbon dioxide equivalent emitted across scopes 1, 2 and 3." },
          { value: "4.4 t", label: "per person, the baseline for every target below." },
          { value: "62%", label: "of our emissions came from business travel, most of it by air." },
          { value: "81%", label: "of the electricity used in our studios came from renewable sources." },
        ],
        source: "KIASA Sustainability Report 2026. Measured under the Greenhouse Gas Protocol; method and figures reviewed by an independent assurance provider.",
      },
      {
        type: "accordion",
        eyebrow: "Targets",
        heading: "What we have committed to",
        intro: "Five targets, each with a date and a number, reported on every year.",
        items: [
          {
            title: "Halve emissions per person by 2030",
            body: [
              "From 4.4 tonnes per person this year to 2.2 tonnes by June 2030, without counting offsets toward the target.",
              "Most of the reduction has to come from travel. The rest comes from our studios and the hardware we buy.",
            ],
            stat: { value: "2.2 t", label: "per person by 2030, down from 4.4 t today." },
          },
          {
            title: "Fly less, and choose better when we do",
            body: [
              "Every flight now needs a reason written down, and trains are the default for any trip under six hours. We report flights by practice to every partner each quarter.",
            ],
            stat: { value: "30%", label: "less air travel emissions by 2028 than in 2026." },
          },
          {
            title: "Renewable power in every studio",
            body: [
              "Six of our eight studios already buy renewable electricity directly. The other two are moving to suppliers that do when their leases allow, by the end of 2027.",
            ],
            stat: { value: "100%", label: "renewable electricity in every studio by the end of 2027." },
          },
          {
            title: "Measure the software we run for clients",
            body: [
              "The platforms we run for clients use far more energy than our studios. We are adding an energy and carbon measure to the monthly report for each one, so clients can see it and act on it.",
            ],
            stat: { value: "25", label: "client platforms reporting a carbon measure by the end of 2027." },
            link: { label: "Green Software", href: "/what-we-do/capabilities/green-software" },
          },
          {
            title: "Buy from suppliers who report",
            body: [
              "We are asking our largest suppliers to publish their own emissions and targets, and will favor those who do when contracts are renewed.",
            ],
            stat: { value: "80%", label: "of supplier spend with suppliers who publish targets, by 2028." },
          },
        ],
      },
      {
        type: "prose",
        aside: {
          heading: "In brief",
          points: [
            "Our first report, covering the year to June 30, 2026.",
            "1,840 tonnes of carbon dioxide equivalent, or 4.4 tonnes per person.",
            "Business travel is 62% of the total, and the largest thing to change.",
            "Five targets, the first to halve emissions per person by 2030.",
            "Offsets are reported separately and never counted toward a target.",
          ],
        },
        items: [
          { h: "What we measured" },
          { p: "We measured every source we could find: the electricity and heating in our eight studios, business travel, the laptops and screens we buy, the cloud services we use to run the firm, commuting, and the hotels our teams stay in. Where we had to estimate, we say so in the full report, and say how." },
          { h: "Where the emissions come from" },
          { list: [
            "Business travel: 62%, of which flights are nine tenths.",
            "Purchased goods and services, including hardware and cloud: 21%.",
            "Our studios, including electricity and heating: 9%.",
            "Commuting and working from home: 8%.",
          ] },
          { figure: "fog-forest", caption: "Most of our footprint is in the air. The rest is in what we buy and where we work." },
          { h: "What we did this year" },
          { list: [
            "Moved two studios, Amsterdam and Melbourne, to renewable electricity contracts.",
            "Introduced a written reason for every flight, and made rail the default for trips under six hours.",
            "Extended the life of our laptops from three years to four, and sent retired hardware for repair and reuse.",
            "Added an energy measure to the monthly reports of our first six managed platforms.",
          ] },
          { quote: "The biggest number in this report is flights, and that is not a technology problem. It is a habit, and we are changing it one written reason at a time.", by: "Freya Holm, Lead, Green Software" },
          { h: "What we did not do" },
          { p: "We did not buy offsets to call ourselves neutral. We bought a small number of verified removal credits, which we report separately, and we will not count them toward any target." },
          { h: "How we will report from here" },
          { p: "We will publish a report every year, in the same format, with the same method, reviewed by an independent provider. If we change the method, we will restate the earlier years so they can still be compared." },
        ],
      },
      {
        type: "quote",
        text: "We spend our days telling clients to measure before they change anything. This report is us taking our own advice.",
        name: "Elena Marsh",
        role: "Managing Partner, KIASA",
        image: "misty-valley",
      },
      {
        type: "cards",
        eyebrow: "Related",
        heading: "Related reading",
        items: [
          {
            kind: "Perspective",
            title: "Green software is mostly just good software",
            summary: "The code that wastes the least energy is usually the code that is simplest to run.",
            href: "/insights/green-software-is-good-software",
            art: "rings",
          },
          {
            kind: "Capability",
            title: "Green Software",
            summary: "Measuring and cutting the energy and carbon cost of the software you run.",
            href: "/what-we-do/capabilities/green-software",
            art: "veins",
            surface: "leaf",
          },
          {
            kind: "News release",
            title: "KIASA publishes its first sustainability report",
            summary: "The announcement of this report, published on July 30, 2026.",
            href: "/newsroom/first-sustainability-report",
            art: "young-leaves",
          },
          {
            kind: "Who we are",
            title: "Studios close to the clients they serve",
            summary: "Why we keep our studios small and near our clients, and fly less as a result.",
            href: "/about/locations",
            art: "contours",
            surface: "night",
          },
        ],
      },
      {
        type: "cta",
        heading: "Questions about this report?",
        text: "Write to our sustainability team. We will answer, and the best questions will shape next year's report.",
        cta: { label: "Email the sustainability team", href: "mailto:sustainability@kiasa.tech" },
        secondary: { label: "Contact us", href: "/contact" },
      },
    ],
  },

  // ─── Awards and recognition ──────────────────────────────────────────────
  {
    href: "/about/awards-and-recognition",
    title: "Awards and Recognition",
    section: "Awards and rankings",
    summary: "What clients, colleagues and independent bodies have said about our work.",
    blocks: [
      {
        type: "hero",
        variant: "plain",
        eyebrow: "Awards and recognition",
        title: "What others say about our work",
        lead: "The recognition we value most comes from clients who stay and people who join. Independent bodies have noticed too.",
        pattern: "rings",
      },
      {
        type: "intro",
        text: "We enter few awards, and only for work our clients are willing to put their own names to. What follows is a record of what clients, our own people and independent judges have said about KIASA over the last two years.",
      },
      {
        type: "stats",
        tone: "paper",
        eyebrow: "From clients and colleagues",
        heading: "The measures we watch most closely",
        items: [
          { value: "9 in 10", label: "of the clients we worked with in 2023 are still working with us today." },
          { value: "94%", label: "of clients say they would recommend KIASA to a peer." },
          { value: "3 years", label: "running, named one of the best mid-size technology workplaces." },
          { value: "88%", label: "of our people say they would recommend KIASA as a place to work." },
        ],
        source: "KIASA client survey, June 2026; KIASA staff survey, March 2026; Fairhaven Workplace Awards, 2024 to 2026.",
      },
      {
        type: "features",
        eyebrow: "Recent awards",
        heading: "Recognition from independent bodies",
        items: [
          {
            title: "Best Mid-Size Technology Workplace, 2026",
            text: "Fairhaven Workplace Awards, for the third year running, judged on an anonymous survey of our own people.",
            pattern: "branches",
            link: { label: "Working here", href: "/careers/working-here" },
          },
          {
            title: "Engagement of the Year, 2025",
            text: "Guild of Delivery Practitioners, for replacing Halden Mutual's claims core one product line at a time, without a freeze.",
            pattern: "strata",
            link: { label: "Read the story", href: "/client-stories/halden-mutual" },
          },
          {
            title: "Logistics Platform of the Year, 2025",
            text: "Harbour and Haul Technology Review, for the platform that plans 4,000 routes a night for Osprey Freight.",
            pattern: "waves",
            link: { label: "Read the story", href: "/client-stories/osprey-freight" },
          },
          {
            title: "Clinical Systems Prize, 2025",
            text: "Clearwater Digital Health Forum, for bringing Tessera Health's 38 clinics onto a single patient record.",
            pattern: "veins",
            link: { label: "Read the story", href: "/client-stories/tessera-health" },
          },
          {
            title: "Grid Data Project of the Year, 2026",
            text: "Northern Utilities Technology Circle, for moving Varda Energy's two million meters off a mainframe.",
            pattern: "matrix",
            link: { label: "Read the story", href: "/client-stories/varda-energy" },
          },
          {
            title: "Responsible Software Award, 2026",
            text: "Greenline Software Foundation, for adding energy and carbon measures to the platforms we run for clients.",
            pattern: "rings",
            link: { label: "Green Software", href: "/what-we-do/capabilities/green-software" },
          },
        ],
      },
      {
        type: "quote",
        text: "Our board asked who else had done a migration like ours. KIASA's answer was to send our own engineers up to collect the award. That told me who the work belonged to.",
        name: "Ruth Adebayo",
        role: "Chief Technology Officer, Varda Energy",
        image: "leaf-dew",
      },
      {
        type: "split",
        eyebrow: "From our people",
        heading: "A good place to do good work",
        body: [
          "For three years running, our own people have named KIASA one of the best mid-size technology workplaces to work for. The award is judged on an anonymous survey, and we publish the parts we scored worst on to everyone in the firm.",
          "This year that was workload in the last month of a handover. We have added a week to every handover plan to address it.",
        ],
        cta: { label: "Explore careers", href: "/careers" },
        image: "cafe-windows",
        side: "right",
      },
      {
        type: "media",
        eyebrow: "Client stories",
        heading: "The work behind the awards",
        items: [
          { image: "fog-forest", eyebrow: "Halden Mutual", title: "Claims settled in two days, not nine", href: "/client-stories/halden-mutual", cta: "Explore" },
          { image: "harbour-crane", eyebrow: "Osprey Freight", title: "4,000 routes a night on one platform", href: "/client-stories/osprey-freight", cta: "Explore" },
          { image: "tablet-hand", eyebrow: "Tessera Health", title: "38 clinics on a single patient record", href: "/client-stories/tessera-health", cta: "Explore" },
          { image: "wind-road", eyebrow: "Varda Energy", title: "Two million meters without a mainframe", href: "/client-stories/varda-energy", cta: "Explore" },
        ],
      },
      {
        type: "accordion",
        eyebrow: "FAQ",
        heading: "How we approach awards",
        items: [
          {
            title: "Which awards do we enter?",
            body: ["Only those judged on evidence from clients or staff, and only for work the client has agreed to be named in. We enter four or five a year."],
          },
          {
            title: "Do we pay to enter?",
            body: ["Where an entry fee is charged, we pay it and say so. We do not pay for sponsorship packages tied to a shortlist, and we do not enter awards that require one."],
          },
          {
            title: "Who collects the award?",
            body: ["Whoever did the work, and wherever we can, the client's own team alongside ours."],
          },
        ],
      },
      {
        type: "cta",
        heading: "See what the work could do for you",
        text: "Tell us what you are working on. A partner will reply within two working days.",
        cta: { label: "Contact us", href: "/contact" },
        secondary: { label: "Industry analyst recognition", href: "/about/industry-analyst-recognition" },
      },
    ],
  },

  // ─── Industry analyst recognition ────────────────────────────────────────
  {
    href: "/about/industry-analyst-recognition",
    title: "Industry Analyst Recognition",
    section: "Awards and rankings",
    summary: "How independent analysts rate our services.",
    blocks: [
      {
        type: "hero",
        variant: "plain",
        eyebrow: "Industry analyst recognition",
        title: "How independent analysts rate our services",
        lead: "Analyst firms compare consultancies on what they deliver and what their clients say. Here is how they have rated KIASA.",
        pattern: "matrix",
      },
      {
        type: "intro",
        text: "Analyst evaluations are one more independent view of our work. They interview our clients without us in the room, test our claims against evidence, and compare us with firms many times our size. We take part when the evaluation fits the work we actually do.",
        body: [
          "We are a mid-size firm, so we do not appear in every report. Where we do, we publish the result here, including the categories where we scored below the leaders.",
        ],
      },
      {
        type: "stats",
        tone: "paper",
        eyebrow: "Highlights",
        heading: "Application modernization services",
        items: [
          { value: "Leader", label: "in application modernization services, in our first evaluation in that market." },
          { value: "4.8 / 5", label: "for delivery, the highest score of any of the 16 firms evaluated." },
          { value: "6", label: "independent analyst evaluations have included KIASA in the last 18 months." },
        ],
        source: "Ashgrove Analyst Group, Application Modernization Services Assessment, May 2026.",
      },
      {
        type: "features",
        eyebrow: "Recent evaluations",
        heading: "Where analysts have placed us",
        items: [
          {
            title: "Leader: Application Modernization Services, 2026",
            text: "Ashgrove Analyst Group. Highest score of any firm for delivery, and above average for client references.",
            pattern: "strata",
            link: { label: "Application Modernization", href: "/what-we-do/capabilities/application-modernization" },
          },
          {
            title: "Strong Performer: Mid-Market Managed Cloud Services, 2026",
            text: "Pelling Research. Noted for plain-language reporting and named engineers on every account.",
            pattern: "orbit",
            link: { label: "Managed Services", href: "/what-we-do/capabilities/managed-services" },
          },
          {
            title: "Leader: Platform Engineering Services, 2025",
            text: "Pelling Research. Recognized for internal platforms that client teams go on to run themselves.",
            pattern: "contours",
            link: { label: "Cloud and Platform Engineering", href: "/what-we-do/capabilities/cloud-and-platform-engineering" },
          },
          {
            title: "Major Contender: Data and AI Engineering Services, 2025",
            text: "Ostrander and Vey. Strong on data quality and governance; scored lower on breadth of AI offerings.",
            pattern: "matrix",
            link: { label: "Artificial Intelligence and Data", href: "/what-we-do/capabilities/artificial-intelligence-and-data" },
          },
          {
            title: "Notable Provider: Sustainable Software Consulting, 2026",
            text: "Kittredge Insight. Cited for measuring energy and carbon in the platforms we run, not only those we advise on.",
            pattern: "veins",
            link: { label: "Green Software", href: "/what-we-do/capabilities/green-software" },
          },
          {
            title: "Contender: Cybersecurity Services for Mid-Size Enterprises, 2025",
            text: "Ashgrove Analyst Group. Praised for testing depth; we are a smaller security practice than the leaders.",
            pattern: "branches",
            link: { label: "Cybersecurity", href: "/what-we-do/capabilities/cybersecurity" },
          },
        ],
      },
      {
        type: "quote",
        text: "KIASA's clients described delivery that matched the original plan more often than those of any other firm we evaluated. Several said the handover was the part they remembered best.",
        name: "Imogen Sato",
        role: "Principal Analyst, Ashgrove Analyst Group",
        image: "steel-tower",
      },
      {
        type: "accordion",
        eyebrow: "FAQ",
        heading: "Reading an analyst evaluation",
        items: [
          {
            title: "How do analysts evaluate firms?",
            body: [
              "Most combine a written submission, a briefing, and interviews with clients the analyst selects or verifies. Scores are usually given for current offering, strategy and client feedback.",
            ],
          },
          {
            title: "Why is KIASA not in every report?",
            body: [
              "Many evaluations set a minimum size or a global presence that a firm of 420 people does not meet. We take part where the scope matches the work we do.",
            ],
          },
          {
            title: "Do we pay analyst firms?",
            body: [
              "We do not pay to be included in any evaluation. Like most firms, we buy some research subscriptions, and we keep those decisions separate from our participation.",
            ],
          },
          {
            title: "Can I read the full reports?",
            body: [
              "Most reports are licensed by the analyst firm. Write to our analyst relations team and we will share what the license allows.",
            ],
            link: { label: "Email analyst relations", href: "mailto:analysts@kiasa.tech" },
          },
        ],
      },
      {
        type: "cards",
        eyebrow: "Related",
        heading: "Explore more",
        items: [
          {
            kind: "Who we are",
            title: "Awards and recognition",
            summary: "What clients, colleagues and independent bodies have said about our work.",
            href: "/about/awards-and-recognition",
            art: "rings",
            surface: "leaf",
          },
          {
            kind: "Capability",
            title: "Application Modernization",
            summary: "Moving the systems a business depends on to foundations that can change, without stopping the business.",
            href: "/what-we-do/capabilities/application-modernization",
            art: "strata",
          },
          {
            kind: "Research report",
            title: "The maintenance dividend",
            summary: "We asked 140 engineering leaders where their budgets go. On average, 61% is spent keeping existing systems running.",
            href: "/insights/the-maintenance-dividend",
            art: "leaf-drops",
          },
          {
            kind: "Case study",
            title: "How Halden Mutual settles claims in two days, not nine",
            summary: "A 90-year-old insurer replaced its claims core without a freeze, one product line at a time.",
            href: "/client-stories/halden-mutual",
            art: "pulse",
            surface: "night",
          },
        ],
      },
      {
        type: "cta",
        heading: "Talk to our analyst relations team",
        text: "For briefings, inquiries and reference requests from analyst firms.",
        cta: { label: "Email analyst relations", href: "mailto:analysts@kiasa.tech" },
        secondary: { label: "Contact us", href: "/contact" },
      },
    ],
  },
];
