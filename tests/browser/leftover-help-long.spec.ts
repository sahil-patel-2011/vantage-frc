import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Team setup Outreach hours Naming CAD parts and Invites drop long titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/help/getting-started");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Team setup|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Set up a new team, start to first event", {
    ignoreCase: false,
  });
  await page.goto("/help/outreach-by-person");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Outreach hours|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Outreach hours by person", {
    ignoreCase: false,
  });
  await page.goto("/help/cad-naming");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Naming CAD parts|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Naming CAD parts so the next person", {
    ignoreCase: false,
  });
  await page.goto("/help/team-invites");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Invites|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Invite teammates by email", {
    ignoreCase: false,
  });
});
