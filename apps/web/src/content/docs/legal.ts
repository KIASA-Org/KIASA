import type { LinksBlock, PageDoc } from "../blocks";

/** The footer's utility pages: contact, sitemap, privacy, terms, cookies,
 * accessibility and the preference center. SAMPLE CONTENT, like the rest of
 * the site: the policies below are placeholders for the design review, not
 * KIASA's actual terms, and the people, addresses and numbers are invented. */

/** The policies, linked from the foot of each of them. */
const policies: LinksBlock = {
  type: "links",
  eyebrow: "Related",
  heading: "Our other policies",
  groups: [
    {
      label: "Policies and settings",
      links: [
        { title: "Privacy Statement", href: "/privacy", summary: "What we collect, why, and the choices you have." },
        { title: "Terms & Conditions", href: "/terms", summary: "The terms that apply when you use this site." },
        { title: "Cookie Policy/Settings", href: "/cookies", summary: "The cookies this site sets, and how to change your settings." },
        { title: "Accessibility Statement", href: "/accessibility", summary: "How we build this site to be usable by everyone." },
        { title: "Preference Center", href: "/preferences", summary: "Choose what you hear from us, and how often." },
      ],
    },
  ],
};

/** Every page of the site, as the header and footer group them. */
const sitemapGroups: LinksBlock["groups"] = [
  {
    label: "KIASA",
    links: [
      { title: "Home", href: "/", summary: "Where change takes root: what KIASA does, what we think and the news." },
      { title: "KIASA Canopy", href: "/canopy", summary: "A standing team that runs your cloud platform, keeps it secure and reports back each month in plain language." },
    ],
  },
  {
    label: "What we do",
    links: [
      { title: "What we do", href: "/what-we-do", summary: "The work we take on, and the industries we know best." },
      { title: "Application Modernization", href: "/what-we-do/capabilities/application-modernization", summary: "Moving the systems a business depends on to foundations that can change, without stopping the business." },
      { title: "Artificial Intelligence and Data", href: "/what-we-do/capabilities/artificial-intelligence-and-data", summary: "Data platforms people trust, and AI put to work on problems worth solving." },
      { title: "Cloud and Platform Engineering", href: "/what-we-do/capabilities/cloud-and-platform-engineering", summary: "Cloud foundations and internal platforms that make the right way the easy way." },
      { title: "Cybersecurity", href: "/what-we-do/capabilities/cybersecurity", summary: "Security designed in from the first sketch, and tested the way an attacker would." },
      { title: "Digital Product Engineering", href: "/what-we-do/capabilities/digital-product-engineering", summary: "Products built and shipped by one team, from first prototype to steady release." },
      { title: "Enterprise Platforms", href: "/what-we-do/capabilities/enterprise-platforms", summary: "ERP, CRM and core platforms configured to fit the business, not the other way round." },
      { title: "Experience Design", href: "/what-we-do/capabilities/experience-design", summary: "Research, service design and interfaces that respect the people using them." },
      { title: "Green Software", href: "/what-we-do/capabilities/green-software", summary: "Measuring and cutting the energy and carbon cost of the software you run." },
      { title: "Integration and APIs", href: "/what-we-do/capabilities/integration-and-apis", summary: "Connecting the systems you have so data moves once, and correctly." },
      { title: "Managed Services", href: "/what-we-do/capabilities/managed-services", summary: "A standing team that runs, secures and improves what has been built." },
      { title: "Quality Engineering", href: "/what-we-do/capabilities/quality-engineering", summary: "Testing built into delivery, so releases are routine rather than events." },
      { title: "Strategy and Advisory", href: "/what-we-do/capabilities/strategy-and-advisory", summary: "Clear technology choices, costed and sequenced, before anything is built." },
      { title: "Technology Due Diligence", href: "/what-we-do/capabilities/technology-due-diligence", summary: "An independent read on a technology estate before you invest in it." },
      { title: "Workforce Enablement", href: "/what-we-do/capabilities/workforce-enablement", summary: "Training and coaching so your own teams can run and extend what we build together." },
    ],
  },
  {
    label: "Industries",
    links: [
      { title: "Banking and Payments", href: "/what-we-do/industries/banking-and-payments", summary: "Core modernization, payments and compliance for banks and fintechs." },
      { title: "Education", href: "/what-we-do/industries/education", summary: "Student systems and learning platforms for universities and schools." },
      { title: "Energy and Utilities", href: "/what-we-do/industries/energy-and-utilities", summary: "Metering, grid data and customer platforms for the energy transition." },
      { title: "Healthcare", href: "/what-we-do/industries/healthcare", summary: "Patient records, scheduling and clinical systems that staff can rely on." },
      { title: "Insurance", href: "/what-we-do/industries/insurance", summary: "Policy, claims and underwriting platforms for carriers and brokers." },
      { title: "Life Sciences", href: "/what-we-do/industries/life-sciences", summary: "Validated systems and research data platforms for regulated work." },
      { title: "Logistics and Transport", href: "/what-we-do/industries/logistics-and-transport", summary: "Planning, tracking and settlement for freight, rail and fleets." },
      { title: "Manufacturing", href: "/what-we-do/industries/manufacturing", summary: "Connected plants, supply planning and the systems between them." },
      { title: "Public Sector", href: "/what-we-do/industries/public-sector", summary: "Digital services for citizens, built to be maintained for decades." },
      { title: "Retail and Consumer", href: "/what-we-do/industries/retail-and-consumer", summary: "Commerce, pricing and supply systems for retailers and brands." },
      { title: "Software and Platforms", href: "/what-we-do/industries/software-and-platforms", summary: "Engineering depth for companies whose product is software." },
      { title: "Telecommunications", href: "/what-we-do/industries/telecommunications", summary: "Billing, provisioning and network data for operators." },
    ],
  },
  {
    label: "What we think",
    links: [
      { title: "What we think", href: "/insights", summary: "Research, perspectives and field notes from our work." },
      { title: "Why the second year of a cloud migration matters more than the first", href: "/insights/second-year-of-a-cloud-migration", summary: "The move itself is the easy part. Costs, habits and ownership settle in year two, and that is where most of the promised value is won or lost." },
      { title: "The maintenance dividend", href: "/insights/the-maintenance-dividend", summary: "We asked 140 engineering leaders where their budgets go. On average, 61% is spent keeping existing systems running. The best performers spend half that, and reinvest the rest." },
      { title: "AI in the back office: where the first real savings are showing up", href: "/insights/ai-in-the-back-office", summary: "Forget the demos. Across 60 finance, claims and supply teams, the returns so far come from four unglamorous tasks. We name them, with numbers." },
      { title: "Platform pulse: what engineering leaders will fund in 2027", href: "/insights/platform-pulse-2027", summary: "Budgets are flat; expectations are not. Our annual survey of 320 technology leaders shows where the money moves next year, and what is being cut to pay for it." },
      { title: "Green software is mostly just good software", href: "/insights/green-software-is-good-software", summary: "The code that wastes the least energy is usually the code that is simplest to run. A practical look at carbon as an engineering measure." },
      { title: "Security debt: the quiet risk on the balance sheet", href: "/insights/security-debt", summary: "Unpatched systems behave like unpaid loans: the interest compounds. A way to measure the exposure, and a plan for paying it down." },
    ],
  },
  {
    label: "Client stories",
    links: [
      { title: "How Halden Mutual settles claims in two days, not nine", href: "/client-stories/halden-mutual", summary: "A 90-year-old insurer replaced its claims core without a freeze, one product line at a time. Its customers noticed only that things got faster." },
      { title: "Grown with KIASA", href: "/client-stories/grown-with-kiasa", summary: "The people who run the systems we helped build tell the story in their own words. A short film series from the field, hosted by our managing partner." },
      { title: "Client stories", href: "/client-stories", summary: "How the systems we helped build are working today, told by the people who run them." },
      { title: "Osprey Freight plans 4,000 routes a night on one platform", href: "/client-stories/osprey-freight", summary: "A freight operator moved its route planning onto one platform, and now plans 4,000 routes a night." },
      { title: "Tessera Health brings 38 clinics onto a single patient record", href: "/client-stories/tessera-health", summary: "A healthcare group brought the records of all 38 of its clinics into one place." },
      { title: "Varda Energy reads two million meters without a mainframe", href: "/client-stories/varda-energy", summary: "An energy supplier reads two million meters on a modern platform, with its mainframe retired." },
    ],
  },
  {
    label: "Who we are",
    links: [
      { title: "Who we are", href: "/about", summary: "An independent consultancy, owned by the people who work in it." },
      { title: "How We Work", href: "/about/how-we-work", summary: "Small senior teams, short cycles and a plan for handing over from the first week." },
      { title: "Leadership", href: "/about/leadership", summary: "The partners and practice leads responsible for our work." },
      { title: "Locations", href: "/about/locations", summary: "Our studios, and how to reach each of them." },
      { title: "Partners", href: "/about/partners", summary: "The technology companies we build with, and why we chose them." },
      { title: "Sustainability Report", href: "/about/sustainability-report", summary: "Our footprint, our targets and what we did about both this year." },
      { title: "Awards and Recognition", href: "/about/awards-and-recognition", summary: "What clients, colleagues and independent bodies have said about our work." },
      { title: "Industry Analyst Recognition", href: "/about/industry-analyst-recognition", summary: "How independent analysts rate our services." },
    ],
  },
  {
    label: "Newsroom",
    links: [
      { title: "Newsroom", href: "/newsroom", summary: "Announcements and news from KIASA." },
      { title: "Media Relations", href: "/newsroom/media-relations", summary: "Press contacts, company facts and brand assets." },
      { title: "KIASA launches Canopy, a managed platform team for mid-size enterprises", href: "/newsroom/kiasa-launches-canopy", summary: "News release, September 29, 2026" },
      { title: "KIASA and Halden Mutual extend their partnership through 2030", href: "/newsroom/halden-mutual-partnership", summary: "News release, September 22, 2026" },
      { title: "KIASA completes an independent security audit of its managed services", href: "/newsroom/managed-services-security-audit", summary: "News release, September 10, 2026" },
      { title: "New research: engineering leaders spend 61% of their budgets keeping systems running", href: "/newsroom/maintenance-dividend-research", summary: "News release, August 27, 2026" },
      { title: "KIASA appoints Daniel Okafor as Chief Delivery Officer", href: "/newsroom/chief-delivery-officer", summary: "News release, August 12, 2026" },
      { title: "KIASA publishes its first sustainability report", href: "/newsroom/first-sustainability-report", summary: "News release, July 30, 2026" },
      { title: "KIASA opens a second engineering studio", href: "/newsroom/second-engineering-studio", summary: "News release, July 16, 2026" },
    ],
  },
  {
    label: "Careers",
    links: [
      { title: "Careers", href: "/careers", summary: "Do the best work of your career, with people who take the craft seriously." },
      { title: "Search for Jobs", href: "/careers/search-for-jobs", summary: "Every open role, in one place." },
      { title: "Career Areas", href: "/careers/career-areas", summary: "Engineering, design, data, delivery and advisory." },
      { title: "Early Careers", href: "/careers/early-careers", summary: "Graduate roles and internships." },
      { title: "Working Here", href: "/careers/working-here", summary: "What a week at KIASA looks like." },
      { title: "Benefits", href: "/careers/benefits", summary: "Pay, leave, health and the practical details." },
      { title: "Learning and Growth", href: "/careers/learning-and-growth", summary: "Time and budget set aside for getting better at your craft." },
      { title: "Careers Blog", href: "/careers/careers-blog", summary: "Stories from the people who work here." },
      { title: "Hiring Journey", href: "/careers/hiring-journey", summary: "Each step, from application to offer." },
      { title: "Interview Tips", href: "/careers/interview-tips", summary: "What we look for, and how to prepare." },
    ],
  },
  {
    label: "Site information",
    links: [
      { title: "Contact Us", href: "/contact", summary: "Tell us what you are working on. A partner will reply within two working days." },
      { title: "Sitemap", href: "/sitemap", summary: "Every page on this site, in one list." },
      { title: "Privacy Statement", href: "/privacy", summary: "What we collect, why, and the choices you have." },
      { title: "Terms & Conditions", href: "/terms", summary: "The terms that apply when you use this site." },
      { title: "Cookie Policy/Settings", href: "/cookies", summary: "The cookies this site sets, and how to change your settings." },
      { title: "Accessibility Statement", href: "/accessibility", summary: "How we build this site to be usable by everyone, and how to tell us where it falls short." },
      { title: "Preference Center", href: "/preferences", summary: "Choose what you hear from us, and how often." },
    ],
  },
];

