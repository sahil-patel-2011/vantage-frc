import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Ask AI Files Team library and Media library drop em-dash titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/help/ask-ai");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Ask AI|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Ask AI —", {
    ignoreCase: false,
  });
  await page.goto("/help/files");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Files|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Files — the team drive", {
    ignoreCase: false,
  });
  await page.goto("/help/team-library");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Team library|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Team Library —", {
    ignoreCase: false,
  });
  await page.goto("/help/media-library");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Media library|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Media library —", {
    ignoreCase: false,
  });
});
