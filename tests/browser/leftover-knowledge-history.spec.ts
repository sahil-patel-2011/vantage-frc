import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Knowledge history drops pick the team first", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/knowledge/history");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(
    page.getByRole("heading", { name: /Knowledge history|Choose your team/ }).first(),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("pick the team first");
  await expect(page.locator("body")).not.toContainText("VANTAGE /");
});
