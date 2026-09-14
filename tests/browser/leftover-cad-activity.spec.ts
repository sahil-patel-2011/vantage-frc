import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover CAD activity drops vantage-cad dump", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/cad");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /CAD|Claude Code|This computer|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("vantage-cad", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Web agent", {
    ignoreCase: false,
  });
});
