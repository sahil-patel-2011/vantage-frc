import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Auto routines Software versions and Whiteboard drop Loading titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/auto-routines");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Auto routines|Opening Auto routines|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading auto routines", {
    ignoreCase: false,
  });
  await page.goto("/software-versions");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Software versions|Opening Software versions|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading software versions", {
    ignoreCase: false,
  });
  await page.goto("/whiteboard");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Whiteboard|Opening Whiteboard|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading whiteboard", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Strategy Whiteboard", {
    ignoreCase: false,
  });
  await page.goto("/part-requests");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Part requests|Opening Part requests|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading part requests", {
    ignoreCase: false,
  });
});
