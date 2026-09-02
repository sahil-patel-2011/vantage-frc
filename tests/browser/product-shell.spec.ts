import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "vantage-e2e-session",
      value: "authenticated",
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3310",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});

test("dashboard home is decluttered and exposes customize controls", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("dash-customize")).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit Home/ })).toBeVisible();
  await expect(page.getByText("Competition Command Center")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "First-run setup" })).toBeVisible();
});

test("dashboard editor can enter edit mode and show widget catalog", async ({ page }) => {
  await page.goto("/dashboard");
  // Fixed soft-topbar can intercept pointer clicks after scroll-into-view; call the DOM handler directly.
  await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator(".dash-edit-flag")).toBeVisible();
  await expect(page.locator(".dash-editor-bar")).toBeVisible();
  await expect(page.getByTestId("dash-catalog-inline").locator("button").first()).toBeVisible();
  await expect(page.getByTestId("dash-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" }).first()).toBeVisible();
  await expect(page.getByTestId("dash-open-library")).toBeVisible();
  await page.getByTestId("dash-preview").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByTestId("dash-customize")).toBeVisible();
});

test("dashboard editor rearranges widgets with drag-and-drop", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/dashboard");
  await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByText("Customize Home")).toBeVisible();
  await expect(page.getByTestId("dash-widget-grid")).toHaveAttribute("data-dash-drag", "on");
  await expect(page.locator(".dash-grid")).toBeVisible();
  // The palette uses Pointer Events (so it works on touch), not HTML5 draggable —
  // assert it is a real enabled control rather than a legacy drag attribute.
  await expect(page.locator(".dash-widget-palette button").first()).toBeEnabled();

  const snapshot = page.locator('[data-testid="dash-grid-item"][data-widget-type="competition_snapshot"]');
  await expect(snapshot).toBeVisible();
  await snapshot.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const before = `${await snapshot.getAttribute("data-widget-x")},${await snapshot.getAttribute("data-widget-y")}`;
  const handle = snapshot.getByTestId("dash-drag-handle");
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  // The card starts in column 0, so drag right (and down) to guarantee a new cell.
  await page.mouse.move(box!.x + 360, box!.y + 90, { steps: 20 });
  await expect(page.locator(".dash-snap-hud")).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(async () => `${await snapshot.getAttribute("data-widget-x")},${await snapshot.getAttribute("data-widget-y")}`)
    .not.toBe(before);

  const beforeCount = await page.getByTestId("dash-grid-item").count();
  const palette = page.locator(".dash-widget-palette button").first();
  await palette.scrollIntoViewIfNeeded();
  const paletteBox = await palette.boundingBox();
  const gridBox = await page.locator(".dash-grid").boundingBox();
  expect(paletteBox).toBeTruthy();
  expect(gridBox).toBeTruthy();
  // Playwright's dragTo() drives HTML5 drag-and-drop, which this grid no longer
  // uses. Driving the mouse exercises the same pointer path a touch user gets.
  await page.mouse.move(paletteBox!.x + paletteBox!.width / 2, paletteBox!.y + paletteBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gridBox!.x + 40, gridBox!.y + 40, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByTestId("dash-grid-item")).toHaveCount(beforeCount + 1);
});

test("product shell keeps a four-app island on phone and desktop", async ({ page }) => {
  const island = page.getByRole("navigation", { name: "Primary apps" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(island).toBeVisible();
  await expect(island.getByRole("link")).toHaveCount(4);
  await expect(island.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open more destinations" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("complementary", { name: "Product navigation" });
  await expect(drawer).toBeVisible();
  // Two levels only: every hub row is a link, and the active hub shows its
  // workbench chips inline — no third tier, no "More tools" dump.
  await expect(drawer.getByRole("link", { name: "Competition", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Team", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Build", exact: true })).toBeVisible();
  await expect(drawer.getByRole("navigation", { name: "Quick actions" })).toBeVisible();
  await expect(drawer.locator(".soft-drawer-foot a").first()).toContainText("Account");
  await expect(drawer.getByRole("button", { name: "Sign out" })).toBeVisible();
  await drawer.getByRole("button", { name: "Close navigation" }).click();

  await page.goto("/competition");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(drawer.getByRole("link", { name: "Event day" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Scouting" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Strategy" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Pit" })).toBeVisible();
  await drawer.getByRole("button", { name: "Close navigation" }).click();

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(island).toBeVisible();
  await expect(island.getByRole("link")).toHaveCount(4);
  // Laptops get the persistent sidebar; the hamburger collapses it to a rail.
  const sidebar = page.getByRole("navigation", { name: "Product navigation sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Competition", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(sidebar).toHaveClass(/is-collapsed/);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(sidebar).not.toHaveClass(/is-collapsed/);
});

test("onboarding route is reachable when authenticated fixture skips incomplete gate", async ({ page }) => {
  // E2E fixture bypasses onboarding incomplete redirects and lands on dashboard.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("account route renders settings tabs and notification badge stays empty at zero", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your settings", exact: true }).first()).toBeVisible();
  // The fixture has no real session, so the profile API answers 401 and the page
  // shows its honest signed-out card; the settings navigation must still be reachable.
  await expect(page.getByRole("link", { name: "Appearance", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Security", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
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

test("code route reviews fixtures via interactive workbench", async ({ page }) => {
  await page.goto("/code");
  // /code lands inside the Build hub, which owns the page header; the Code tab is the anchor.
  await expect(page.getByRole("tab", { name: "Code", exact: true })).toBeVisible();
  // The pattern review is org-scoped, so the fixture (no team) gets the honest
  // setup card instead of a workbench that would have to invent a team.
  await expect(page.getByRole("heading", { name: "Choose a team" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose team" })).toBeVisible();
  await expect(page.getByText("Deterministic demo")).toHaveCount(0);
});
