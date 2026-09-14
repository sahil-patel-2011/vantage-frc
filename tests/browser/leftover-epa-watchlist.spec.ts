import { test } from "@playwright/test";
import { assertNoLeftoverEpaRating } from "./leftover-epa-rating-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Opponent Watchlist drops EPA alerts student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoLeftoverEpaRating(
    page,
    "/opponent-watchlist",
    /Opponent Watchlist|Choose your team/i,
  );
});
