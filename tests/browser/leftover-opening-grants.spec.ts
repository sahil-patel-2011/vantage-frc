import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Grants drop Loading grant writing student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/grants");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Grants|Grant writing|Opening Grants|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading grant writing", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Loading spend options", {
    ignoreCase: false,
  });
});
