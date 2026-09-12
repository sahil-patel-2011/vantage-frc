import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover CAD review queue drops CAD Review Queue student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/cad-review-queue");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /CAD review queue|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("CAD Review Queue");
});
