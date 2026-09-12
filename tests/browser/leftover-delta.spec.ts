import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Match delta drops Match-Delta Watcher student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/match-delta-watcher");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Match delta|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Match-Delta Watcher");
  await expect(page.locator("body")).not.toContainText("Match-Delta");
});
