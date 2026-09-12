import { test } from "@playwright/test";
import { assertNoMembershipBound } from "./leftover-membership-bound-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Scout Accuracy and Data impact drop membership-bound", async ({ page }) => {
  await assertNoMembershipBound(page, [
    { path: "/scout-accuracy", extra: ["pick-desk ready"] },
    { path: "/scout-data-impact" },
  ]);
});
