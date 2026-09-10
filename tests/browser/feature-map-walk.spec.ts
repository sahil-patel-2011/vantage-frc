import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { productRoutesFromFeatureMap } from "../../apps/web/lib/nav/feature-map-routes";
import { signInFixture } from "./session";

const FEATURE_MAP = readFileSync(join(__dirname, "../../docs/FEATURE_MAP.md"), "utf8");
const ROUTES = productRoutesFromFeatureMap(FEATURE_MAP);

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

/**
 * Fixture walk of every visit-able path named in FEATURE_MAP.
 *
 * E2E_AUTH_FIXTURE only passes the proxy — it mints no Better Auth session — so
 * this is not a signed-in student walk and APIs still 401. It still proves the
 * catalog does not 500 / "Application error" on first paint.
 *
 * Several FEATURE_MAP URLs client-redirect (e.g. `/account?tab=integrations`
 * → `/connectors`) or 307 to another path (`/help/hub-access` → `/docs/hub-access`).
 * `waitUntil: "commit"` avoids waiting on every client chunk; a dead `next dev`
 * aborts the rest of the catalog instead of retrying 70 refused sockets.
 */
async function visitRoute(page: Page, route: string): Promise<string | null> {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.goto(route, { waitUntil: "commit", timeout: 45_000 });
      const status = response?.status() ?? 0;
      if (status >= 500) return `${route} HTTP ${status}`;
      await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
      await expect(page.locator("body")).not.toContainText(/Application error/i, {
        timeout: 8_000,
      });
      return null;
    } catch (error) {
      lastError = error instanceof Error ? error.message.split("\n")[0]! : String(error);
      if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ECONNREFUSED/i.test(lastError) && attempt === 3) {
        return `${route} ${lastError}`;
      }
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  return `${route} ${lastError}`;
}

function serverDied(failure: string): boolean {
  return /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ECONNREFUSED/i.test(failure);
}

async function walkFeatureMapRoutes(page: Page, routes: string[]) {
  const failures: string[] = [];
  let lastOk: string | null = null;
  for (const route of routes) {
    const failure = await visitRoute(page, route);
    if (!failure) {
      lastOk = route;
      continue;
    }
    if (serverDied(failure)) {
      failures.push(
        `${failure} (dev server died after ${lastOk ?? "the first route"}; remaining routes not retried)`,
      );
      break;
    }
    failures.push(failure);
  }
  expect(failures, `FEATURE_MAP walk failures:\n  ${failures.join("\n  ")}`).toEqual([]);
}

test.describe("FEATURE_MAP fixture walk", () => {
  test.describe.configure({ mode: "serial" });

  test("catalog is large enough to be the map, not eight hubs", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(80);
    expect(ROUTES).toContain("/dashboard");
    expect(ROUTES).toContain("/connectors");
  });

  test("FEATURE_MAP product routes render without a 500", async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await walkFeatureMapRoutes(page, ROUTES);
  });
});
