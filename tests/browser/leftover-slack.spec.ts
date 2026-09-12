import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Slack drops leftover Incoming webhook chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/slack");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Slack|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Incoming webhook", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("hooks.slack.com", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("SLACK_SIGNING_SECRET", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Setup required", {
    ignoreCase: false,
  });
});
