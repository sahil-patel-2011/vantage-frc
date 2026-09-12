import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Exports board drops OAuth and org_id student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/exports");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /What is excluded|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("OAuth");
  await expect(page.locator("body")).not.toContainText("org_id");
  await expect(page.locator("body")).not.toContainText("RFC 4180");
});
