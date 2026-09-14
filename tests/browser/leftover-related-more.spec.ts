import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover related strips drop Title-Case Open X student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/pit");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Pit command|Opening Pit command|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Open Pit Command", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Loading Pit Command", {
    ignoreCase: false,
  });
  await page.goto("/briefing");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Pre-match briefing|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Pre-Match Briefing", {
    ignoreCase: false,
  });
});
