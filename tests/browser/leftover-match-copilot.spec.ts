import { test } from "@playwright/test";
import { assertNoLeftoverRankingsTba } from "./leftover-rankings-tba-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Pre-match briefing drops opponent EPA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoLeftoverRankingsTba(
    page,
    "/briefing",
    /Pre-match briefing|Choose your team|Your session ended|Sign in/i,
  );
});
