import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: "http://localhost:3310", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:test --workspace=@vantage/marketing",
    url: "http://localhost:3310",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
