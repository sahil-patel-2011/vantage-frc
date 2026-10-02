import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./session";

const orgId = "6925a000-0000-4000-8000-000000000001";

for (const width of [390, 1440]) {
  test(`product surfaces remain readable and accessible in both themes at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    const original = await (await context.request.get("/api/theme")).json();
    await page.setViewportSize({ width, height: 900 });
    try {
      for (const name of ["Light", "Dark"]) {
        await page.goto(`/account?tab=appearance&orgId=${orgId}`);
        const themes = page.getByRole("group", { name: "Color theme", exact: true });
        await expect(themes).toBeVisible({ timeout: 30_000 });
        await themes.getByRole("radio", { name, exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", name.toLowerCase());
        expect((await new AxeBuilder({ page }).include(".account-page").analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`settings-${name.toLowerCase()}-${width}.png`), fullPage: true });

        await page.goto(`/dashboard?orgId=${orgId}`);
        await expect(page.locator(".dash-widget").first()).toBeVisible({ timeout: 30_000 });
        expect(await page.locator("body").evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/inter/i);
        expect((await new AxeBuilder({ page }).include(".dash-home").analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole("button", { name: "Menu and search", exact: true })).toHaveAttribute("aria-expanded", "false");
        await page.screenshot({ path: info.outputPath(`home-${name.toLowerCase()}-${width}.png`), fullPage: true });

        await page.goto(`/competition?tab=scouting&mode=free&orgId=${orgId}`);
        await expect(page.getByRole("radio", { name: "Pit", exact: true })).toBeChecked({ timeout: 30_000 });
        await page.getByLabel("Team number", { exact: true }).fill("254");
        await page.getByRole("button", { name: "Start scouting", exact: true }).click();
        await page.getByRole("radiogroup", { name: "Drivetrain", exact: true }).getByRole("radio", { name: "Swerve", exact: true }).click();
        expect((await new AxeBuilder({ page }).include(".free-scout").analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`pit-${name.toLowerCase()}-${width}.png`), fullPage: true });
        page.once("dialog", dialog => dialog.accept());
        await page.getByRole("button", { name: "Cancel report", exact: true }).click();
        await expect(page.getByRole("button", { name: "Start scouting", exact: true })).toBeVisible();
      }
    } finally {
      expect((await context.request.put("/api/theme", { data: { theme: original.theme } })).ok()).toBe(true);
    }
  });
}
