import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Pairwise drops EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/pairwise", /Pairwise ranking|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("or EPA.");
  await expect(page.locator("body")).not.toContainText("not EPA");
});

test("leftover Collaborative pick list drops FAST-style EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(
    page,
    "/picklist-collab",
    /Collaborative pick list|Choose your team|Needs setup/i,
  );
  await expect(page.locator("body")).not.toContainText("FAST-style");
  await expect(page.locator("body")).not.toContainText("FAST-style EPA");
});
