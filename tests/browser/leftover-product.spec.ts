import { test } from "@playwright/test";
import { assertLeftoverProductBoards } from "./leftover-product-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Usage / Chat limits / Files boards speak student chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await assertLeftoverProductBoards(page, [
    { path: "/team/usage", heading: /Where the team's AI spend goes|Choose your team|Usage/ },
    { path: "/team/budgets", heading: /Chat limits|Choose your team/ },
    { path: "/files", heading: "Files" },
  ]);
});
