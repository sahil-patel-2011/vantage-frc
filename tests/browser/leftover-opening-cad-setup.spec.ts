import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover CAD setup Prototypes Tuning log and Code vs match drop Loading titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/cad/setup");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /CAD setup|Opening CAD setup|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading CAD setup", {
    ignoreCase: false,
  });
  await page.goto("/prototype-tracker");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Prototypes|Opening Prototypes|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading prototype tracker", {
    ignoreCase: false,
  });
  await page.goto("/tuning");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Tuning log|Opening Tuning log|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading tuning constants", {
    ignoreCase: false,
  });
  await page.goto("/code-perf");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Code vs match|Opening Code vs match|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading…", {
    ignoreCase: false,
  });
});
