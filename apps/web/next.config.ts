import type { NextConfig } from "next";

// What every page may load, and who may show it. Only from this site, and from
// Supabase (its data, live changes and stored pictures); no other site may
// show a KIASA page inside its own (so none can trick a click on it); the
// camera, microphone and screen only for KIASA itself (meetings). Inline
// scripts stay allowed: Next writes each page's data into one.
const supabase = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").origin; } catch { return ""; }
})();
const live = supabase.replace(/^http/, "ws");
const policy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase}`,
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self' ${supabase} ${live}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...supabase.startsWith("https:") ? ["upgrade-insecure-requests"] : [],
].join("; ");
const guarded = [
  { key: "Content-Security-Policy", value: policy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  // Tailored résumés as PDFs (src/lib/resume): a headless Chromium prints them.
  // Its package finds its own files, so it is not bundled; and the prompts,
  // fonts and that Chromium go with the pages that use them.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/jobs": ["./src/lib/resume/prompts/**/*"],
    // (All of playwright-core: it reads files such as its browsers.json by a
    // path the tracer cannot follow, and the PDF fails without them.)
    "/jobs/resume/pdf": ["./src/lib/resume/fonts/**/*", "./node_modules/@sparticuz/chromium/bin/**/*", "./node_modules/playwright-core/**/*"],
    // The KIASA ChatGPT Bridge (a Chrome extension), zipped for members to install.
    "/jobs/bridge.zip": ["./bridge/**/*"],
  },
  // Every page guarded (above); and the service worker behind "Alert me on this
  // computer" (public/sw.js): never cached, so a change reaches every browser,
  // and allowed to run only this site's own script.
  async headers() {
    return [
      // (While developing, Next needs more than this allows.)
      ...process.env.NODE_ENV === "production" ? [{ source: "/:path*", headers: guarded }] : [],
      // (Later wins: the service worker keeps its own, stricter policy.)
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
