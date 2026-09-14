import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Auton paths and Standup drop Title-Case leftover titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/auton-path-library");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Auton paths|Opening Auton paths|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Autonomous Path Library", {
    ignoreCase: false,
  });
  await page.goto("/standup-digest");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Standup|Opening Standup|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Morning Standup Digest", {
    ignoreCase: false,
  });
  await page.goto("/field-reset-timer");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Field reset|Opening Field reset|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Field Reset Timer", {
    ignoreCase: false,
  });
});
