import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import { signInAs } from "./session";

test.use({ actionTimeout: 15_000 });

const routes = [
  "/dashboard", "/competition", "/competition?tab=scouting", "/competition?tab=strategy", "/competition?tab=teams", "/competition?tab=picks", "/competition?tab=command", "/competition?tab=match-checklist",
  "/team", "/team?tab=attendance", "/team?tab=todos", "/team?tab=knowledge",
  "/build", "/build?tab=cad", "/build?tab=code", "/build?tab=fmea",
  "/business", "/business?tab=finance", "/business?tab=sponsors", "/business?tab=evidence",
  "/ai", "/ai?tab=writer", "/ai?tab=agent", "/ai?tab=budgets", "/ai?tab=decisions",
  "/account", "/notifications", "/inventory", "/forms", "/help", "/security",
];

for (const width of [320, 768, 1440]) {
  test(`shared chrome stays usable across core pages at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(300_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const report: Array<{ route: string; status: number; overflow: boolean; options: number }> = [];
    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }).first(), route).toBeVisible({ timeout: 25_000 });
      const trigger = page.locator(".workspace-hub-header .section-select select");
      if (await trigger.count()) await expect(trigger, route).toBeEnabled({ timeout: 25_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow, route).toBe(false);
      const actionGroups = page.locator(".app-page-header > .app-page-actions");
      for (const actions of await actionGroups.all()) {
        const count = await actions.locator(".primary, .is-primary").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length > 0).length);
        expect(count, `${route}: primary header actions`).toBeLessThanOrEqual(1);
        const names = await actions.locator("button, a, summary").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length > 0).map(node => node.getAttribute("aria-label") || node.textContent?.trim()).filter(Boolean));
        expect(new Set(names).size, `${route}: duplicate header controls`).toBe(names.length);
      }
      report.push({ route, status: response!.status(), overflow, options: await page.locator(".page-options").count() });
    }
    expect(errors).toEqual([]);
    const path = info.outputPath(`core-pages-${width}.json`);
    await writeFile(path, JSON.stringify({ width, report, errors }, null, 2));
    await info.attach(`core-pages-${width}.json`, { path, contentType: "application/json" });
  });
}

test("page options keep forms, filters and help operable", async ({ page, context }) => {
  test.setTimeout(120_000);
  expect(await signInAs(context, "owner")).toBe(true);
  await page.goto("/inventory");
  await expect(page.getByRole("button", { name: "Add a part", exact: true })).toBeVisible();
  const labels = page.getByRole("button", { name: "Scan / labels", exact: true });
  await labels.click();
  const tools = page.locator(".inventory-label-tools");
  await expect(tools.getByRole("heading", { name: "Find a bin instantly", exact: true })).toBeVisible();
  await tools.getByRole("button", { name: "Close", exact: true }).click();
  await expect(tools).toHaveCount(0);
  await page.getByRole("button", { name: "Add a part", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Unsaved navigation check");
  await labels.click();
  const audit = await new AxeBuilder({ page }).include(".inventory-label-tools").analyze();
  expect(audit.violations).toEqual([]);
  await tools.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Unsaved navigation check");
  await page.goto("/notifications");
  const filters = page.getByRole("combobox", { name: "Inbox filters", exact: true });
  await filters.selectOption("unread");
  await expect(filters).toHaveValue("unread");
});
