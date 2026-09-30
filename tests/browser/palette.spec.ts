import { expect, test, type Page } from "@playwright/test";
import { contrastRatio } from "../../apps/web/lib/branding/colors";
import { signInAs } from "./session";
import { openNav, primaryNavigation } from "./nav";

async function palette(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["bg", "surface", "ink", "muted", "accent", "accent-ink", "positive", "critical", "warning", "alliance-blue"]
        .map((name) => [name, style.getPropertyValue(`--${name}`).trim()]),
    );
  });
}

test.afterEach(async ({ context }) => {
  // These journeys share the seeded owner with other specs. Restore its theme.
  const response = await context.request.put("/api/theme", { data: { theme: "light" } });
  expect(response.ok()).toBe(true);
});

for (const width of [390, 1440]) {
  test(`theme choices preserve contrast and navigation at ${width}px`, async ({ page, context }, testInfo) => {
    expect(await signInAs(context, "owner"), "The seeded owner must sign in").toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/account?tab=appearance");
    const themes = page.getByRole("radiogroup", { name: "Color theme" });
    await expect(themes).toBeVisible({ timeout: 30_000 });

    for (const name of ["Light", "Dark"]) {
      await themes.getByRole("radio", { name, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", name.toLowerCase());
      const colors = await palette(page);
      expect(await page.locator("body").evaluate((body) => {
        const style = getComputedStyle(body);
        return Object.fromEntries(["bg", "surface", "ink", "muted", "accent"].map((token) => [token, style.getPropertyValue(`--${token}`).trim()]));
      }), "Product chrome inherits the shared palette").toMatchObject({
        bg: colors.bg, surface: colors.surface, ink: colors.ink, muted: colors.muted, accent: colors.accent,
      });
      await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", colors.bg);
      for (const token of ["ink", "muted", "accent", "positive", "critical", "warning", "alliance-blue"]) {
        expect(contrastRatio(colors[token], colors.surface), `${name}: ${token} on cards`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(colors.accent, colors["accent-ink"]), `${name}: filled action`).toBeGreaterThanOrEqual(4.5);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${name}: no horizontal scrolling`).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`appearance-${name.toLowerCase()}.png`), fullPage: true });
    }

    const manualDark = await palette(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await themes.getByRole("radio", { name: /^System/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await palette(page), "System dark and manual dark use one palette").toEqual(manualDark);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.goto("/dashboard");
    await expect(primaryNavigation(page)).toBeVisible();
    await expect(page.getByTestId("dash-customize")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("home-light.png"), fullPage: true });
    await openNav(page);
    await page.screenshot({ path: testInfo.outputPath("navigation-light.png") });
    await page.keyboard.press("Escape");
    await expect(primaryNavigation(page)).toBeVisible();
  });
}
