import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Ask AI Edit Home and Our alliance drop em-dash titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/dashboard");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Ask AI|Edit Home|Home|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Ask AI —", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Edit Home —", {
    ignoreCase: false,
  });
  await page.goto("/briefing");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Our alliance|Briefing|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Our alliance —", {
    ignoreCase: false,
  });
});
