import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Ask AI drops EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/chat", /Ask AI|Chat|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("pEPA");
  await expect(page.locator("body")).not.toContainText("EPA movers");
  await expect(page.locator("body")).not.toContainText("Statbotics clones");
});
