import { defineConfig, devices } from "@playwright/test";

/**
 * Same suite, pointed at a dev server you started yourself.
 *
 * `playwright.config.ts` owns its own webServer on 3310, and Next refuses a
 * second dev server from the same app directory — so when a server is already
 * up (a worktree on its own port, a shared box with several checkouts) that
 * config either fights it or silently reuses somebody else's build. This one
 * attaches to `PLAYWRIGHT_BASE_URL` and starts nothing.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3413";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 2,
  use: {
    baseURL,
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
