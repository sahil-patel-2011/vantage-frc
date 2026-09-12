import { test } from "@playwright/test";
import { assertLeftoverSchemaChromeGone } from "./leftover-schema-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover schema / OAuth chrome is gone from Forms / Chemistry / Inventory", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await assertLeftoverSchemaChromeGone(page, [
    "/competition?tab=forms",
    "/chemistry",
    "/inventory",
  ]);
});
