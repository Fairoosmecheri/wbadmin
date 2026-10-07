import "dotenv/config";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: "list",
  use: { baseURL: process.env.APP_URL || "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure", ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] } },
  webServer: { command: "npm run dev", url: process.env.APP_URL || "http://localhost:3000", reuseExistingServer: true, timeout: 60000 },
});
