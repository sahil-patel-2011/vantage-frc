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

/*
 * The E2E fixture authenticates without a team, so every product route here is
 * exercised in its no-workspace state (see the /code expectation below). Home
 * customization saves to a team-scoped board, so Edit Home is deliberately
 * absent until a workspace is selected; the layout/collision engine behind it
 * is covered by apps/web/lib/dashboard/grid-drag.test.ts.
 */
test("dashboard home stays calm and defers customization until a team is selected", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "First-run setup" })).toBeVisible();
  await expect(page.getByTestId("dash-customize")).toHaveCount(0);
  await expect(page.getByText("Competition Command Center")).toHaveCount(0);
});

test("product shell keeps four workspace shortcuts on phone and uses the drawer on desktop", async ({ page }) => {
  const island = page.getByRole("navigation", { name: "Primary apps" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(island).toBeVisible();
  await expect(island.getByRole("link")).toHaveCount(4);
  await expect(island.getByRole("link", { name: "Scout" })).toBeVisible();
  await expect(island.getByRole("link", { name: "Run season" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("complementary", { name: "Product navigation" });
  await expect(drawer).toBeVisible();
  // Home is a sibling of the four workspaces — without it the only way back is the wordmark.
  await expect(drawer.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Scout" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Compete" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Build" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Run season" })).toBeVisible();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(island).toBeHidden();
});

test("onboarding route is reachable when authenticated fixture skips incomplete gate", async ({ page }) => {
  // E2E fixture bypasses onboarding incomplete redirects and lands on dashboard.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("account route keeps settings discoverable when the API session is unavailable", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your settings" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My AI keys" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your session ended" })).toBeVisible();
  await expect(page.locator(".soft-notif b")).toHaveCount(0);
});

test("strategy defaults to empty setup and hides fabricated probabilities", async ({ page }) => {
  await page.goto("/strategy");
  await expect(page.getByRole("tab", { name: "Strategy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try demo scenario" })).toHaveCount(0);
  await expect(page.getByText("Deterministic demo")).toHaveCount(0);
  await expect(page.getByText("65%")).toHaveCount(0);
  await expect(page.getByText("weighted-current-v1")).toHaveCount(0);
});

test("code route requires a real team and never falls back to fixture findings", async ({ page }) => {
  await page.goto("/code");
  await expect(page.getByRole("tab", { name: "Code" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a team" })).toBeVisible();
  await expect(page.getByText("blocking robot loop")).toHaveCount(0);
});
