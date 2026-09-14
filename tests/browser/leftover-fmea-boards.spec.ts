import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Get unstuck drops FMEA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/troubleshoot");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Get unstuck|Failure log|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Robot › FMEA");
  await expect(page.locator("body")).not.toContainText("Your FMEA");
  await expect(page.locator("body")).not.toContainText("FMEA log");
});
