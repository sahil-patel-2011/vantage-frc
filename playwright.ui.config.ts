import { defineConfig } from "@playwright/test";

// Presentation and client-interaction tests only. API responses are intercepted;
// the isolated application server has no database or provider credentials.
const origin = "http://127.0.0.1:3419";
process.env.PLAYWRIGHT_BASE_URL = origin;
export default defineConfig({
  testDir: "tests/ui",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: "test-results/ui",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/ui", open: "never" }]],
  use: { baseURL: origin, browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node scripts/start-gui-audit.mjs --database-free",
    url: `${origin}/privacy`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PLAYWRIGHT_BASE_URL: origin },
  },
});
