import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Discord Slack APIs drop leftover webhook chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/discord");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Discord|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("channel webhook", {
    ignoreCase: true,
  });
  await expect(page.locator("body")).not.toContainText("DISCORD_BOT_TOKEN", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Setup required", {
    ignoreCase: false,
  });

  await page.goto("/team/slack");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Slack|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("incoming webhook", {
    ignoreCase: true,
  });
  await expect(page.locator("body")).not.toContainText("hooks.slack.com", {
    ignoreCase: true,
  });
  await expect(page.locator("body")).not.toContainText("channel webhook", {
    ignoreCase: true,
  });
  await expect(page.locator("body")).not.toContainText("Setup required", {
    ignoreCase: false,
  });
});
