import { test } from "@playwright/test";
import { assertNoLeftoverRankingsTba } from "./leftover-rankings-tba-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Rankings drops TBA/Statbotics student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoLeftoverRankingsTba(page, "/rankings", /Rankings|Choose your team|playoffs/i);
});
