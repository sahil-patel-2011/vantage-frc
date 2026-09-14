import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover AI keys drops leftover OpenAI-compatible chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/ai-keys");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /AI keys|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("OpenAI-compatible", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("AI API keys", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Setup required", {
    ignoreCase: false,
  });
});
