import { test } from "@playwright/test";
import { assertNoMembershipBound } from "./leftover-membership-bound-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Lineup and Match video drop membership-bound", async ({ page }) => {
  await assertNoMembershipBound(page, [
    { path: "/scouting/lineup", extra: ["membership IDs"] },
    { path: "/video" },
  ]);
});