const contact: PageDoc = {
  href: "/contact",
  title: "Contact Us",
  section: "KIASA",
  summary: "Tell us what you are working on. A partner will reply within two working days.",
  blocks: [
    {
      type: "hero",
      variant: "split",
      eyebrow: "Contact us",
      title: "Tell us what you are working on",
      lead: "A partner will reply within two working days, with a straight answer about whether we can help.",
      image: "bright-room",
    },
    {
      type: "form",
      heading: "Send us a message",
      intro: "A few lines are enough. Tell us what you are trying to do, by when, and what is in the way. Nothing you send here is shared outside KIASA.",
      kind: "contact",
    },
    {
      type: "steps",
      tone: "paper",
      eyebrow: "After you write",
      heading: "What happens next",
      intro: "No sales sequence and no automated follow-ups. A person reads what you send and decides with you what, if anything, comes next.",
      items: [
        { title: "A partner reads it", text: "Your message goes to a partner who knows your industry, not to a sales team. You hear back within two working days." },
        { title: "A first conversation", text: "Forty-five minutes, by video or in one of our studios, at no charge. We ask a lot of questions and promise nothing yet." },
        { title: "A short written view", text: "Within a week, two or three pages: what we would do, roughly what it would cost, and who from KIASA would do it." },
        { title: "You decide", text: "If it is not a fit, we say so and, where we can, suggest who might be. We do not follow up unless you ask us to." },
      ],
    },
    {
      type: "accordion",
      eyebrow: "Before you write",
      heading: "Looking for someone else?",
      items: [
        {
          title: "Looking for a job",
          body: ["Every open role is listed on our careers pages, with its salary range. Apply there, and a recruiter will reply to every application, whatever the outcome."],
          link: { label: "Search for jobs", href: "/careers/search-for-jobs" },
        },
        {
          title: "A press enquiry",
          body: ["Our press office answers journalists the same working day. You will find the contacts for each region, company facts and brand assets on the media relations page."],
          link: { label: "Media relations", href: "/newsroom/media-relations" },
        },
        {
          title: "Already a client",
          body: [
            "Your engagement lead is the fastest route for anything about your project. For an incident on a platform we run for you, use the support line in your service handbook: it is answered around the clock.",
          ],
        },
        {
          title: "A question about your data",
          body: ["To see, correct or delete the personal data we hold about you, write to our privacy team. We answer within one month, free of charge."],
          link: { label: "Privacy statement", href: "/privacy" },
        },
        {
          title: "Suppliers and technology companies",
          body: ["We choose the platforms we build on carefully and say why on our partners page. To introduce your company, use the form above and choose Partnership as the topic."],
          link: { label: "Partners", href: "/about/partners" },
        },
      ],
    },
    {
      type: "locations",
      heading: "Our studios",
      intro: "Visit us by appointment. Every studio has step-free access, and we are happy to meet you somewhere quieter if you prefer.",
      regions: [
        {
          name: "Europe and Africa",
          studios: [
            { city: "Lisbon", country: "Portugal", address: "Rua da Prata 112, 1100-420 Lisboa", phone: "+351 21 340 5120", email: "lisbon@kiasa.tech" },
            { city: "Amsterdam", country: "Netherlands", address: "Keizersgracht 418, 1016 GD Amsterdam", phone: "+31 20 845 3170", email: "amsterdam@kiasa.tech" },
            { city: "London", country: "United Kingdom", address: "41 Great Sutton Street, London EC1V 0DX", phone: "+44 20 3870 4410", email: "london@kiasa.tech" },
            { city: "Nairobi", country: "Kenya", address: "14 Riverside Drive, Westlands, Nairobi 00800", phone: "+254 20 765 4300", email: "nairobi@kiasa.tech" },
          ],
        },
        {
          name: "North America",
          studios: [
            { city: "Toronto", country: "Canada", address: "320 Adelaide Street West, Suite 600, Toronto, ON M5V 1R1", phone: "+1 416 555 0148", email: "toronto@kiasa.tech" },
            { city: "Austin", country: "United States", address: "601 East 5th Street, Floor 3, Austin, TX 78701", phone: "+1 512 555 0172", email: "austin@kiasa.tech" },
          ],
        },
        {
          name: "Asia Pacific",
          studios: [
            { city: "Singapore", country: "Singapore", address: "71 Amoy Street, #03-01, Singapore 069891", phone: "+65 6812 4470", email: "singapore@kiasa.tech" },
            { city: "Melbourne", country: "Australia", address: "Level 4, 88 Flinders Lane, Melbourne VIC 3000", phone: "+61 3 9012 5530", email: "melbourne@kiasa.tech" },
          ],
        },
      ],
    },
    {
      type: "contacts",
      heading: "Or write to someone directly",
      intro: "Each of these inboxes is read by the person named, every working day.",
      items: [
        { name: "Leila Haddad", role: "Partner, Clients and Growth", email: "hello@kiasa.tech", phone: "+44 20 3870 4410" },
        { name: "Hannah Lindqvist", role: "Head of Communications", email: "press@kiasa.tech", phone: "+44 20 3870 4410" },
        { name: "Farah Haddad", role: "Head of Talent, careers", email: "careers@kiasa.tech" },
        { name: "Marta Kowalczyk", role: "Data Protection Officer", email: "privacy@kiasa.tech" },
      ],
    },
    {
      type: "cta",
      heading: "Prefer to read first?",
      text: "See the work we take on, and how it is working today for the clients we did it for.",
      cta: { label: "What we do", href: "/what-we-do" },
      secondary: { label: "Client stories", href: "/client-stories" },
      image: "cafe-table",
    },
  ],
};

