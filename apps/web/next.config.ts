import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The service worker behind "Alert me on this computer" (public/sw.js): never
  // cached, so a change reaches every browser, and allowed to run only this
  // site's own script.
  async headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    }];
  },
};

export default nextConfig;
