import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Team admin drops Setup required chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/admin");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: /Team admin|Choose your team|Needs setup/i }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Setup required");
});
