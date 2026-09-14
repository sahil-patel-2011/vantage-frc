import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Exit interviews drops Graduation Exit Interviews student copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/exit-interview");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Exit interviews|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Graduation Exit Interviews");
  await expect(page.locator("body")).not.toContainText("Exit Interviews");
});
