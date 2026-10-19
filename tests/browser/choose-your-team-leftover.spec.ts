import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";
import { openSearch, primaryNavigation, searchPalette } from "./nav";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("the bottom bar, search and Chat never say Pick a team", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.locator("body")).not.toContainText("Application error");

  // No menu drawer: the bottom bar is the five places, and search (with pins) is the rest.
  await expect(primaryNavigation(page)).toBeVisible();
  await expect(primaryNavigation(page)).not.toContainText("Pick a team");
  await openSearch(page);
  await expect(searchPalette(page)).toBeVisible();
  await expect(searchPalette(page)).not.toContainText("Pick a team");
  await page.keyboard.press("Escape");

  await page.goto("/messages");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("Pick a team");
  await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
});
