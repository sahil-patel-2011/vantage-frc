import { expect, test } from "@playwright/test";

test("Sign-in still loads after the panel split", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Email me a sign-in code" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Join the waitlist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" })).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/signin-after-split.png", fullPage: true });
});