const sitemap: PageDoc = {
  href: "/sitemap",
  title: "Sitemap",
  section: "KIASA",
  summary: "Every page on this site, in one list.",
  blocks: [
    {
      type: "hero",
      variant: "plain",
      eyebrow: "Sitemap",
      title: "Sitemap",
      lead: "Every page on this site, in one list.",
      pattern: "branches",
    },
    {
      type: "intro",
      text: "Seventy-six pages in nine groups, in the order the header and footer list them. Each one has a single line that says what you will find there.",
      body: [
        "If you cannot find what you are looking for, try the search in the header, or write to us and a person will point you to it.",
      ],
    },
    {
      type: "links",
      heading: "All pages",
      groups: sitemapGroups,
    },
    {
      type: "stats",
      tone: "paper",
      eyebrow: "The site",
      heading: "What is here",
      items: [
        { value: "14", label: "Capabilities, from application modernization to workforce enablement." },
        { value: "12", label: "Industries, each with the work we do in it." },
        { value: "6", label: "Research reports and perspectives, with the data behind them." },
        { value: "7", label: "News releases from the last three months." },
      ],
    },
    {
      type: "features",
      eyebrow: "Other ways in",
      heading: "Not sure where to start?",
      items: [
        { title: "Start with the work", text: "The capabilities and industries we know best, and what we do in each.", pattern: "strata", link: { label: "What we do", href: "/what-we-do" } },
        { title: "Start with the results", text: "How the systems we helped build are working today, told by the people who run them.", pattern: "pulse", link: { label: "Client stories", href: "/client-stories" } },
        { title: "Ask a person", text: "Tell us what you are looking for. A partner will reply within two working days.", pattern: "orbit", link: { label: "Contact us", href: "/contact" } },
      ],
    },
    {
      type: "accordion",
      heading: "About this site",
      items: [
        {
          title: "Is the content on this site real?",
          body: [
            "Not yet. The clients, people, figures, awards and dates on this site are sample content, written so the design can be judged with realistic copy. They will be replaced before the site is public.",
          ],
        },
        {
          title: "Can everyone use this site?",
          body: ["We build it to meet WCAG 2.2 at level AA, and test it with a keyboard and screen readers before every release. Our accessibility statement lists what still falls short."],
          link: { label: "Accessibility statement", href: "/accessibility" },
        },
        {
          title: "What does this site record about my visit?",
          body: ["Only what it needs to work, unless you allow analytics. You can see every cookie by name and change your choice at any time."],
          link: { label: "Cookie settings", href: "/cookies" },
        },
      ],
    },
    {
      type: "cta",
      heading: "Still cannot find it?",
      text: "Write to us and tell us what you were looking for. We will point you to it, and fix the site if it should have been easier.",
      cta: { label: "Contact us", href: "/contact" },
      secondary: { label: "Back to the homepage", href: "/" },
    },
  ],
};

