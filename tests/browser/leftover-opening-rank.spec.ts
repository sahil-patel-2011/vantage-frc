import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Rank projection Schema A/B Schedule and Team profile drop Loading titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/ranking-projection");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Rank projection|Opening Rank projection|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading ranking projection", {
    ignoreCase: false,
  });
  await page.goto("/scouting-schema-ab");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Schema A\/B|Opening Schema A\/B|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading…", {
    ignoreCase: false,
  });
  await page.goto("/schedule");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Schedule|Opening Schedule|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading match schedule", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Match schedule", {
    ignoreCase: false,
  });
  await page.goto("/team/profile");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Team profile|Opening Team profile|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading…", {
    ignoreCase: false,
  });
});
