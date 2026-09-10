import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { productRoutesFromFeatureMap } from "../../apps/web/lib/nav/feature-map-routes";
import { signInFixture } from "./session";

const FEATURE_MAP = readFileSync(join(__dirname, "../../docs/FEATURE_MAP.md"), "utf8");
const ROUTES = productRoutesFromFeatureMap(FEATURE_MAP);
const SPLIT = Math.ceil(ROUTES.length / 2);

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

/**
 * Fixture walk of every visit-able path named in FEATURE_MAP.
 *
 * E2E_AUTH_FIXTURE only passes the proxy — it mints no Better Auth session — so
 * this is not a signed-in student walk and APIs still 401. It still proves the
 * catalog does not 500 / "Application error" on first paint.
 */
async function walkFeatureMapRoutes(
  page: import("@playwright/test").Page,
  routes: string[],
) {
  const failures: string[] = [];
  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const status = response?.status() ?? 0;
    const crashed = await page.locator("body").evaluate((body) =>
      /Application error/i.test(body.textContent ?? ""),
    );
    if (status >= 500 || crashed) {
      failures.push(`${route} HTTP ${status}${crashed ? " application-error" : ""}`);
    }
  }
  expect(failures, `FEATURE_MAP walk failures:\n  ${failures.join("\n  ")}`).toEqual([]);
}

test.describe("FEATURE_MAP fixture walk", () => {
  test("catalog is large enough to be the map, not eight hubs", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(80);
    expect(ROUTES).toContain("/dashboard");
    expect(ROUTES).toContain("/connectors");
  });

  test("first half of FEATURE_MAP routes render", async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await walkFeatureMapRoutes(page, ROUTES.slice(0, SPLIT));
  });

  test("second half of FEATURE_MAP routes render", async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await walkFeatureMapRoutes(page, ROUTES.slice(SPLIT));
  });
});