const privacy: PageDoc = {
  href: "/privacy",
  title: "Privacy Statement",
  section: "KIASA",
  summary: "What we collect, why, and the choices you have.",
  blocks: [
    {
      type: "hero",
      variant: "plain",
      eyebrow: "Privacy",
      title: "Privacy statement",
      lead: "What we collect, why, and the choices you have. This is sample text, not KIASA's policy.",
      pattern: "strata",
    },
    {
      type: "intro",
      text: "We collect as little as we can, use it only for the reason we collected it, and delete it when that reason has passed. This statement explains what that means for visitors to this site, people who contact us, candidates, and the people we work with at our clients.",
      body: [
        "Last updated September 15, 2026. It applies to kiasa.tech and to every KIASA service that links to it.",
        "If anything here is unclear, write to our privacy team. A person will answer within five working days.",
      ],
    },
    {
      type: "prose",
      aside: {
        heading: "In brief",
        points: [
          "We do not sell personal data, to anyone.",
          "Analytics cookies stay off until you turn them on.",
          "Applications are deleted 12 months after a decision, unless you ask us to keep them.",
          "You can see, correct or delete what we hold by writing to privacy@kiasa.tech.",
          "We answer every request within one month, free of charge.",
        ],
      },
      items: [
        { h: "Who we are" },
        { p: "KIASA Ltd, 41 Great Sutton Street, London EC1V 0DX, United Kingdom, is the controller of the personal data described here. Our studios in other countries act for KIASA Ltd under a written agreement and follow this statement." },
        { h: "What we collect" },
        {
          list: [
            "What you give us: your name, email address, phone number, organization, and the message you send through a form or by email.",
            "When you apply for a job: your CV, your work history, interview notes and, if we make an offer, the checks the law in your country requires.",
            "When you use this site: the pages you view, the page that sent you here, your browser and device type, and an approximate location from your IP address, which we shorten before storing it.",
            "When you subscribe: the topics you chose and, only if you allow it in the Preference Center, whether you opened our emails.",
            "From our clients: the work contact details of the people we work with on a project.",
          ],
        },
        { p: "We do not ask for sensitive data, such as information about your health, and ask you not to send it, unless a role or a reasonable adjustment at interview needs it." },
        { h: "Why we use it" },
        {
          list: [
            "To answer you. Our basis is our legitimate interest in replying to questions about our work.",
            "To consider you for a job. Our basis is the steps you asked us to take before a contract, and for background checks, a legal obligation.",
            "To send you news and research. Only with your consent, which you can withdraw at any time.",
            "To run and protect this site: to keep it secure, fix faults and learn which pages are useful. Our basis is legitimate interest, and for analytics cookies, your consent.",
            "To deliver client work. Our basis is the contract with your employer.",
          ],
        },
        { h: "Who we share it with" },
        { p: "Only the service providers who host this site, send our email, run our recruitment system and keep our accounts. Each works under a contract that limits them to our instructions and requires them to keep the data secure. We do not sell personal data, share it for advertising, or use it to train AI models." },
        { p: "We disclose data when the law requires it, for example to a court or a regulator, and we will tell you when we are allowed to." },
        { h: "Where it is stored" },
        { p: "Our systems are hosted in the United Kingdom and the European Union. When a studio elsewhere needs access, for example to consider a candidate in Singapore, the transfer is covered by standard contractual clauses or an equivalent safeguard. Ask us for a copy." },
        { h: "How long we keep it" },
        {
          list: [
            "Enquiries: two years after our last exchange.",
            "Applications that do not lead to a job: 12 months after the decision, or longer if you ask us to keep you in mind.",
            "Employee records: six years after employment ends, as the law requires.",
            "Subscriptions: until you unsubscribe, then only a record of the unsubscribe, so we do not write again.",
            "Site analytics: 14 months, then only in totals that identify no one.",
          ],
        },
        { h: "How we protect it" },
        { p: "Access is limited to the people who need it, protected by single sign-on and two-factor authentication, and logged. Data is encrypted in transit and at rest. The controls an independent auditor examined in our managed services apply to our own systems too." },
        { h: "Your rights" },
        {
          list: [
            "See the personal data we hold about you, and get a copy.",
            "Have inaccurate data corrected.",
            "Have your data deleted when we no longer need it.",
            "Object to, or ask us to limit, how we use it.",
            "Take your data to another organization in a common format.",
            "Withdraw your consent at any time, without affecting what we did before.",
            "Complain to the data protection authority where you live.",
          ],
        },
        { h: "Changes to this statement" },
        { p: "We review this statement every year, and whenever the way we use data changes. If a change matters, we say so at the top of this page and, if you subscribe to our emails, we tell you directly." },
        { h: "Contact" },
        { p: "Data Protection Officer, KIASA Ltd, 41 Great Sutton Street, London EC1V 0DX, United Kingdom. Email privacy@kiasa.tech. This site is not meant for children under 16, and we do not knowingly collect their data." },
      ],
    },
    {
      type: "accordion",
      eyebrow: "Questions",
      heading: "What people ask us",
      items: [
        { title: "Do you sell my data?", body: ["No. We have never sold personal data and we will not. We do not share it with advertisers or data brokers either."] },
        {
          title: "Do you use my data to train AI models?",
          body: ["No. We do not use personal data from this site, from applications or from enquiries to train or fine-tune any model, ours or anyone else's."],
        },
        {
          title: "How do I stop your emails?",
          body: ["Use the unsubscribe link at the foot of any email, or change your choices in the Preference Center. It takes effect at once."],
          link: { label: "Preference Center", href: "/preferences" },
        },
        {
          title: "What happens to my application if I am not hired?",
          body: ["We keep it for 12 months, so we can answer questions about the decision, and then delete it. If you would like us to keep it longer for future roles, tell your recruiter."],
          link: { label: "How we hire", href: "/careers/hiring-journey" },
        },
        {
          title: "Which cookies does this site set?",
          body: ["Only the ones it needs to work, unless you choose otherwise. Our cookie policy lists every one by name."],
          link: { label: "Cookie settings", href: "/cookies" },
        },
      ],
    },
    {
      type: "steps",
      tone: "paper",
      heading: "How to make a request",
      intro: "To see, correct or delete your data, or to object to how we use it.",
      items: [
        { title: "Write to us", text: "Email privacy@kiasa.tech, or write to our Data Protection Officer in London. Say what you would like us to do." },
        { title: "We confirm it is you", text: "We may ask for one piece of information we already hold, so we only ever give your data to you." },
        { title: "We search every system", text: "Including email, our recruitment system and our client records, in every studio." },
        { title: "You get an answer", text: "Within one month, free of charge. If we cannot do what you ask, we explain why." },
      ],
    },
    {
      type: "contacts",
      heading: "Privacy contacts",
      intro: "Write to any of them. Requests reach the same team, wherever you send them.",
      items: [
        { name: "Marta Kowalczyk", role: "Data Protection Officer", email: "privacy@kiasa.tech", phone: "+44 20 3870 4410" },
        { name: "Laila Ahmadi", role: "Privacy Lead, North America", email: "privacy@kiasa.tech", phone: "+1 416 555 0148" },
        { name: "Kenji Morimoto", role: "Privacy Lead, Asia Pacific", email: "privacy@kiasa.tech", phone: "+65 6812 4470" },
      ],
    },
    policies,
    {
      type: "cta",
      heading: "A question about your data?",
      text: "Write to our privacy team. A person will reply within five working days.",
      cta: { label: "Write to our privacy team", href: "mailto:privacy@kiasa.tech" },
      secondary: { label: "Contact us", href: "/contact" },
    },
  ],
};

