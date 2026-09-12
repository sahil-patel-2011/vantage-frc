import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Accuracy drops Scout Accuracy student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/scout-accuracy");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Accuracy|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Scout Accuracy");
});
