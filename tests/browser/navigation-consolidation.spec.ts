import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

test.use({ actionTimeout: 20_000 });
test.beforeEach(() => { test.setTimeout(120_000); });

for (const width of [390, 1440]) {
  test(`consolidated tools remain searchable and keyboard reachable at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner"), "Real seeded session required").toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/competition?tab=strategy");
    const trigger = page.getByRole("button", { name: "Menu and search", exact: true });
    await expect(page.locator(".workspace-picker-trigger")).toHaveCount(0);
    await expect(page.locator(".workspace-hub-header select")).toHaveCount(0);
    await trigger.click();
    const search = page.getByRole("combobox", { name: "Search pages, tools, and your team's data", exact: true });
    await expect(search).toBeFocused();
    await search.fill("chemistry");
    const result = page.getByRole("option", { name: /^Chemistry/ });
    await expect(result).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", /soft-nav-row-/);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await search.fill("chemistry");
    const audit = await new AxeBuilder({ page }).include(".soft-drawer").analyze();
    await info.attach("tools-accessibility.json", { body: JSON.stringify({ violations: audit.violations }), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`tools-${width}.png`) });
    await result.click();
    await expect(page).toHaveURL(/chemistry/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test(`scouting report tools and code options stay available without crowding primary work at ${width}px`, async ({ page, context }) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/competition?tab=scouting");
    const lead = page.locator(".scout-lead-tools");
    await expect(lead.locator("summary")).toBeVisible({ timeout: 25_000 });
    await expect(lead).not.toHaveAttribute("open");
    await expect(page.getByRole("link", { name: "Export all match scouting", exact: true })).toBeHidden();
    await lead.locator("summary").click();
    await expect(page.getByRole("link", { name: "Export all match scouting", exact: true })).toBeVisible();
    await expect(lead.locator(".scout-report-open").first()).toBeVisible();
    await page.goto("/build?tab=code");
    const options = page.locator(".cdc-options");
    await expect(options.locator("summary")).toBeVisible({ timeout: 30_000 });
    await expect(options).not.toHaveAttribute("open");
    await expect(page.getByRole("textbox", { name: "Source code", exact: true })).toBeVisible();
    await options.locator("summary").click();
    await expect(options.getByRole("heading", { name: "Hosted API · published prices", exact: true })).toBeVisible();
    await expect(options.getByRole("link", { name: "AI keys", exact: true })).toBeVisible();
    await page.goto("/competition?tab=command");
    await page.getByText("Event options", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy share link", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Change event", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy share link", exact: true })).toBeHidden();
  });
}
