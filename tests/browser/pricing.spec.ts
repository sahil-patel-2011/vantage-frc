import { expect, test } from "@playwright/test";

test("pricing clearly separates plans and opt-in overage", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Choose headroom. Keep control." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Free" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vantage Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vantage Max" })).toBeVisible();
  await expect(page.getByText("No surprise charges.")).toBeVisible();
  await expect(page.getByText(/Fable 5 is always API-rate PAYG/)).toBeVisible();
});
