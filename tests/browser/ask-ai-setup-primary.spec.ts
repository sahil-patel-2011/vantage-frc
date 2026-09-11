import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Ask AI usage setup keeps one Choose your team primary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/team/usage");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("main")).not.toContainText("pick a team first");
  await expect(page.locator("main")).not.toContainText("Pick a team first");
  await expect(page.getByRole("heading", { name: "Choose your team" })).toBeVisible();
  const choose = page.locator("main").getByRole("link", { name: "Choose your team" });
  await expect(choose).toHaveCount(1);
  await expect(choose).toHaveAttribute("href", "/workspace");
  await expect(page.locator("main").getByRole("link", { name: "Account" })).toHaveCount(0);
  await expect(page.locator("main").getByRole("link", { name: "Pricing" })).toHaveCount(0);
  await expect(page.locator("main").getByRole("link", { name: "Chat" })).toHaveCount(0);
});
