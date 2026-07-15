import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "vantage-e2e-session",
      value: "authenticated",
      url: "http://localhost:3310",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});

test("dashboard home is decluttered and exposes customize controls", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Customize" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show secondary metrics" })).toBeVisible();
  await expect(page.getByText("Competition Command Center")).toHaveCount(0);
});

test("dashboard editor can enter edit mode and show widget catalog", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(page.getByRole("region", { name: "Widget catalog" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add · Next match|On board · Next match/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset default" })).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("button", { name: "Customize" })).toBeVisible();
});

test("mobile product shell keeps Dynamic Island and hamburger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("complementary", { name: "Product navigation" })).toBeVisible();
});

test("real strategy and code routes render deterministic implemented engines", async ({ page }) => {
  await page.goto("/strategy");
  await expect(page.getByRole("heading", { name: "Win / Loss + Strategy" })).toBeVisible();
  await expect(page.getByText("weighted-current-v1")).toBeVisible();
  await page.goto("/code");
  await expect(page.getByRole("heading", { name: "FRC Code Builder / Debugger" })).toBeVisible();
  await expect(page.getByText("blocking robot loop")).toBeVisible();
});
