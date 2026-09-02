// Temporary: run the browser specs against the already-running fixture server
// on 3402 (scripts/dev-fixture.mjs) instead of spawning a second dev server.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3402", trace: "retain-on-failure" },
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
