import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Bottom island Hub access Season finance and Team funding drop compound titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/help/bottom-island");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Bottom island|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Customize the bottom island", {
    ignoreCase: false,
  });
  await page.goto("/help/hub-access");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Hub access|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Limit hub access", {
    ignoreCase: false,
  });
  await page.goto("/help/season-finance");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Season finance|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Season finance desk", {
    ignoreCase: false,
  });
  await page.goto("/help/funding-profile");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Team funding|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Team funding profile", {
    ignoreCase: false,
  });
});
