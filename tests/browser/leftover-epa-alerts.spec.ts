import { test } from "@playwright/test";
import { assertNoLeftoverEpaRating } from "./leftover-epa-rating-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Rating alerts drops EPA Trend Alerts student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoLeftoverEpaRating(page, "/epa-trend-alerts", /Rating alerts|Choose your team/i);
});
