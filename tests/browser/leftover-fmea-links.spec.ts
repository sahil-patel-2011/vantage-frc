import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Incidents strip drops FMEA student labels", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/incidents");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Incidents|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Open FMEA");
  await expect(page.locator("body")).not.toContainText("FMEA →");
});
