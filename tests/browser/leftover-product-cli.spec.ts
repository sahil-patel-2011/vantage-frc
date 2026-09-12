import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Usage drops Local CLI", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/usage");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Usage|This computer|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Local CLI", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Hosted by Vantage", {
    ignoreCase: false,
  });
});
