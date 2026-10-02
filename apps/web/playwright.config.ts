import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/warmup.ts",
  timeout: 20000,
  fullyParallel: true,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    // A few tests serve a rewritten homepage from Playwright itself. Chromium then
    // sees a non-local document reaching a loopback server and blocks the dev
    // server's HMR socket, so the page never hydrates. This lifts only that check.
    launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: "npm run dev -- --hostname 127.0.0.1", url: "http://127.0.0.1:3000", reuseExistingServer: true },
});
