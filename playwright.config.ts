import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  assertLocalFixtureDatabase,
  cookieDomain,
  playwrightOrigin,
  playwrightPort,
} from "./tests/browser/origin";

assertLocalFixtureDatabase();

const isCi = Boolean(process.env.CI);
const origin = playwrightOrigin();
const port = playwrightPort();
const hostname = cookieDomain(origin);

// session.ts reads PLAYWRIGHT_BASE_URL for the fixture cookie URL.
process.env.PLAYWRIGHT_BASE_URL = origin;

export default defineConfig({
  testDir: "./tests/browser",
  // One worker is the GHA contract: two starve Next 16's compiler
  // (net::ERR_ABORTED / detached frames). Override with PLAYWRIGHT_WORKERS.
  workers: Number(process.env.PLAYWRIGHT_WORKERS) || 1,
  retries: isCi ? 1 : 0,
  forbidOnly: isCi,
  timeout: isCi ? 45_000 : 30_000,
  reporter: isCi ? [["line"], ["html"]] : [["list"], ["html"]],
  use: {
    baseURL: origin,
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
  webServer: {
    command: `npx next dev --port ${port} --hostname 127.0.0.1`,
    cwd: path.join(__dirname, "apps/web"),
    url: origin,
    env: {
      ...process.env,
      NODE_ENV: "development",
      E2E_AUTH_FIXTURE: "1",
      PLAYWRIGHT_BASE_URL: origin,
      AUTH_TRUSTED_ORIGINS: [
        process.env.AUTH_TRUSTED_ORIGINS,
        origin,
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ]
        .filter(Boolean)
        .join(","),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
