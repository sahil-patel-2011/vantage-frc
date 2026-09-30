import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./session";
import { gotoAsTeam } from "./active-org";

test.beforeEach(async ({ context }) => {
  expect(await signInAs(context, "owner"), "Seeded owner must authenticate").toBe(true);
});

for (const width of [320, 768, 1440]) {
  test(`AI workspace consolidates navigation and preserves unfinished work at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    expect(await gotoAsTeam(page, "/ai")).toBeTruthy();
    const mode = page.getByRole("combobox", { name: "AI workspace mode" });
    await expect(mode).toHaveValue("chat");
    await expect(page.getByRole("tablist", { name: "AI sections" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Related AI and season tools" })).toHaveCount(0);
    await expect(page.locator(".ch-layout")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`ai-chat-${width}.png`), fullPage: true });
    await mode.selectOption("agent");
    await expect(page).toHaveURL(/tab=agent/);
    const goal = page.getByRole("textbox", { name: "Goal", exact: true });
    await goal.fill("Unsaved goal retained when writing a draft");
    await mode.selectOption("writer");
    await expect(page).toHaveURL(/tab=writer/);
    const draftType = page.getByRole("combobox", { name: "Draft type" });
    await expect(draftType.locator("option")).toHaveCount(6);
    await expect(page.getByLabel("Mission (1–2 sentences)")).not.toBeVisible();
    const profileToggle = page.locator(".writer-profile-disclosure > summary");
    await profileToggle.press("Enter");
    const mission = page.getByLabel("Mission (1–2 sentences)");
    await mission.fill("Unsaved team profile used only in this preview");
    await profileToggle.press("Enter");
    await expect(mission).not.toBeVisible();
    await draftType.selectOption("grant");
    const prompt = page.getByLabel("Grant question / prompt");
    await prompt.fill("Unsaved question retained when reviewing settings");
    await draftType.selectOption("sponsorship_ask");
    await expect(page.getByLabel("Sponsor / org name")).toBeVisible();
    await draftType.selectOption("grant");
    await expect(prompt).toHaveValue("Unsaved question retained when reviewing settings");
    const writerAudit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(writerAudit.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`ai-write-${width}.png`), fullPage: true });

    const tools = page.getByRole("button", { name: "AI tools: Tools", exact: true });
    await tools.click();
    await page.getByRole("menuitem", { name: "Limits & settings", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Limits & settings", exact: true });
    await expect(panel).toBeVisible();
    await expect(page.locator(".ai-workspace-toolbar").getByRole("button")).toHaveCount(1);
    await expect(page).toHaveURL(/tab=budgets/);
    await expect(panel.getByText("Loading", { exact: true })).toHaveCount(0, { timeout: 20_000 });
    await panel.getByRole("button", { name: "Close dialog" }).press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(tools).toBeFocused();
    await expect(mode).toHaveValue("writer");
    await expect(prompt).toHaveValue("Unsaved question retained when reviewing settings");
    await expect(mission).toHaveValue("Unsaved team profile used only in this preview");
    await mode.selectOption("chat");
    await expect(page.locator(".ch-page")).toBeVisible();
    await mode.selectOption("agent");
    await expect(goal).toHaveValue("Unsaved goal retained when writing a draft");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`ai-workspace-${width}.png`), fullPage: true });
  });
}

test("legacy Notes link opens a focused panel and returns to the workspace", async ({ page }) => {
  test.setTimeout(90_000);
  expect(await gotoAsTeam(page, "/ai?tab=decisions")).toBeTruthy();
  const panel = page.getByRole("dialog", { name: "Notes", exact: true });
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await panel.getByRole("button", { name: "Close dialog" }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole("combobox", { name: "AI workspace mode" })).toHaveValue("chat");
  await expect(page.locator(".ch-page")).toBeVisible();
  await expect(page).not.toHaveURL(/tab=decisions/);
});
