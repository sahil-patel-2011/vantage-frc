import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Judge pitch drops Simulator student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/judge-sim");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Judge pitch|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Judge-Pitch Simulator");
  await expect(page.locator("body")).not.toContainText("Judge-Pitch");
});
