import { test } from "@playwright/test";
import { assertLeftoverSchemaChromeGone } from "./leftover-schema-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover schema / OAuth chrome is gone from Inspection / Learning / My Kit / Kickoff", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await assertLeftoverSchemaChromeGone(page, [
    "/inspection-copilot",
    "/learning",
    "/my-kit",
    "/kickoff",
  ]);
});
