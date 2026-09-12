import { test } from "@playwright/test";
import { assertNoLeftoverRankingsTba } from "./leftover-rankings-tba-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Shift balancer drops Sync TBA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoLeftoverRankingsTba(
    page,
    "/shift-balancer",
    /Scout shift|Choose your team|shift load|Generate your first/i,
  );
});
