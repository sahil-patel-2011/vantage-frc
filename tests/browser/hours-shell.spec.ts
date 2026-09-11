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

  const clock = page.getByRole("button", { name: /Clock in|Clock out/ });
  const setup = page.getByRole("heading", { name: "Choose your team", exact: true });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, clock, setup.or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/hours-after-split.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("button", { name: /Clock in|Clock out/ })).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/hours-after-split.png", fullPage: true });
});
