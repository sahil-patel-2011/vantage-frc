import fs from "node:fs";
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

/**
 * Next 16 refuses a second `next dev` from the same apps/web directory.
 * Sibling checkouts (or a human who already started :3410) leave
 * `.next/dev/lock`. Attach to that origin instead of crashing.
 */
function liveNextDevLock(): { origin: string; port: number } | null {
  if (isCi || process.env.PLAYWRIGHT_BASE_URL) return null;
  const lockPath = path.join(__dirname, "apps/web/.next/dev/lock");
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      pid?: number;
      port?: number;
      hostname?: string;
      appUrl?: string;
    };
    if (!lock.pid || !lock.port) return null;
    process.kill(lock.pid, 0);
    const hostname = lock.hostname || "127.0.0.1";
    const origin = (lock.appUrl || `http://${hostname}:${lock.port}`).replace(/\/$/, "");
    return { origin, port: lock.port };
  } catch {
    return null;
  }
}

const lock = liveNextDevLock();
const origin = lock?.origin ?? playwrightOrigin();
const port = lock?.port ?? playwrightPort();
const hostname = cookieDomain(origin);

// session.ts reads PLAYWRIGHT_BASE_URL for the fixture cookie URL.
process.env.PLAYWRIGHT_BASE_URL = origin;

if (lock) {
  // eslint-disable-next-line no-console
  console.log(`Playwright attaching to existing next at ${origin} (pid in apps/web/.next/dev/lock)`);
}

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
  ...(lock
    ? {}
    : {
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
      }),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
