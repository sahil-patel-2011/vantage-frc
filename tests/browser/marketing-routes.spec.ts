import { expect, test } from "@playwright/test";

test("marketing navigation uses real routes and active tabs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Product" }).click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("link", { name: "Product", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "What you open after sign-in." })).toBeVisible();
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await expect(page.getByText("AVAILABLE", { exact: true })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/workflow$/);
  await expect(page.getByRole("heading", { name: "One team. One event. Then the rest of the season." })).toBeVisible();

  await page.goto("/features/cad");
  await expect(page).toHaveURL(/\/features\/cad$/);
  await expect(page.getByRole("heading", { name: "CAD starts with a brief." })).toBeVisible();
  await expect(page.getByText("DEMO DATA")).toHaveCount(0);
});

// Phones get a disclosure menu so Product and the waitlist stay one tap away; the
// footer still carries every route for anyone who scrolls.
test("marketing header keeps routes reachable on phones and in the footer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("summary[aria-label='Open navigation']")).toHaveCount(1);
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.getByRole("contentinfo").getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/workflow$/);
});
