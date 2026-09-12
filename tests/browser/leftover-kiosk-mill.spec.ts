import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Pit TV drops VANTAGE mill prefix", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/display/kiosk");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: /Provide a TV token|Display unavailable|Signed-in kiosk|Pit TV|Choose your team|EVENT DISPLAY/i }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("VANTAGE /");
  await expect(page.locator("body")).not.toContainText("VANTAGE DISPLAY");
  await expect(page.locator("body")).not.toContainText("VANTAGE PIT DISPLAY");
});
