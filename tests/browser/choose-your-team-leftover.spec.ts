import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("All apps team chip and Chat never say Pick a team", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.locator("body")).not.toContainText("Application error");

  // The island's fifth "All" button is gone — it duplicated this one.
  await page.getByRole("button", { name: "Menu and search" }).click();
  const drawer = page.getByRole("complementary", { name: "Product navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer).not.toContainText("Pick a team");

  await page.goto("/messages");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("Pick a team");
  await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
});
