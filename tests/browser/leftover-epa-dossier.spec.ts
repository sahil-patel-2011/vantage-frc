import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Dossier drops EPA card copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(page, "/dossier", /Season team dossier|Choose your team|Needs setup/i);
  await expect(page.locator("body")).not.toContainText("season EPA");
  await expect(page.locator("body")).not.toContainText("EPA ");
});
