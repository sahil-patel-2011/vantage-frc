import { expect, test } from "@playwright/test";
import { PRIMARY_CONTROL_SELECTOR } from "../../apps/web/lib/ui/primary-control";
import { signInFixture } from "./session";

/**
 * R4 — at most one primary control visible on a screen. Marketing and signed-in
 * product shells are both in scope: a student should never face two equally
 * loud buttons and have to guess.
 */
const PUBLIC_ROUTES = ["/", "/pricing", "/signin"];
const PRODUCT_ROUTES = ["/dashboard", "/team", "/build", "/competition", "/business"];

async function visiblePrimaryCount(page: import("@playwright/test").Page): Promise<number> {
  return page.locator(PRIMARY_CONTROL_SELECTOR).evaluateAll((nodes) =>
    nodes.filter((node) => {
      const el = node as HTMLElement;
      if (!(el instanceof HTMLElement)) return false;
      if (el.getAttribute("hidden") != null) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length,
  );
}

test.describe("R4 one primary per screen", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`public ${route} has at most one primary control`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      const count = await visiblePrimaryCount(page);
      expect(count, `${route} has ${count} visible primary controls`).toBeLessThanOrEqual(1);
    });
  }

  test.describe("signed-in product", () => {
    test.beforeEach(async ({ context }) => {
      await signInFixture(context);
    });

    for (const route of PRODUCT_ROUTES) {
      test(`${route} has at most one primary control`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("domcontentloaded");
        const count = await visiblePrimaryCount(page);
        expect(count, `${route} has ${count} visible primary controls`).toBeLessThanOrEqual(1);
      });
    }
  });
});
