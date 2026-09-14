import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Spares forecast drops Failure Forecast student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/spare-forecast");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Spares forecast|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Spare-Parts Failure Forecast");
  await expect(page.locator("body")).not.toContainText("Spare Forecast");
});
