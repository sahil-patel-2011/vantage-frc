import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Sponsor suite and Sponsor wall drop Sponsor CRM student copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/sponsor-suite");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Sponsor suite|Open Sponsors|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Sponsor CRM", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Open Sponsor CRM", {
    ignoreCase: false,
  });
  await page.goto("/sponsor-wall");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Sponsor wall|Open Sponsors|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Sponsor CRM", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Sponsor Suite", {
    ignoreCase: false,
  });
});
