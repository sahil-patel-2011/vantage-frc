import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Scouting trust drops TBA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/scouting", /Scouting|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("vs TBA");
  await expect(page.locator("body")).not.toContainText("Official TBA");
  await expect(page.locator("body")).not.toContainText("score_breakdown");
  await expect(page.locator("body")).not.toContainText("stored only for this organization");
});
