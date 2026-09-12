import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover AI API keys board uses gold chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/ai-keys");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: /AI API keys|Choose your team/ }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Setup required");
});
