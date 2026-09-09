import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test("landing sign in reaches dashboard with local auth fixture", async ({ context, page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await signInFixture(context);
  await page.goto("/signin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Was getByRole("button", {name: "Customize"}), which only ever matched the
  // closed navigation panel's "Customize island" — that panel sat off-canvas but
  // still in the accessible tree. It is properly hidden now, so assert the
  // dashboard's own control, which is what this test was trying to check.
  await expect(page.getByTestId("dash-customize")).toBeVisible();
});

test("protected routes preserve their requested destination", async ({ page }) => {
  await page.goto("/scouting?orgId=fixture-team");
  await expect(page).toHaveURL(
    /\/signin\?next=%2Fcompetition%3ForgId%3Dfixture-team%26tab%3Dscouting$/,
  );
});
