import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name:"vantage-e2e-session", value:"authenticated", url:"http://localhost:3310", httpOnly:true, sameSite:"Lax" }]);
});

test("command center prioritizes competition state with explicit demo labels", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Competition Command Center" })).toBeVisible();
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Competition" }).getByRole("link", { name: "Command Center" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /Search teams/ })).toBeVisible();
});

test("real strategy and code routes render deterministic implemented engines", async ({ page }) => {
  await page.goto("/strategy");
  await expect(page.getByRole("heading", { name: "Win / Loss + Strategy" })).toBeVisible();
  await expect(page.getByText("weighted-current-v1")).toBeVisible();
  await page.getByRole("navigation", { name: "Build" }).getByRole("link", { name: "Code" }).click();
  await expect(page).toHaveURL(/\/code$/);
  await expect(page.getByRole("heading", { name: "FRC Code Builder / Debugger" })).toBeVisible();
  await expect(page.getByText("blocking robot loop")).toBeVisible();
});

test("mobile product shell uses bottom navigation and menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Mobile product navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle product menu" }).click();
  await expect(page.getByRole("complementary", { name: "Product navigation" })).toBeVisible();
});