const terms: PageDoc = {
  href: "/terms",
  title: "Terms & Conditions",
  section: "KIASA",
  summary: "The terms that apply when you use this site.",
  blocks: [
    {
      type: "hero",
      variant: "plain",
      eyebrow: "Legal",
      title: "Terms and conditions",
      lead: "The terms that apply when you use this site. This is sample text, not a binding agreement.",
      pattern: "contours",
    },
    {
      type: "intro",
      text: "These terms are short because this site is simple: it tells you about our work and lets you get in touch. They cover what you may do with what you find here, what we promise about it, and what we do not.",
      body: [
        "Last updated September 15, 2026.",
        "Work we do for clients is governed by the contract signed for it, not by these terms.",
      ],
    },
    {
      type: "prose",
      aside: {
        heading: "In brief",
        points: [
          "Read, print and share our pages freely.",
          "Quote our research with credit to KIASA.",
          "Do not copy the site or collect its content in bulk.",
          "The site is general information, not advice.",
          "The law of England and Wales applies.",
        ],
      },
      items: [
        { h: "About these terms" },
        { p: "kiasa.tech is run by KIASA Ltd, a company registered in England and Wales, at 41 Great Sutton Street, London EC1V 0DX. By using the site you accept these terms. If you do not accept them, please do not use it." },
        { h: "Using this site" },
        {
          list: [
            "You may read, print and share pages for your own reference, or to discuss our work with others.",
            "You may quote our research, with credit to KIASA and the name of the report.",
            "You may not copy the site, or large parts of it, to publish elsewhere.",
            "You may not try to break into, overload or probe the site's systems, except under our vulnerability disclosure arrangements.",
            "You may not use automated tools to collect content in bulk, including to train machine learning models, without our written permission.",
          ],
        },
        { h: "Intellectual property" },
        { p: "The text, research, photographs, line drawings and the KIASA mark on this site belong to KIASA or are used under licence. The KIASA name and leaf mark are trademarks of KIASA Ltd. Nothing on this site grants a licence to use them beyond what these terms allow." },
        { h: "Content and accuracy" },
        { p: "We work to keep this site accurate and current, but it is general information, not advice. Research findings describe what respondents told us at the time of each survey. Before acting on anything you read here, talk to us or to another adviser about your own situation." },
        { h: "Information you send us" },
        { p: "When you send us a message, an application or any other material, you confirm that you are entitled to share it. We use it as our privacy statement describes. Please do not send confidential information through the site's forms: if we need it, we will ask for it through a secure channel." },
        { h: "Our liability" },
        { p: "We do not exclude liability for death or personal injury caused by our negligence, for fraud, or for anything else the law does not allow us to exclude. Otherwise, because the site is free and for information only, we are not liable for any loss arising from its use, including loss of profit, data or business." },
        { h: "Availability" },
        { p: "We aim to keep the site available at all times, but we may suspend it for maintenance or for security reasons. Where we can, we give notice of planned downtime on the homepage." },
        { h: "Changes to these terms" },
        { p: "We may update these terms. The date at the top of this page shows when they last changed, and continued use of the site after a change means you accept the new terms." },
        { h: "Governing law" },
        { p: "These terms are governed by the law of England and Wales, and disputes are for its courts. If you live elsewhere, you keep any protections the law where you live gives you." },
        { h: "Contact" },
        { p: "Questions about these terms: legal@kiasa.tech, or write to the Legal team, KIASA Ltd, 41 Great Sutton Street, London EC1V 0DX, United Kingdom." },
      ],
    },
    {
      type: "accordion",
      eyebrow: "Questions",
      heading: "Common questions",
      items: [
        {
          title: "Can I quote your research in my article or report?",
          body: ["Yes. Credit KIASA and name the report. For charts or longer extracts, ask the press office, who can also send the underlying data."],
          link: { label: "Media relations", href: "/newsroom/media-relations" },
        },
        {
          title: "Can I use the KIASA logo?",
          body: ["For editorial use, yes: ask the press office for the files and the short notes on how to use them. For anything else, ask us first."],
          link: { label: "Media relations", href: "/newsroom/media-relations" },
        },
        {
          title: "I found a security problem on this site",
          body: [
            "Thank you. Write to security@kiasa.tech with what you found and how to reproduce it. We reply within two working days, and we will not take action against anyone who reports a problem in good faith and gives us time to fix it.",
          ],
        },
        {
          title: "Do these terms cover our project with KIASA?",
          body: ["No. Client work is governed by the contract signed for it. Your engagement lead can send you a copy."],
        },
      ],
    },
    {
      type: "contacts",
      heading: "Legal contacts",
      items: [
        { name: "Aisha Bello", role: "General Counsel", email: "legal@kiasa.tech", phone: "+44 20 3870 4410" },
        { name: "Clara Fontaine", role: "Company Secretary", email: "legal@kiasa.tech" },
        { name: "Hiroshi Nakamura", role: "Chief Information Security Officer, vulnerability reports", email: "security@kiasa.tech" },
      ],
    },
    policies,
    {
      type: "cta",
      heading: "A question about these terms?",
      text: "Write to our legal team. We reply within five working days.",
      cta: { label: "Email the legal team", href: "mailto:legal@kiasa.tech" },
      secondary: { label: "Contact us", href: "/contact" },
    },
  ],
};

