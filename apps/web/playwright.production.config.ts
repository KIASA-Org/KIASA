import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  metadata: { production: true },
  use: { ...base.use, baseURL: "http://127.0.0.1:3001" },
  webServer: { command: "npm run start -- --hostname 127.0.0.1 --port 3001", url: "http://127.0.0.1:3001", reuseExistingServer: true },
});
