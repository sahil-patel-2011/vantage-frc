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
  // Sign-in is deliberately minimal now — the logo and the form, no site nav —
  // so the pricing link is not asserted here. Its label is: "What it costs",
  // because the page leads with the software being free and a link reading
  // "Pricing" told a mentor the opposite before they had read a word. Checked
  // on the landing page below, which still carries the header.
  await expect(page.getByText("setup_required")).toHaveCount(0);
  await expect(page.getByText("DEPLOYMENT.md")).toHaveCount(0);
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await waitlist.click();
  await expect(page).toHaveURL(/waitlist|#waitlist|\/$/);
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await expect(page.getByTestId("waitlist-form").or(page.getByTestId("waitlist-unavailable"))).toBeVisible();
});

test("the site header calls the pricing page what it costs", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("banner").or(page.locator("header")).first();
  await expect(nav.getByRole("link", { name: "What it costs" })).toBeVisible();
  // Never "Pricing": the product is free, and that word says otherwise first.
  await expect(nav.getByRole("link", { name: "Pricing", exact: true })).toHaveCount(0);
});
