import { defineConfig, devices } from "@playwright/test";
import { assertLocalFixtureDatabase, cookieDomain } from "./tests/browser/origin";

assertLocalFixtureDatabase();

/**
 * Same suite, pointed at a dev server you started yourself.
 *
 * `playwright.config.ts` owns its own webServer (default :3310), and Next
 * refuses a second dev server from the same app directory — so when a server
 * is already up (a worktree on its own port, a shared box with several
 * checkouts) that config either fights it or silently reuses somebody else's
 * build. This one attaches to `PLAYWRIGHT_BASE_URL` and starts nothing.
 *
 *   E2E_AUTH_FIXTURE=1 NODE_ENV=development npm run dev:test --workspace=@vantage/web
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3310 npm run test:browser:attach
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3413";
process.env.PLAYWRIGHT_BASE_URL = baseURL;
const hostname = cookieDomain(baseURL);

export default defineConfig({
  testDir: "./tests/browser",
  workers: Number(process.env.PLAYWRIGHT_WORKERS) || 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    storageState: {
      cookies: [
        {
          name: "vantage-analytics-consent",
          value: "denied.1",
          domain: hostname,
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
