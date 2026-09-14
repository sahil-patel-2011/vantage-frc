import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Ask AI memory board uses gold chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/ai?tab=memory");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(
    page.getByRole("heading", { name: /What the assistant remembers|Choose your team|AI/ }).first(),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Setup required");
});
