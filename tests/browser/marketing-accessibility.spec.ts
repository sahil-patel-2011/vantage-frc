import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = ["/", "/features", "/workflow", "/for-teams", "/pricing", "/features/cad", "/features/code", "/features/strategy"];

for (const width of [390, 1280]) {
  test.describe(`marketing at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const route of routes) {
      test(`${route} has readable structure and no detected accessibility violations`, async ({ page }, testInfo) => {
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const audit = await new AxeBuilder({ page }).analyze();
        await testInfo.attach("accessibility", { body: JSON.stringify({ violations: audit.violations, incomplete: audit.incomplete }), contentType: "application/json" });
        expect(audit.violations).toEqual([]);
      });
    }
  });
}

test("phone workspace links work, menu returns focus, and offline scope is explained", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  const map = page.locator(".mk-workspace-map");
  await expect(map).toContainText("Product overview");
  const competition = map.getByRole("link", { name: /Competition/ });
  const bounds = await competition.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(48);
  expect(bounds?.height).toBeGreaterThanOrEqual(48);
  await competition.click();
  await expect(page).toHaveURL(/\/features#competition$/);
  await expect(page.locator("#competition")).toBeInViewport();
  const menu = page.getByLabel("Open navigation", { exact: true });
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await menu.press("Escape");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
  await expect(menu).toBeFocused();
  await page.goto("/");
  await page.getByText("Does scouting work offline?", { exact: true }).click();
  await expect(page.locator("#faq-does-scouting-work-offline")).toContainText("still need a connection");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
