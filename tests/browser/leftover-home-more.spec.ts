import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Season impact drops Season Impact student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/showcase/present");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Season impact|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Season Impact", { ignoreCase: false });
  await expect(page.locator("body")).not.toContainText("Home Screens", { ignoreCase: false });
});
