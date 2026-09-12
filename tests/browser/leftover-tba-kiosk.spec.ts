import { test } from "@playwright/test";
import { assertNoLeftoverEpaRating } from "./leftover-epa-rating-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Pit TV drops TBA/Statbotics student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoLeftoverEpaRating(
    page,
    "/display/kiosk",
    /Provide a TV token|Display unavailable|Signed-in kiosk|Pit TV|Choose your team/i,
  );
});
