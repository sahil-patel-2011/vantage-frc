import { expect, test } from "@playwright/test";

test("pricing clearly separates plans and opt-in overage", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Plans for private work or the whole team." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual Max" })).toBeVisible();
  await expect(page.getByText(/\$75\/mo managed API/)).toBeVisible();
  await expect(page.getByText(/25% less than BYOK/i).first()).toBeVisible();
  await expect(page.getByText(/75% of typical API rates/i).first()).toBeVisible();
  await expect(page.getByText(/hard (cut-off|stop)/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Team" })).toBeVisible();
  await page.getByRole("button", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Max" })).toBeVisible();
  await expect(page.getByText(/\$225\/mo pooled managed API/)).toBeVisible();
  await expect(page.getByLabel(/Team Max subscription or higher credit packs/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access + PAYG" })).toBeVisible();
  await expect(page.getByText(/Week team trial/i).first()).toBeVisible();
  await expect(page.getByText(/Checkout stays inactive until Stripe/)).toBeVisible();
});
