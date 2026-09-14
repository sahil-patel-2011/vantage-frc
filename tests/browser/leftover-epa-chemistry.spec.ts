import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Chemistry drops EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/chemistry", /Alliance chemistry|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("Need event EPA");
  await expect(page.locator("body")).not.toContainText("of EPA");
  await expect(page.locator("body")).not.toContainText("missing EPA");
});

test("leftover Research drops EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/intel", /Research|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("Need event EPA");
  await expect(page.locator("body")).not.toContainText("of EPA");
  await expect(page.locator("body")).not.toContainText("missing EPA");
});
