import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover District advancement drops TBA/Statbotics and EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(
    page,
    "/district-advancement",
    /District advancement|Choose your team|Needs setup/i,
  );
  await expect(page.locator("body")).not.toContainText("EPA baseline");
  await expect(page.locator("body")).not.toContainText("cached EPA");
  await expect(page.locator("body")).not.toContainText("TBA/Statbotics");
});
