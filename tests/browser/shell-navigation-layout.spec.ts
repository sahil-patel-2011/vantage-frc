import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";
import { openNav } from "./nav";

test("one navigation surface survives routes and desktop breakpoint changes", async ({ page, context }, info) => {
  test.setTimeout(180_000);
  expect(await signInAs(context, "owner")).toBe(true);
  for (const width of [390, 768, 1023, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const hamburger = page.getByRole("button", { name: "Menu and search", exact: true });
    await expect(page.locator(".soft-topbar")).toHaveCount(1);
    await expect(page.locator(".vrail")).toHaveCount(1);
    await expect(page.locator(".soft-drawer")).toHaveCount(1);
    if (width < 1024) {
      await expect(hamburger).toBeVisible();
      await expect(page.locator(".vrail")).toBeHidden();
    } else {
      await expect(hamburger).toBeHidden();
      await expect(page.locator(".vrail")).toBeVisible();
    }
    await openNav(page);
    const panel = page.getByRole("complementary", { name: "Product navigation", exact: true });
    await expect(panel).toBeVisible();
    await expect(hamburger).toBeHidden();
    await expect(page.locator(".vrail")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Primary apps", exact: true })).toBeHidden();
    await expect.poll(() => panel.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    if (width >= 1024) {
      await expect.poll(() => panel.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
      })).toBeLessThan(2);
    }
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState !== "running"));
    const audit = await new AxeBuilder({ page }).analyze();
    await info.attach(`navigation-${width}.json`, { body: JSON.stringify(audit), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`navigation-${width}.png`) });
    await panel.getByRole("link", { name: "Competition", exact: true }).click();
    await expect(page).toHaveURL(/\/competition/);
    await expect(panel).toBeHidden();
    await expect(page.locator(".soft-topbar")).toHaveCount(1);
    await expect(page.getByRole("tab", { name: "Event day", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  for (const [from, to] of [[390, 1440], [1440, 390]]) {
    await page.setViewportSize({ width: from, height: 900 });
    await openNav(page);
    await page.setViewportSize({ width: to, height: 900 });
    await page.keyboard.press("Escape");
    const opener = to >= 1024 ? page.locator(".vrail-search") : page.getByRole("button", { name: "Menu and search", exact: true });
    await expect(opener).toBeVisible();
    await expect(opener).toBeFocused();
  }
});
