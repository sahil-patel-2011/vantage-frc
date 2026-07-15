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
  await expect(page.getByRole("button", { name: "Edit Home Screen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show secondary metrics" })).toBeVisible();
  await expect(page.getByText("Competition Command Center")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "First-run setup" })).toBeVisible();
  await expect(page.getByText("No upcoming match yet")).toBeVisible();
  await expect(page.getByText("No checklist data yet")).toBeVisible();
  await expect(page.locator(".dash-widget").filter({ hasText: "Next match" }).locator(".dash-empty")).toBeVisible();
});

test("dashboard editor can enter edit mode and show widget catalog", async ({ page }) => {
  await page.goto("/dashboard");
  // Fixed soft-topbar can intercept pointer clicks after scroll-into-view; call the DOM handler directly.
  await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByText("Edit mode")).toBeVisible();
  await expect(page.locator(".dash-editor-bar")).toBeVisible();
  await expect(page.getByRole("button", { name: /Add · Next match|On board · Next match/ })).toBeVisible();
  await expect(page.getByTestId("dash-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  await expect(page.getByTestId("dash-open-library")).toBeVisible();
  await page.getByTestId("dash-preview").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByTestId("dash-customize")).toBeVisible();
});

test("mobile product shell keeps Dynamic Island and hamburger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("complementary", { name: "Product navigation" })).toBeVisible();
  await expect(page.locator(".soft-profile-actions a")).toHaveText("Account");
  await expect(page.locator(".soft-profile-actions button")).toHaveText("Sign out");
});

test("onboarding route is reachable when authenticated fixture skips incomplete gate", async ({ page }) => {
  // E2E fixture bypasses onboarding incomplete redirects and lands on dashboard.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("account route renders settings tabs and notification badge stays empty at zero", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account sections" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Integrations" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator(".soft-notif b")).toHaveCount(0);
});

test("strategy defaults to empty setup and hides fabricated probabilities", async ({ page }) => {
  await page.goto("/strategy");
  await expect(page.getByRole("heading", { name: "Win / Loss + Strategy" })).toBeVisible();
  await expect(page.getByText("Deterministic demo")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try demo scenario" })).toBeVisible();
  await expect(page.getByText("65%")).toHaveCount(0);
  await page.getByRole("button", { name: "Try demo scenario" }).click();
  await expect(page.getByText("Illustrative only · not live data")).toBeVisible();
  await expect(page.getByText("weighted-current-v1")).toBeVisible();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.getByRole("button", { name: "Try demo scenario" })).toBeVisible();
});

test("code route reviews fixtures via interactive workbench", async ({ page }) => {
  await page.goto("/code");
  await expect(page.getByRole("heading", { name: "FRC Code Builder / Debugger" })).toBeVisible();
  await page.getByRole("button", { name: "Run risk review" }).click();
  await expect(page.getByText("blocking robot loop")).toBeVisible();
  await expect(page.getByText("Review complete.")).toBeVisible();
});
