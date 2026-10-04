/** KIASA Canopy: the managed platform team announced on the homepage, with a
 * page of its own in the form of the model's practice pages. Sample content,
 * like the rest of the site. */
export const canopy = {
  href: "/canopy",
  name: "KIASA Canopy",
  description: "A standing team that runs your cloud platform, keeps it secure and reports back each month in plain language.",
  /** The practice's own header: back to the firm, who we are, how to reach us. */
  navigation: [
    { label: "Home", href: "/" },
    { label: "Who we are", href: "/about" },
    { label: "Contact us", href: "/contact" },
  ],
  hero: {
    headline: ["You own the outcome.", "We handle the complexity."],
    body: [
      "KIASA Canopy brings platform engineering, cloud operations, security and plain-language reporting together under one standing team, so a mid-size enterprise can run its platform like a large one without building the department to do it.",
      "One team, accountable from your first decision to every month your platform runs.",
    ],
    cta: { label: "Talk to us", href: "/contact" },
    imageAlt: "A golden footbridge held up by two giant stone hands above a forested mountain ridge at sunrise.",
  },
} as const;
