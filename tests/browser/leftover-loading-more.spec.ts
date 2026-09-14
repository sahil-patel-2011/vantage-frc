import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Weigh-in and Pair VS Code drop Loading Title-Case student copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/robot-weigh-in");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Weigh-in|Opening Weigh-in|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading Robot Weigh-In", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Robot Weigh-In", {
    ignoreCase: false,
  });
  await page.goto("/editor/pair");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Pair VS Code|Opening Pair VS Code|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading Pair VS Code", {
    ignoreCase: false,
  });
});
