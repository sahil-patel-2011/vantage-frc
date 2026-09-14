import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Alliance desk drops Collaborative Pick List student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/alliance-selection-desk");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Alliance desk|Pick list|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Collaborative Pick List");
  await expect(page.locator("body")).not.toContainText("Shift Balancer");
});
