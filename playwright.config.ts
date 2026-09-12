import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  assertLocalFixtureDatabase,
  cookieDomain,
  playwrightOrigin,
  playwrightPort,
  playwrightWebServerEnv,
  shouldReuseLiveNextDevLock,
} from "./tests/browser/origin";

assertLocalFixtureDatabase();

const ARTIFACT_DIR = process.env.PLAYWRIGHT_ARTIFACT_DIR ?? "/opt/cursor/artifacts";
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const isCi = Boolean(process.env.CI);

/**
 * Next 16 refuses a second `next dev` from the same apps/web directory.
 * Sibling checkouts (or a human who already started :3410) leave
 * `.next/dev/lock`. Attach to that origin instead of crashing.
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

process.env.NEXT_DIST_DIR ??= ".next-pw";

// A worker re-import sees PLAYWRIGHT_BASE_URL after the parent set it for
// cookies. That is not attach mode — PLAYWRIGHT_OWNED_SERVER marks our server.
const ownedServer = process.env.PLAYWRIGHT_OWNED_SERVER === "1";
const explicitBase = ownedServer ? "" : process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "") || "";
const lock = shouldReuseLiveNextDevLock() ? liveNextDevLock() : null;
const origin = explicitBase || lock?.origin || playwrightOrigin();
const port = lock?.port ?? playwrightPort();
const hostname = cookieDomain(origin);
// A live lock only tells us which port to reuse. Skipping webServer entirely
// meant a crashed leftover `next dev` took the rest of the suite with it.
const startWebServer = !explicitBase;

// session.ts reads PLAYWRIGHT_BASE_URL for the fixture cookie URL.
process.env.PLAYWRIGHT_BASE_URL = origin;
if (startWebServer) process.env.PLAYWRIGHT_OWNED_SERVER = "1";

if (explicitBase) {
  console.log(`Playwright attaching to ${origin} (PLAYWRIGHT_BASE_URL, no webServer)`);
} else if (lock) {
  console.log(`Playwright reusing ${origin} via webServer.reuseExistingServer`);
}

export default defineConfig({
  testDir: "./tests/browser",
  // Vitest unit files live beside specs (`origin.test.ts`). Do not collect them.
  testMatch: "**/*.spec.ts",
  // One worker is the GHA contract: two starve Next 16's compiler
  // (net::ERR_ABORTED / detached frames). Override with PLAYWRIGHT_WORKERS.
  workers: Number(process.env.PLAYWRIGHT_WORKERS) || 1,
  retries: isCi ? 1 : 0,
  forbidOnly: isCi,
  timeout: isCi ? 45_000 : 90_000,
  reporter: [
    [isCi ? "line" : "list"],
    ["html", { open: "never" }],
  ],
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
  ...(startWebServer
    ? {
        webServer: {
          command: `npx next dev --port ${port} --hostname 127.0.0.1`,
          cwd: path.join(__dirname, "apps/web"),
          url: origin,
          env: playwrightWebServerEnv(origin, port),
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }
    : {}),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
