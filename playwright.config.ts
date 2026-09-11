import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  assertLocalFixtureDatabase,
  cookieDomain,
  playwrightOwnedOrigin,
  playwrightOwnedPort,
  playwrightWebServerEnv,
} from "./tests/browser/origin";

assertLocalFixtureDatabase();

const ARTIFACT_DIR = process.env.PLAYWRIGHT_ARTIFACT_DIR ?? "/opt/cursor/artifacts";
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const isCi = Boolean(process.env.CI);

/**
 * Next 16 refuses a second `next dev` from the same apps/web directory.
 * Sibling checkouts (or a human who already started :3410) leave
 * `.next/dev/lock`. Reuse that origin via webServer.reuseExistingServer.
 *
 * The default config always starts (or reuses) webServer. Attach to a
 * server you already started with `test:browser:attach`. A leftover
 * PLAYWRIGHT_BASE_URL used to skip the child next and attach to a dying
 * compiler (117-test OOM, then shard 1/4 connection-refused on :3560).
 */
function liveNextDevLock(): { origin: string; port: number } | null {
  const lockPath = path.join(__dirname, "apps/web/.next/dev/lock");
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      pid?: number;
      port?: number;
      hostname?: string;
      appUrl?: string;
    };
    if (!lock.pid || !lock.port) {
      fs.unlinkSync(lockPath);
      return null;
    }
    try {
      process.kill(lock.pid, 0);
    } catch {
      // Next refuses a second `next dev` while the lock file exists, even
      // when the pid is already gone. Drop the stale file so webServer can start.
      fs.unlinkSync(lockPath);
      return null;
    }
    // GitHub Actions / CI always starts its own webServer. A live lock on
    // a shared box is reused so two `next dev` processes do not fight.
    if (isCi) return null;
    const hostname = lock.hostname || "127.0.0.1";
    const origin = (lock.appUrl || `http://${hostname}:${lock.port}`).replace(/\/$/, "");
    return { origin, port: lock.port };
  } catch {
    return null;
  }
}

const lock = liveNextDevLock();
const port = lock?.port ?? playwrightOwnedPort();
const origin = lock?.origin || playwrightOwnedOrigin(port);
const hostname = cookieDomain(origin);

// session.ts reads PLAYWRIGHT_BASE_URL for the fixture cookie URL.
process.env.PLAYWRIGHT_BASE_URL = origin;

if (lock) {
  // eslint-disable-next-line no-console
  console.log(`Playwright reusing ${origin} via webServer.reuseExistingServer`);
}

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  // One worker is the GHA contract: two starve Next 16's compiler
  // (net::ERR_ABORTED / detached frames). Override with PLAYWRIGHT_WORKERS.
  // Shard with --shard=1/8 so one next-dev does not compile the whole catalog.
  fullyParallel: false,
  workers: Number(process.env.PLAYWRIGHT_WORKERS) || 1,
  retries: isCi ? 1 : 0,
  forbidOnly: isCi,
  timeout: isCi ? 45_000 : 90_000,
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
    env: playwrightWebServerEnv(origin, port),
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // 4 GB heap + fixture `devMemoryThresholdRestart: false` in next.config.
    // Compiling every route in one process used to restart next at 80% of heap.
    // Leftover PLAYWRIGHT_BASE_URL must not skip this child — attach uses fixture config.
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
