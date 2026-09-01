import { expect, test } from "@playwright/test";

test("public site uses a restrained light palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { name: "The workspace your team actually runs." })).toBeVisible();
  await expect(page.locator("#waitlist").getByLabel("Email")).toBeVisible();
  await expect(page.locator(".marketing-site")).toHaveCSS("background-color", "rgb(250, 249, 246)");
});

test("dashboard honors a persisted theme choice", async ({ context, page }) => {
  await context.addCookies([{
    name: "vantage-e2e-session",
    value: "authenticated",
    url: "http://localhost:3310",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await context.addCookies([{
    name: "vantage-theme-pref",
    value: "dark",
    url: "http://localhost:3310",
    sameSite: "Lax",
  }]);
  await page.evaluate(() => {
    localStorage.setItem("vantage-theme-pref", "dark");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("persisted theme applies on a mobile dashboard", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{
    name: "vantage-e2e-session",
    value: "authenticated",
    url: "http://localhost:3310",
    httpOnly: true,
    sameSite: "Lax",
  }, {
    name: "vantage-theme-pref",
    value: "dark",
    url: "http://localhost:3310",
    sameSite: "Lax",
  }]);
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
