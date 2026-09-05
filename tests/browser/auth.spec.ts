import { expect, test } from "@playwright/test";

test("landing sign in reaches dashboard with local auth fixture", async ({ context, page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

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
  // The shell itself is the proof we landed inside the product, not on a redirect.
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});

test("protected routes preserve their requested destination", async ({ page }) => {
  await page.goto("/scouting?orgId=fixture-team");
  await expect(page).toHaveURL(
    /\/signin\?next=%2Fcompetition%3ForgId%3Dfixture-team%26tab%3Dscouting$/,
  );
});