const cookies: PageDoc = {
  href: "/cookies",
  title: "Cookie Policy/Settings",
  section: "KIASA",
  summary: "The cookies this site sets, and how to change your settings.",
  blocks: [
    {
      type: "hero",
      variant: "plain",
      eyebrow: "Cookies",
      title: "Cookie policy and settings",
      lead: "The cookies this site sets, and how to change your settings. This is sample text, not KIASA's policy.",
      pattern: "matrix",
    },
    {
      type: "intro",
      text: "This site sets as few cookies as it can. The ones it needs to work are always on. Everything else, including analytics, stays off until you turn it on, and you can change your mind here at any time.",
      body: [
        "Last updated September 15, 2026.",
        "Your choice is kept in a cookie of its own for 12 months. After that, we ask again.",
      ],
    },
    {
      type: "form",
      tone: "paper",
      heading: "Your cookie settings",
      intro: "Turn each kind of cookie on or off. Strictly necessary cookies cannot be turned off, because the site does not work without them.",
      kind: "cookies",
    },
    {
      type: "prose",
      aside: {
        heading: "In brief",
        points: [
          "Three cookies are always on, because the site needs them.",
          "Analytics stay off until you allow them.",
          "No advertising cookies, ever.",
          "Your choice lasts 12 months.",
        ],
      },
      items: [
        { h: "What cookies are" },
        { p: "Cookies are small text files a website stores in your browser, so it can remember something between one page and the next, or between one visit and the next. Similar technologies, such as local storage, are covered by this policy too." },
        { h: "The cookies we use" },
        {
          list: [
            "Strictly necessary: keep the site working and secure, and remember your cookie choices. Always on.",
            "Preferences: remember the region you chose and whether you paused the moving picture on the homepage. Off until you allow them.",
            "Analytics: count visits and show which pages are useful, without identifying you. Off until you allow them.",
            "Advertising: none. We do not use advertising or cross-site tracking cookies.",
          ],
        },
        { h: "Cookies set by others" },
        { p: "Our analytics run on our own systems, so no third party sets cookies when you visit this site. If a page ever embeds content from another service, such as a video, it will not load until you allow it, and we will say which service it is." },
        { h: "How long they last" },
        { p: "Session cookies are deleted when you close your browser. The others last for the period listed against each one below, and never longer than 13 months." },
        { h: "How to change your settings" },
        { p: "Use the settings on this page at any time. Your browser also lets you see, block and delete cookies, usually under its privacy settings. Blocking strictly necessary cookies may stop parts of the site from working." },
        { h: "Changes to this policy" },
        { p: "If we add a cookie or change what one does, we update this page and ask for your choice again." },
        { h: "Contact" },
        { p: "Questions about cookies: privacy@kiasa.tech. For everything else about your data, see our privacy statement." },
      ],
    },
    {
      type: "accordion",
      eyebrow: "In detail",
      heading: "Every cookie, by name",
      items: [
        {
          title: "Strictly necessary",
          body: [
            "kiasa_session: keeps the site working as you move between pages. Deleted when you close your browser.",
            "kiasa_consent: remembers your cookie choices. 12 months.",
            "kiasa_csrf: stops other sites from submitting our forms in your name. Deleted when you close your browser.",
          ],
          stat: { value: "3", label: "cookies, always on" },
        },
        {
          title: "Preferences",
          body: [
            "kiasa_region: the region and language you chose from the globe in the header. 12 months.",
            "kiasa_motion: whether you paused the moving picture on the homepage. 12 months.",
          ],
          stat: { value: "2", label: "cookies, off until you allow them" },
        },
        {
          title: "Analytics",
          body: [
            "kiasa_visit: a random number that lets us count visits without knowing who you are. 13 months.",
            "kiasa_path: the order of pages within one visit, so we can see where people get lost. 30 minutes.",
          ],
          stat: { value: "2", label: "cookies, off until you allow them" },
        },
        {
          title: "Advertising",
          body: ["None. We do not use advertising or tracking cookies, and we do not share data with advertising networks."],
          stat: { value: "0", label: "advertising cookies" },
        },
      ],
    },
    policies,
    {
      type: "cta",
      heading: "Questions about cookies?",
      text: "Write to our privacy team, or read how we handle personal data more generally.",
      cta: { label: "Privacy statement", href: "/privacy" },
      secondary: { label: "Email the privacy team", href: "mailto:privacy@kiasa.tech" },
    },
  ],
};

