import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { hubById } from "../../apps/web/lib/nav/hubs";
import { signInAs } from "./session";

test.use({ actionTimeout: 20_000 });
test.beforeEach(() => { test.setTimeout(120_000); });

for (const width of [390, 1440]) {
  test(`consolidated tools remain searchable and keyboard reachable at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner"), "Real seeded session required").toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/competition?tab=strategy");
    const strip = page.locator(".hub-tool-strip--compact").first();
    const trigger = strip.getByRole("button", { name: "More tools", exact: true });
    await expect(trigger).toBeVisible();
    await expect(strip.locator(".hub-tool-strip-row > :is(a,button)")).toHaveCount(1);
    await trigger.click();
    const search = strip.getByRole("searchbox", { name: "Find a tool" });
    await expect(search).toBeFocused();
    await search.fill("chemistry");
    await expect(strip.locator(".hub-tool-list :is(a,button)")).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await expect(strip.getByRole("link", { name: /^Chemistry/ }).or(strip.getByRole("button", { name: /^Chemistry/ }))).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(search).toHaveCount(0);
    await trigger.click();
    await search.fill("unlikely-no-tool-match");
    await expect(strip.getByRole("status")).toContainText("No tools match");
    await search.fill("");
    const displayed = await strip.locator(".hub-tool-list :is(a,button)").allTextContents();
    const expected = hubById("competition").tabs.filter(tab => tab.group === "strategy" && tab.inStrip !== false);
    for (const item of expected) expect(displayed.some(text => text.startsWith(item.label))).toBe(true);
    const audit = await new AxeBuilder({ page }).analyze();
    await info.attach("tools-accessibility.json", { body: JSON.stringify({ violations: audit.violations, incomplete: audit.incomplete }), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`tools-${width}.png`) });
    await search.fill("chemistry");
    await strip.getByRole("link", { name: /^Chemistry/ }).or(strip.getByRole("button", { name: /^Chemistry/ })).click();
    await expect(page).toHaveURL(/chemistry/);
    await expect(page.locator("[data-hub-tab='chemistry']")).toBeVisible({ timeout: 30_000 });
    const currentTool = page.locator(".hub-tool-strip--compact").first();
    await expect(currentTool.locator(".hub-tool-strip-row > button")).toHaveText("Chemistry");
    await currentTool.getByRole("button", { name: "Chemistry", exact: true }).click();
    await expect(currentTool.getByRole("searchbox", { name: "Find a tool" })).toBeFocused();
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
    await page.goto("/competition");
    await page.getByText("Event options", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy share link", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Change event", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy share link", exact: true })).toBeHidden();
  });
}
