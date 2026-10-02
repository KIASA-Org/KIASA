import type { Metadata, Viewport } from "next";
import { bootstrapScript } from "@/components/intro/bootstrap";
import "./globals.css";

export const metadata: Metadata = { title: "KIASA", description: "Welcome to KIASA." };
export const viewport: Viewport = { themeColor: "#030807", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning>
    {/* Runs before first paint, so the entrance never flashes the finished mark first. */}
    <head><script id="kiasa-intro-bootstrap" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: bootstrapScript() }} /></head>
    <body>{children}</body>
  </html>;
}
