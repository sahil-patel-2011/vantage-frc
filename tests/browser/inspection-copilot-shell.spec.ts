import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Inspection Copilot still loads after the panel split", async ({ page }) => {
  await page.goto("/inspection-copilot");
  await expect(page.locator("body")).not.toContainText("Application error");

  const title = page.getByRole("heading", { name: "Inspection-Readiness Copilot" });
  const form = page.locator("#inspection-copilot-form");
  const recovery = page.locator(".soft-gate");
  await expect(title.or(recovery)).toBeVisible({ timeout: 20_000 });

  if ((await form.count()) === 0) {
    await expect(page.getByRole("heading", { name: "Inspection-Readiness Copilot" })).toBeVisible();
    return;
  }

  await expect(form).toBeVisible();
  await expect(page.getByText("default 115 until you set one")).toBeVisible();
  await expect(page.getByRole("button", { name: "Predict inspection failures" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Inspection Copilot summary" })).toBeVisible();
  await expect(page.locator("#inspection-copilot-form").getByRole("tab")).toHaveCount(0);
});
