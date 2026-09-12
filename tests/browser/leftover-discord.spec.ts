import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Discord drops leftover webhook chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/discord");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Discord|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("channel webhook", {
    ignoreCase: true,
  });
  await expect(page.locator("body")).not.toContainText("Webhook posting", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Developer Mode", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Setup required", {
    ignoreCase: false,
  });
});
