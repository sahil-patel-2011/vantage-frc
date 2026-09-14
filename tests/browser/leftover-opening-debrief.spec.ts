import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Kickoff Match debrief Data quality and Pit link drop Loading titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/kickoff");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Kickoff|Opening Kickoff|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading kickoff", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Kickoff & Game Analysis", {
    ignoreCase: false,
  });
  await page.goto("/match-debrief");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Match debrief|Opening Match debrief|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading match log", {
    ignoreCase: false,
  });
  await page.goto("/data-quality-scorecard");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Data quality|Opening Data quality|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading…", {
    ignoreCase: false,
  });
  await page.goto("/scout-p2p-relay");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Pit link|Opening Pit link|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading…", {
    ignoreCase: false,
  });
});
