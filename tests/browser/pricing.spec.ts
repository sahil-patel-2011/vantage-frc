import { expect, test } from "@playwright/test";

test("pricing clearly separates plans and opt-in overage", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Fund private work or the whole team—deliberately." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual Max" })).toBeVisible();
  await expect(page.getByText(/\$50 included managed API allowance/)).toBeVisible();
  await expect(page.getByText(/No markup on model spend/)).toBeVisible();
  await expect(page.getByText(/1\.0×/)).toBeVisible();
  await expect(page.getByText(/Usage Credit = \$1 of provider API cost at list rates/)).toBeVisible();
  await expect(page.getByText(/hard stop/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Team" })).toBeVisible();
  await page.getByRole("button", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Max" })).toBeVisible();
  await expect(page.getByText(/\$150 pooled managed API allowance/)).toBeVisible();
  await expect(page.getByLabel(/Team Max subscription or higher credit packs/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access + PAYG" })).toBeVisible();
  await expect(page.getByText(/Week team trial/i).first()).toBeVisible();
  await expect(page.getByText(/Checkout stays inactive until Stripe/)).toBeVisible();
});
