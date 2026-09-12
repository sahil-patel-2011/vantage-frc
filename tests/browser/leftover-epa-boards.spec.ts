import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Pre-match briefing drops EPA student chips", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(
    page,
    "/briefing",
    /Pre-match briefing|Choose your team|Your session ended|Sign in|Needs setup/i,
  );
  await expect(page.locator("body")).not.toContainText("our EPA");
  await expect(page.locator("body")).not.toContainText("sync EPA");
});

test("leftover Match Sim drops synced EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/match-sim", /Match Simulator|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("synced EPA");
  await expect(page.locator("body")).not.toContainText("No synced EPA");
});
