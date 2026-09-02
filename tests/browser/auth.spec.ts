import { expect, test } from "@playwright/test";

test("landing sign in reaches dashboard with local auth fixture", async ({ context, page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await context.addCookies([{
    name: "vantage-e2e-session",
    value: "authenticated",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3310",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/signin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit Home/ })).toBeVisible();
});

test("protected routes preserve their requested destination", async ({ page }) => {
  await page.goto("/scouting?orgId=fixture-team");
  // /scouting is a legacy path: it lands on the Competition hub first, and the
  // sign-in gate keeps that resolved destination.
  await expect(page).toHaveURL(/\/signin\?next=%2Fcompetition%3ForgId%3Dfixture-team%26tab%3Dscouting$/);
});
