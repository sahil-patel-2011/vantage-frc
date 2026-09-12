import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Change radar drops leftover webhook chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/cad-change-radar");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Change radar|Onshape|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Onshape release webhook", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("webhook", {
    ignoreCase: true,
  });
  await expect(page.locator("body")).not.toContainText("Setup required", {
    ignoreCase: false,
  });
});
