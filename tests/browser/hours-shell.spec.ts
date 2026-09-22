import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Hours still loads after the shell split", async ({ page }) => {
  await page.goto("/hours");
  await expect(page.getByRole("heading", { level: 1, name: "Shop hours" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  // Either direction of the same control. This asked for "Clock in" and so
  // only passed for somebody who happened to be clocked out — the seeded
  // owner is clocked in, so the page was fully working and the test was
  // looking for the wrong half of a toggle. What this test is about is the
  // shell loading, not which state the kiosk is in.
  const clockControl = page.getByRole("button", { name: /^Clock (in|out)$/ });
  const setup = page.getByRole("heading", { name: "Choose your team", exact: true });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, clockControl, setup.or(unavailable)))) {
    await page.screenshot({ path: "test-results/hours-after-split.png", fullPage: true });
    return;
  }

  await expect(clockControl.first()).toBeVisible();
  await page.screenshot({ path: "test-results/hours-after-split.png", fullPage: true });
});
