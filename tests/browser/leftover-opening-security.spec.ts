import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Team security drops Loading members student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/security");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Team security|Opening members|Opening hub access|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading members", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Loading hub access", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Team admin");
});
