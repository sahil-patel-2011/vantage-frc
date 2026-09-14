import { test } from "@playwright/test";
import { assertStudentBoardsHaveNoSetupRequired } from "./leftover-setup-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Roadmap / Code boards no longer print Setup required", async ({ page }) => {
  test.setTimeout(90_000);
  await assertStudentBoardsHaveNoSetupRequired(page, ["/roadmap", "/code"]);
});
