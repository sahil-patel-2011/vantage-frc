import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Pick Clock drops EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/pick-clock", /Pick Clock|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("Auto EPA");
  await expect(page.locator("body")).not.toContainText("TBA (tba)");
});

test("leftover Alliance-Partner Brief drops EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(
    page,
    "/alliance-partner-brief",
    /Alliance-Partner Brief|Choose your team|Needs setup/i,
  );
  await expect(page.locator("body")).not.toContainText("EPA total");
  await expect(page.locator("body")).not.toContainText("Auto EPA");
});
