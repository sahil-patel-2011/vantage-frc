import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Inspection Copilot still loads after the panel split", async ({ page }) => {
  await page.goto("/inspection-copilot");
  await expect(page.getByRole("heading", { name: "Inspection" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("body")).not.toContainText("Application error");

  const form = page.locator("#inspection-copilot-form");
  const readyHeading = page.getByRole("heading", { name: "Run an inspection-readiness check" });
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
  await expect(page.getByRole("region", { name: "Inspection summary" })).toBeVisible();
  await expect(form.getByRole("tab")).toHaveCount(0);
});
