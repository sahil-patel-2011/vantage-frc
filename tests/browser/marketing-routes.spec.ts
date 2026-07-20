import { expect, test } from "@playwright/test";

test("marketing navigation uses real routes and active tabs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Product" }).click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("link", { name: "Product", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "The product map." })).toBeVisible();
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await expect(page.getByText("AVAILABLE", { exact: true })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/workflow$/);
  await expect(page.getByRole("heading", { name: "How it works." })).toBeVisible();

  await page.goto("/features/cad");
  await expect(page).toHaveURL(/\/features\/cad$/);
  await expect(page.getByRole("heading", { name: "CAD starts with a brief." })).toBeVisible();
  await expect(page.getByText("DEMO DATA")).toHaveCount(0);
});

test("mobile menu exposes every marketing route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("summary[aria-label='Open navigation']").click();
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobile.getByRole("link", { name: "Product" })).toBeVisible();
  await mobile.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/workflow$/);
});
