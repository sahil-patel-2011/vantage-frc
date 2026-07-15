import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("mobile landing navigation keeps authentication available", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Vantage home" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
  await page.locator("summary[aria-label='Open navigation']").click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});
