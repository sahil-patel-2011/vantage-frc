import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Global Team Manager drops Loading admin student copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/admin");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Global Team Manager|Opening Global Team Manager|Choose your team|Not found|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading admin", {
    ignoreCase: false,
  });
  await page.goto("/admin/waitlist");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Waitlist|Opening Waitlist|Choose your team|Not found|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading waitlist", {
    ignoreCase: false,
  });
});
