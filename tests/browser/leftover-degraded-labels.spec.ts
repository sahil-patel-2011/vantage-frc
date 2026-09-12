import { test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Degraded mode labels drop TBA/Statbotics student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(
    page,
    "/degraded-mode",
    /Degraded mode|Choose your team|Needs setup|Reference/i,
  );
});
