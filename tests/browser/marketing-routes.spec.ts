import { expect, test } from "@playwright/test";

test("marketing navigation uses real routes and active tabs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("link", { name: "Features", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Setup required").first()).toBeVisible();

  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Workflow" }).click();
  await expect(page).toHaveURL(/\/workflow$/);
  await expect(page.getByRole("heading", { name: "Shared context is the handoff layer." })).toBeVisible();

  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "AI CAD" }).click();
  await expect(page).toHaveURL(/\/features\/cad$/);
  await expect(page.getByText("DEMO DATA").first()).toBeVisible();
});

test("mobile menu exposes every marketing route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("summary[aria-label='Open navigation']").click();
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobile.getByRole("link", { name: "Features" })).toBeVisible();
  await mobile.getByRole("link", { name: "Workflow" }).click();
  await expect(page).toHaveURL(/\/workflow$/);
});
