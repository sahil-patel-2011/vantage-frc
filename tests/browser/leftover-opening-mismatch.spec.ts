import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Blueprint Objectives Training Packages and People drop Loading titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/robot");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Blueprint|Opening Blueprint|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading robot blueprint", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Robot Blueprint", {
    ignoreCase: false,
  });
  await page.goto("/goals");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Objectives|Opening Objectives|Goals|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading season goals", {
    ignoreCase: false,
  });
  await page.goto("/scout-training-mode");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Training|Opening Training|Scout training mode|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading…", {
    ignoreCase: false,
  });
  await page.goto("/sponsorship");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Packages|Opening Packages|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading sponsorship", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Sponsorship one-pagers", {
    ignoreCase: false,
  });
  await page.goto("/attendance");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /People|Opening People|Attendance|Choose your team|Needs setup|Your session ended|Sign in/,
  );
  await expect(page.locator("body")).not.toContainText("Loading attendance", {
    ignoreCase: false,
  });
});
