import { expect, test } from "@playwright/test";

test("Sign-in still loads after the panel split", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/signin");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Email me a sign-in code" })).toHaveCount(1);
  /*
    Found by where it goes, not what it says. The intent is "someone without an
    invite can find the waitlist" — access is closed, and the waitlist is the
    only way in for everyone else. Its label has changed twice ("Join the
    waitlist" → "Request access"); a spec keyed on the words failed on each
    rename while the path was fine. It must still have a real name.
  */
  const waitlist = page.locator('a[href*="waitlist"]').first();
  await expect(waitlist).toBeVisible();
  await expect(waitlist).toHaveAccessibleName(/\S/);
  // Sign-in is deliberately minimal now — the logo and the form, no site nav.
  await expect(page.getByText("setup_required")).toHaveCount(0);
  await expect(page.getByText("DEPLOYMENT.md")).toHaveCount(0);
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await waitlist.click();
  await expect(page).toHaveURL(/waitlist|#waitlist|\/$/);
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await expect(page.getByTestId("waitlist-form").or(page.getByTestId("waitlist-unavailable"))).toBeVisible();
});

test("the site says Vantage is free and never shows a pricing tab", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("banner").or(page.locator("header")).first();
  // Free, with your own AI key: there are no plans to shop for, so no pricing tab either.
  await expect(nav.getByRole("link", { name: "Pricing", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Free for every team/i }).first()).toBeVisible();
});
