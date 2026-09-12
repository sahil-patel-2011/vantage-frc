import { test } from "@playwright/test";
import { assertLeftoverSetupVantageChromeGone } from "./leftover-setup-vantage-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Setup required / VANTAGE Forms chrome is gone from Consent / Video index / Day plan", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await assertLeftoverSetupVantageChromeGone(page, [
    "/consent",
    "/match-video-index",
    "/event-day-plan",
  ]);
});
