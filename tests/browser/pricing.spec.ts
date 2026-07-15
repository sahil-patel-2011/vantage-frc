import { expect, test } from "@playwright/test";

test("pricing clearly separates plans and opt-in overage", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Fund private work or the whole team—deliberately." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual Max" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Max" })).toBeVisible();
  await expect(page.getByText(/Prepaid stopping at zero is the default/)).toBeVisible();
  await expect(page.getByText(/PAYG requires explicit enrollment/)).toBeVisible();
});
