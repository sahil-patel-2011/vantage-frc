import { expect, test } from "@playwright/test";

test("landing sign in reaches dashboard with local auth fixture", async ({ context, page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Welcome to Vantage" })).toBeVisible();

  await context.addCookies([{
    name: "vantage-e2e-session",
    value: "authenticated",
    url: "http://localhost:3310",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/signin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Customize" })).toBeVisible();
});

test("protected routes preserve their requested destination", async ({ page }) => {
  await page.goto("/scouting?orgId=fixture-team");
  await expect(page).toHaveURL(/\/signin\?next=%2Fscouting%3ForgId%3Dfixture-team$/);
});
