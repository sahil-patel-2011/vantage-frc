import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Match cards drops Match Strategy Cards student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/match-strategy-cards");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Match cards|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Match Strategy Cards");
  await expect(page.locator("body")).not.toContainText("Match strategy cards", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Strategy Cards", {
    ignoreCase: false,
  });
});
