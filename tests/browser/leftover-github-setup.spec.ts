import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Invites drops Setup required chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/admin");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: /Invites|Choose your team|Needs setup|Your session ended|Sign in/i }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Setup required");
});
