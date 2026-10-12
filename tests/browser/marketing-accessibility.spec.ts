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

test("phone season links work, the menu traps and returns focus, and offline scope is explained", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  // The four parts of the season are full-width rows on a phone, each a link to its section.
  const scout = page.locator(".mx-four").getByRole("link", { name: /Scout/ });
  const bounds = await scout.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(48);
  expect(bounds?.height).toBeGreaterThanOrEqual(48);
  await scout.click();
  await expect(page).toHaveURL(/#scout$/);
  await expect(page.locator("#scout")).toBeInViewport();
  // The menu: a dialog with the page links and one action, focus inside it, Escape closes it
  // and puts focus back on the button.
  const menu = page.getByRole("banner").getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  const dialog = page.getByRole("dialog", { name: "Menu" });
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Home" })).toBeFocused();
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
  await expect(menu).toBeFocused();
  await page.goto("/");
  await page.getByText("Does scouting work offline?", { exact: true }).click();
  await expect(page.locator("#faq-does-scouting-work-offline")).toContainText("still need a connection");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
