import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Event Day drops EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/command", /Command|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("Rank and EPA");
  await expect(page.locator("body")).not.toContainText("EPA edge");
  await expect(page.locator("body")).not.toContainText("TBA+scout");
});

test("leftover Strategy drops EPA factor copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/strategy", /Strategy|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("EPA drift");
  await expect(page.locator("body")).not.toContainText("Alliance EPA");
  await expect(page.locator("body")).not.toContainText("official TBA result");
});
