import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Scan GitHub Local AI Plans and Paste a video drop long titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/help/bugbot-ultra");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Scan GitHub|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Scan GitHub with Bugbot", {
    ignoreCase: false,
  });
  await page.goto("/help/local-ai");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Local AI|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Run Vantage on local or free AI", {
    ignoreCase: false,
  });
  await page.goto("/help/plans-and-pricing");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Plans|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Plans: Free, Pro, Pro+, and Max", {
    ignoreCase: false,
  });
  await page.goto("/help/analyze-video");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Paste a video|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Paste a match or pit video", {
    ignoreCase: false,
  });
});
