import { test } from "@playwright/test";
import { assertLeftoverSetupVantageChromeGone } from "./leftover-setup-vantage-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Setup required / VANTAGE Forms chrome is gone from checklist / checkout / simulator", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await assertLeftoverSetupVantageChromeGone(page, [
    "/match-checklist",
    "/tool-checkout",
    "/match-sim",
  ]);
});
