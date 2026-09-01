import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  // Two workers keep Next's dev compiler responsive on the Windows CI/dev box.
  workers: 2,
  use: {
    baseURL: "http://localhost:3310",
    trace: "retain-on-failure",
    storageState: {
      cookies: [
        {
          name: "vantage-analytics-consent",
          value: "denied.1",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },
  webServer: {
    command: "npm run dev:test --workspace=@vantage/web",
    url: "http://localhost:3310",
    env: { ...process.env, E2E_AUTH_FIXTURE: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
