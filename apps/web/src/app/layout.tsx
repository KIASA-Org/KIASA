import type { Metadata, Viewport } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import { bootstrapScript } from "@/components/intro/bootstrap";
import { company } from "@/content/site";
import "./globals.css";
import "@/styles/site.css";
import "@/styles/site-header.css";
import "@/styles/site-hero.css";
import "@/styles/site-featured.css";
import "@/styles/site-sections.css";
import "@/styles/site-pages.css";

// Self-hosted at build time: the browser makes no request to Google.
const grotesk = Schibsted_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-grotesk" });
const newsreader = Newsreader({ subsets: ["latin"], display: "swap", variable: "--font-newsreader", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: `${company.name} | ${company.tagline}`, template: `%s | ${company.name}` },
  description: company.description,
};
export const viewport: Viewport = { themeColor: "#030807", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${grotesk.variable} ${newsreader.variable}`} suppressHydrationWarning>
    {/* Runs before first paint, so the entrance never flashes the finished mark first. */}
    <head><script id="kiasa-intro-bootstrap" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: bootstrapScript() }} /></head>
    <body>{children}</body>
  </html>;
}
