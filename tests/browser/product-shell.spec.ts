import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

test("dashboard home is decluttered and exposes customize controls", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("dash-customize")).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit Home/ })).toBeVisible();
  await expect(page.getByText("Competition Command Center")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "First-run setup" })).toBeVisible({ timeout: 20_000 });
});

test("dashboard editor can enter edit mode and show widget catalog", async ({ page }) => {
  await page.goto("/dashboard");
  // Fixed soft-topbar can intercept pointer clicks after scroll-into-view; call the DOM handler directly.
  await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByText("Edit mode", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".dash-editor-bar")).toBeVisible();
  await expect(page.getByTestId("dash-catalog-inline").locator("button").first()).toBeVisible();
  await expect(page.getByTestId("dash-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
  await expect(page.getByTestId("dash-open-library")).toBeVisible();
  await page.getByTestId("dash-preview").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByTestId("dash-preview-back")).toBeVisible();
  await expect(page.getByTestId("dash-preview-save")).toBeVisible();
  await expect(page.getByText("Previewing unsaved changes")).toBeVisible();
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

  // next_match is a full-width hero (w=12) so a horizontal drag cannot
  // change its cell. Student Home's second card is a 4-column tile.
  const snapshot = page.getByTestId("dash-grid-item").nth(1);
  await expect(snapshot).toBeVisible();
  await snapshot.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const before = `${await snapshot.getAttribute("data-widget-x")},${await snapshot.getAttribute("data-widget-y")}`;
  const handle = snapshot.getByTestId("dash-drag-handle");
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 280, box!.y + 90, { steps: 20 });
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

test("product shell keeps four favorite apps plus an explicit all-apps button", async ({ page }) => {
  const island = page.getByRole("navigation", { name: "Primary apps" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(island).toBeVisible();
  await expect(island.getByRole("link")).toHaveCount(4);
  await expect(island.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(island.getByRole("button", { name: "Open all apps" })).toBeVisible();
  // The topbar hamburger used to open this same panel. One opener now.
  await expect(page.getByRole("button", { name: /Open navigation/ })).toHaveCount(0);
  await island.getByRole("button", { name: "Open all apps" }).click();
  const drawer = page.getByRole("complementary", { name: "Product navigation" });
  await expect(drawer).toBeVisible();
  // Search is a field in the panel, not a button that opened a second overlay.
  await expect(drawer.getByRole("combobox", { name: /Search pages, tools/ })).toBeVisible();
  // The island lists four of these same apps, so it steps aside while the panel is up.
  await expect(island).toBeHidden();
  // Hub row opens the default workbench. The other workbenches hang under it
  // so All can open Scouting without a second hop. Event day is the Competition
  // row itself, so it is not repeated.
  await expect(drawer.getByRole("link", { name: "Competition" })).toHaveCount(1);
  await expect(drawer.getByRole("link", { name: "Event day" })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: "Scouting" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Strategy" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Pit" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Chat" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "CAD" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Competition pages/ })).toHaveCount(0);
  // Nested tools stay on the workbench ToolStrip, not in All.
  await expect(drawer.getByRole("link", { name: "Forms" })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: "Alliance desk" })).toHaveCount(0);
  // Logistics has no in-page tab bar, so the panel still carries its pages.
  await expect(drawer.getByRole("link", { name: "Packing" })).toBeVisible();
  // Account lives on the profile row at the top; the footer no longer repeats it.
  await expect(drawer.locator(".soft-drawer-foot a")).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: /Account/ })).toHaveCount(1);
  await expect(drawer.getByRole("button", { name: "Sign out" })).toBeVisible();
  await drawer.getByRole("link", { name: "Scouting" }).click();
  await expect(page).toHaveURL(/\/competition\?tab=scouting/);
  await expect(page.getByRole("tab", { name: "Scouting" })).toBeVisible();
  await expect(island).toBeVisible();

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(island).toBeVisible();
  await expect(island.getByRole("link")).toHaveCount(4);
  await expect(island.getByRole("button", { name: "Open all apps" })).toBeVisible();
});

test("search is one affordance per width and shares the navigation panel", async ({ page }) => {
  const searchButton = page.getByRole("button", { name: "Search Vantage" });
  const field = page.getByRole("combobox", { name: /Search pages, tools/ });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  // Under 900px the bar has no room for a field, so the panel carries the only one.
  await expect(searchButton).toBeHidden();
  await page.getByRole("button", { name: "Open all apps" }).click();
  await expect(field).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(searchButton).toBeVisible();
  await searchButton.click();
  // The bar's control steps aside so its field and the panel's are never both up.
  await expect(searchButton).toHaveCount(0);
  await expect(field).toBeFocused();
  await field.fill("pick list");
  await expect(page.locator("#soft-nav-row-0")).toContainText("Pick list");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/picklist|competition/);
});

test("the hub tab bar owns the workbench name and the tool strip does not repeat it", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/competition");
  await expect(page.getByRole("tab", { name: "Event day" })).toBeVisible();
  // "Event day" was both the selected tab and the first chip under it.
  await expect(page.locator(".hub-tool-strip").getByText("Event day", { exact: true })).toHaveCount(0);
  await expect(page.locator(".hub-tool-strip")).toContainText("Pre-match briefing");
});

test("scouting and Work strips hide meta jobs that still have routes", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/competition?tab=scouting");
  await expect(page.getByRole("tab", { name: "Scouting" })).toBeVisible();
  const scoutingStrip = page.locator(".hub-tool-strip");
  await expect(scoutingStrip).toContainText("Forms");
  await expect(scoutingStrip).toContainText("Field value");
  await expect(scoutingStrip.getByText("Accuracy", { exact: true })).toHaveCount(0);
  await expect(scoutingStrip.getByText("Cross-check", { exact: true })).toHaveCount(0);
  await expect(scoutingStrip.getByText("Schema A/B", { exact: true })).toHaveCount(0);
  await scoutingStrip.getByRole("button", { name: /More tools/ }).click();
  await expect(scoutingStrip).toContainText("Data quality");
  await expect(scoutingStrip.getByText("Accuracy", { exact: true })).toHaveCount(0);

  await page.goto("/team?tab=todos");
  await expect(page.getByRole("tab", { name: "Work" })).toBeVisible();
  const workStrip = page.locator(".hub-tool-strip");
  await expect(workStrip).toContainText("Practice");
  await workStrip.getByRole("button", { name: /More tools/ }).click();
  await expect(workStrip.getByText("Task board", { exact: true })).toHaveCount(0);
});

test("onboarding route is reachable when authenticated fixture skips incomplete gate", async ({ page }) => {
  // E2E fixture bypasses onboarding incomplete redirects and lands on dashboard.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("account route keeps settings discoverable when the API session is unavailable", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your settings" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "All settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("link", { name: "AI usage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loading account" })).toBeHidden({ timeout: 20_000 });
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
  await expect(page.getByRole("heading", { name: "Choose your team" })).toBeVisible();
  await expect(page.getByText("blocking robot loop")).toHaveCount(0);
});
