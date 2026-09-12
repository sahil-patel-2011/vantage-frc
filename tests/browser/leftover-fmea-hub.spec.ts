import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Failure log hub drops Failure notes student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/fmea");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Failure log|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Failure notes");
  await page.goto("/team");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Team|Failure log|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Failure notes");
});
