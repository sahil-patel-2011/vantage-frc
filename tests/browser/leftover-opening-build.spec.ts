import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Bring-up Subsystem specs and Batteries drop Loading titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/bringup");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Bring-up|Opening Bring-up|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading bring-up", {
    ignoreCase: false,
  });
  await page.goto("/subsystems");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Subsystem specs|Opening Subsystem specs|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading subsystems", {
    ignoreCase: false,
  });
  await page.goto("/batteries");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Batteries|Opening Batteries|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading batteries", {
    ignoreCase: false,
  });
});
