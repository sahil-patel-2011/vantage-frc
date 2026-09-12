import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Code / Bugbot drops Pick a team and PAT or OAuth", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/code");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Code|Choose your team|Needs setup|Your session ended|Sign in|Connect GitHub/i,
  );
  await expect(page.locator("body")).not.toContainText("Pick a team");
  await expect(page.locator("body")).not.toContainText("PAT or OAuth");
  await expect(page.locator("body")).not.toContainText("OAuth app");
});
