import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Scout voice notes drop leftover STT and setup required copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/scouting");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("Voice STT");
  await expect(page.locator("body")).not.toContainText("Browser STT");
  await expect(page.locator("body")).not.toContainText("Cloud STT");
  await expect(page.locator("body")).not.toContainText("OPENAI_API_KEY");
  await expect(page.locator("body")).not.toContainText("setup required");
});
