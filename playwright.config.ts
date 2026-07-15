import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: "http://localhost:3310", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:test --workspace=@vantage/web",
    url: "http://localhost:3310",
    env: { ...process.env, E2E_AUTH_FIXTURE: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
