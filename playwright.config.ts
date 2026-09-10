import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/browser",
  // Two workers keep Next's dev compiler responsive on the Windows CI/dev box.
  // On ubuntu-latest GHA, two workers starve Next 16's compiler and abort
  // navigations (net::ERR_ABORTED / detached frames). One worker + one retry
  // is the CI contract. Signed-in specs still skip when signInAs cannot reach
  // Postgres — this job does not start a database.
  workers: isCi ? 1 : 2,
  retries: isCi ? 1 : 0,
  forbidOnly: isCi,
  timeout: isCi ? 45_000 : 30_000,
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
    env: {
      ...process.env,
      E2E_AUTH_FIXTURE: "1",
      AUTH_TRUSTED_ORIGINS: [
        process.env.AUTH_TRUSTED_ORIGINS,
        "http://localhost:3310",
        "http://127.0.0.1:3310",
      ]
        .filter(Boolean)
        .join(","),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
