import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Inspection Copilot still loads after the panel split", async ({ page }) => {
  await page.goto("/inspection-copilot");
  // `exact: true`. Playwright matches an accessible name as a *substring* by
  // default, so "Inspection" also matched "Run your first inspection-readiness
  // check" once the page had real content — two headings, strict-mode
  // violation, and a failure that read like the page was broken.
  await expect(page.getByRole("heading", { name: "Inspection", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("body")).not.toContainText("Application error");

  const form = page.locator("#inspection-copilot-form");
  const readyHeading = page.getByRole("heading", { name: "Run an inspection-readiness check", exact: true });
  const setup = page.getByRole("heading", { name: /Choose your team|Choose your team/i });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, readyHeading, setup.or(unavailable)))) {
    await expect(page.getByRole("tab")).toHaveCount(0);
    if (await setup.isVisible()) {
      await expect(page.getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    }
    return;
  }

  await expect(form).toBeVisible();
  await expect(page.getByText("default 115 until you set one")).toBeVisible();
  await expect(page.getByRole("button", { name: "Predict inspection failures" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Inspection Copilot summary" })).toBeVisible();
  await expect(form.getByRole("tab")).toHaveCount(0);
});
