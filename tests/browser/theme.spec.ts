import { expect, test } from "@playwright/test";

test("public site uses a restrained light palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { name: "Evidence that stays usable from the stands to the shop." })).toBeVisible();
  await expect(page.locator("#hero-waitlist").getByLabel("Email")).toBeVisible();
  await expect(page.locator(".marketing-site")).toHaveCSS("background-color", "rgb(250, 249, 246)");
});

test("dashboard defaults light and persists an explicit dark choice", async ({ context, page }) => {
  await context.addCookies([{
    name: "vantage-e2e-session",
    value: "authenticated",
    url: "http://localhost:3310",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("theme control remains usable on a mobile dashboard", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{
    name: "vantage-e2e-session",
    value: "authenticated",
    url: "http://localhost:3310",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
});
