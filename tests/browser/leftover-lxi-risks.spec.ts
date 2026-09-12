import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Risks board drops L×I and PID student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/risks");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Risk register|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("L×I");
  await expect(page.locator("body")).not.toContainText("L4 × I5");
  await expect(page.locator("body")).not.toContainText("PID/feedforward");
  await expect(page.locator("body")).not.toContainText("PID gain");
});
