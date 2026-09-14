import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Failure log board drops FMEA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/fmea");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Failure log|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Failure Log (FMEA)");
  await expect(page.locator("body")).not.toContainText("Open FMEA risks");
  await expect(page.locator("body")).not.toContainText("RPN ");
  await expect(page.locator("body")).not.toContainText("O×S×D");
  await expect(page.locator("body")).not.toContainText("O/S/D");
});