const accessibility: PageDoc = {
  href: "/accessibility",
  title: "Accessibility Statement",
  section: "KIASA",
  summary: "How we build this site to be usable by everyone, and how to tell us where it falls short.",
  blocks: [
    {
      type: "hero",
      variant: "plain",
      eyebrow: "Accessibility",
      title: "Accessibility statement",
      lead: "How we build this site to be usable by everyone, and how to tell us where it falls short. This is sample text, not KIASA's statement.",
      pattern: "orbit",
    },
    {
      type: "intro",
      text: "We want everyone to be able to use this site, whether they use a screen reader, a keyboard, magnification, voice control or none of these. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, and we test against them before every release.",
      body: [
        "Last reviewed September 15, 2026, by our Experience Design team and two testers who use assistive technology every day.",
        "This statement covers kiasa.tech. The systems we build for clients have statements of their own, owned by our clients.",
      ],
    },
    {
      type: "stats",
      tone: "paper",
      eyebrow: "Where we stand",
      heading: "Our last review, in numbers",
      items: [
        { value: "AA", label: "The level of WCAG 2.2 we build and test to." },
        { value: "4.5:1", label: "The lowest contrast we allow between body text and its background." },
        { value: "0", label: "Layout shift: nothing on a page moves while you are reading it." },
        { value: "3", label: "Known issues, each listed below with a date for its fix." },
      ],
      source: "KIASA accessibility review, September 2026.",
    },
    {
      type: "features",
      eyebrow: "How we build",
      heading: "Designed to be used, not only seen",
      items: [
        { title: "Works with a keyboard", text: "Every link, menu and dialog can be reached, used and closed with a keyboard, and you can always see where you are.", pattern: "matrix" },
        { title: "Clear to a screen reader", text: "Headings in order, labelled landmarks and forms, and a description for every photograph that carries meaning.", pattern: "waves" },
        { title: "Motion you control", text: "The moving picture on the homepage has a pause button, and all motion stops if your device asks for reduced motion.", pattern: "pulse" },
        { title: "Contrast and color", text: "Text meets contrast requirements in light and dark sections, and color is never the only way information is shown.", pattern: "rings" },
        { title: "Zoom and small screens", text: "Pages work at 400% zoom and on screens 320 pixels wide, without scrolling sideways.", pattern: "contours" },
        { title: "Plain language", text: "Short sentences and a one-line summary at the top of each page, so you can tell quickly whether it is the one you need.", pattern: "veins" },
      ],
    },
    {
      type: "prose",
      aside: {
        heading: "In brief",
        points: [
          "We build and test to WCAG 2.2 level AA.",
          "Three known issues, each with a date for its fix.",
          "Tell us about a problem at accessibility@kiasa.tech.",
          "We reply within two working days.",
        ],
      },
      items: [
        { h: "Compatibility" },
        { p: "The site is tested on the latest two versions of the major desktop and mobile browsers, with the screen readers built into the main desktop and mobile operating systems, and with one widely used third-party screen reader on desktop." },
        { h: "Known limitations" },
        {
          list: [
            "Some older research reports are PDF files that are not fully tagged. We will send an accessible version within five working days of a request, and are replacing them by March 2027.",
            "The films in the Grown with KIASA series have captions, but not yet audio description. Transcripts are available on request now; audio description follows by January 2027.",
            "The search panel does not yet announce the number of results to screen readers. A fix is planned for November 2026.",
          ],
        },
        { h: "How we test" },
        { p: "Automated checks run on every change before it is released. Before every release, a designer and an engineer review the changed pages using only a keyboard and with a screen reader. Once a year, testers with disabilities review the whole site, and we publish what they found here." },
        { h: "Alternative formats" },
        { p: "If you need anything on this site in another format, such as large print, an accessible PDF or plain text, write to us and we will send it within five working days." },
        { h: "Feedback and contact" },
        { p: "Tell us where the site falls short at accessibility@kiasa.tech, or call +44 20 3870 4410. A person reads every message and replies within two working days. If you are not satisfied with our answer, you can contact the body responsible for accessibility or equality where you live." },
        { h: "Changes to this statement" },
        { p: "We update this statement after every annual review, and whenever we fix a known issue or find a new one." },
      ],
    },
    {
      type: "steps",
      tone: "paper",
      heading: "How to report a problem",
      items: [
        { title: "Tell us where", text: "The address of the page, or a description of where you were and what you were trying to do." },
        { title: "Tell us what you use", text: "Your browser and any assistive technology, if you are happy to share it. It helps us reproduce the problem." },
        { title: "We reply in two days", text: "With what we will do and by when, and the content you needed in another format if that helps in the meantime." },
        { title: "We fix it and tell you", text: "We write again when the fix is live, and add the issue to this statement until it is." },
      ],
    },
    {
      type: "contacts",
      heading: "Accessibility contacts",
      items: [
        { name: "Noor Siddiqui", role: "Accessibility Lead, Experience Design", email: "accessibility@kiasa.tech", phone: "+44 20 3870 4410" },
        { name: "Mateo Rossi", role: "Front-end Engineering Lead", email: "accessibility@kiasa.tech" },
      ],
    },
    {
      type: "cta",
      heading: "Found something that does not work for you?",
      text: "Tell us. A person will reply within two working days.",
      cta: { label: "Email accessibility@kiasa.tech", href: "mailto:accessibility@kiasa.tech" },
      secondary: { label: "Contact us", href: "/contact" },
    },
  ],
};

