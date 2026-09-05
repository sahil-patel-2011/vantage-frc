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

const HUBS = [
  { path: "/dashboard", heading: /Home|Dashboard|Vantage/i },
  { path: "/competition", tab: "Event day" },
  { path: "/team", tab: "Calendar" },
  { path: "/business", tab: "Overview" },
  { path: "/build", tab: "Kickoff" },
  { path: "/ai", tab: "Ask" },
  { path: "/media", heading: /^Media$/i },
  { path: "/logistics", heading: /Logistics|Travel/i },
] as const;

test("every product hub and logistics render instead of crashing", async ({ page }) => {
  test.setTimeout(120_000);
  for (const hub of HUBS) {
    const response = await page.goto(hub.path, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${hub.path} HTTP`).toBeTruthy();
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("This section is not available");
    if ("tab" in hub) {
      await expect(page.getByRole("tab", { name: hub.tab })).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    }
  }
});

test("Media library hub tab opens the library page instead of Calendar", async ({ page }) => {
  await page.goto("/media?tab=media-library", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/media-library/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("AI Library stays on the AI hub instead of bouncing to /decisions", async ({ page }) => {
  await page.goto("/ai?tab=decisions", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/ai(\?|$)/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Library" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Taking you to the full page");
});
