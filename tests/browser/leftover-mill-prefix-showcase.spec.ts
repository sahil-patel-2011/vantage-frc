import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Showcase deck drops VANTAGE / mill prefix", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/showcase/present");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(
    page.getByRole("heading", { name: /Season Impact|Choose your team/ }).first(),
  ).toBeVisible();
  await expect(page.locator("body"), "/showcase/present still shows VANTAGE /").not.toContainText(
    "VANTAGE /",
  );
});