const preferences: PageDoc = {
  href: "/preferences",
  title: "Preference Center",
  section: "KIASA",
  summary: "Choose what you hear from us, and how often.",
  blocks: [
    {
      type: "hero",
      variant: "plain",
      eyebrow: "Preference Center",
      title: "Choose what you hear from us",
      lead: "Pick the topics you want, and how often. This is a sample page: nothing is sent anywhere yet.",
      pattern: "waves",
    },
    {
      type: "intro",
      text: "We write when we have something worth reading: new research, a client story, an event near you or a role that fits. Choose the topics you want and how often you want them, and we will send nothing else.",
      body: [
        "You can change these settings at any time, here or from the link at the foot of every email.",
        "We never share your address, and we do not track whether you open our emails unless you allow it.",
      ],
    },
    {
      type: "form",
      tone: "paper",
      heading: "Your preferences",
      intro: "Enter your email address, then choose your topics and how often you want to hear from us.",
      kind: "preferences",
    },
    {
      type: "features",
      eyebrow: "Topics",
      heading: "What you can hear about",
      items: [
        { title: "Research", text: "New reports, such as The maintenance dividend and Platform pulse, with the data behind them.", pattern: "matrix", link: { label: "What we think", href: "/insights" } },
        { title: "Perspectives", text: "Short pieces from our practitioners on what they are seeing in the field.", pattern: "strata", link: { label: "Read a perspective", href: "/insights/second-year-of-a-cloud-migration" } },
        { title: "Client stories", text: "How the systems we helped build are working, told by the people who run them.", pattern: "branches", link: { label: "Client stories", href: "/client-stories" } },
        { title: "News", text: "Each release, the morning it is published: new services, partnerships and appointments.", pattern: "pulse", link: { label: "Newsroom", href: "/newsroom" } },
        { title: "Events", text: "Breakfasts, talks and open evenings in our studios, only in the regions you choose.", pattern: "orbit", link: { label: "Our studios", href: "/about/locations" } },
        { title: "Careers", text: "New roles in the areas and studios you pick, and dates for our graduate program.", pattern: "rings", link: { label: "Careers", href: "/careers" } },
      ],
    },
    {
      type: "stats",
      eyebrow: "What to expect",
      heading: "Fewer emails, by design",
      items: [
        { value: "1 a month", label: "At most, for the research and perspectives digest." },
        { value: "Same day", label: "For news releases, if you choose News." },
        { value: "0", label: "Addresses passed to anyone outside KIASA." },
        { value: "1 click", label: "To unsubscribe from everything, from any email we send." },
      ],
    },
    {
      type: "accordion",
      eyebrow: "Questions",
      heading: "Common questions",
      items: [
        {
          title: "How do I unsubscribe from everything?",
          body: ["Use the unsubscribe link at the foot of any email, or clear every topic above and save. It takes effect at once, and we keep only a note of your address so we never write again."],
        },
        {
          title: "Why am I getting an email I did not ask for?",
          body: ["You may have chosen a topic some time ago, or a colleague may have entered your address. Unsubscribe from the email itself, and tell us at privacy@kiasa.tech so we can find out how it happened."],
        },
        {
          title: "Can I change my email address?",
          body: ["Yes. Unsubscribe the old address, then enter the new one above and choose your topics again."],
        },
        {
          title: "What do you do with my address?",
          body: ["We use it only to send what you chose. It is never sold or shared, and it is deleted when you unsubscribe."],
          link: { label: "Privacy statement", href: "/privacy" },
        },
      ],
    },
    {
      type: "cta",
      heading: "Prefer to talk?",
      text: "If you would rather hear from a person than an inbox, tell us what you are working on.",
      cta: { label: "Contact us", href: "/contact" },
      secondary: { label: "Privacy statement", href: "/privacy" },
    },
  ],
};

export const legalPages: PageDoc[] = [contact, sitemap, privacy, terms, cookies, accessibility, preferences];
