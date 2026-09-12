import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Team Data related strip drops TBA/Statbotics student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/team/data", /Team Data|Connect TBA|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("The Blue Alliance");
  await expect(page.locator("body")).not.toContainText("No TBA cache yet");
});
