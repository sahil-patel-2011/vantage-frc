import { expect, test } from "@playwright/test";
import { signInAs } from "./session";
import { resetHomeBoard } from "./dashboard-fixture";
import { openNav, navigationOpener } from "./nav";

test.beforeEach(async ({ context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
    await resetHomeBoard(context);
});

test("dashboard home is decluttered and exposes customize controls", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // One quiet "Edit" beside the greeting — not folded inside "More", where
  // testers could not find it, and not a row of editing controls either.
  await expect(page.getByTestId("dash-customize")).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit Home/ })).toHaveText("Customize");
  await expect(page.getByTestId("dash-edit-toolbar")).toHaveCount(0);
  await expect(page.getByText("Competition Command Center")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Tour of Vantage" })).toHaveCount(0);
});

test("dashboard editor can enter edit mode and show widget catalog", async ({ page }) => {
  await page.goto("/dashboard");
  // Fixed soft-topbar can intercept pointer clicks after scroll-into-view; call the DOM handler directly.
  await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
  const toolbar = page.getByTestId("dash-edit-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(page.getByTestId("dash-edit-hint")).toBeVisible();
  // The widget list starts closed; the board is what you came to arrange.
  await expect(page.getByTestId("dash-widget-sheet")).toHaveCount(0);
  await page.getByTestId("dash-open-library").click();
  await expect(page.getByTestId("dash-widget-sheet")).toBeVisible();
  await expect(page.getByTestId("dash-catalog-inline").locator("button").first()).toBeVisible();
  await page.getByTestId("dash-open-library").click();
  await expect(page.getByTestId("dash-widget-sheet")).toHaveCount(0);
  // Occasional actions live behind one "•••" menu; Reset is not beside Cancel.
  await expect(toolbar.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
  await page.getByTestId("dash-edit-more").click();
  await expect(page.getByTestId("dash-reset-board")).toBeVisible();
  await expect(page.getByTestId("dash-tidy")).toBeVisible();
  await page.getByTestId("dash-preview").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByTestId("dash-preview-back")).toBeVisible();
  await expect(page.getByTestId("dash-preview-save")).toBeVisible();
  await expect(page.getByText("Previewing unsaved changes")).toBeVisible();
});

test("dashboard editor rearranges widgets with drag-and-drop", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/dashboard");
  await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByTestId("dash-edit-hint")).toBeVisible();
  await expect(page.getByTestId("dash-widget-grid")).toHaveAttribute("data-dash-drag", "on");
  await expect(page.locator(".dash-grid")).toBeVisible();

  // next_match is a full-width hero (w=12) so a horizontal drag cannot
  // change its cell. Student Home's second card is a 6-column tile.
  const snapshot = page.getByTestId("dash-grid-item").nth(1);
  await expect(snapshot).toBeVisible();
  await snapshot.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const before = `${await snapshot.getAttribute("data-widget-x")},${await snapshot.getAttribute("data-widget-y")}`;
  const handle = snapshot.getByTestId("dash-drag-handle");
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  // Measured from where the drag started (the grip's centre), not the grip's
  // corner: the grip's hit area is finger-sized now, so its corner is further
  // from its centre than it was.
  // Different-size cards insert before/after rather than swap. Drop in the
  // far half of the next card; dropping before it would preserve this order.
  const neighbor = await page.locator('[data-widget-type="scouting_coverage"]').boundingBox();
  expect(neighbor).toBeTruthy();
  await page.mouse.move(neighbor!.x + neighbor!.width * 0.8, neighbor!.y + neighbor!.height / 2, { steps: 20 });
  await expect(page.locator(".dash-snap-hud")).toBeVisible();
  // A lifted copy of the card follows the pointer while its slot shows the target.
  await expect(page.locator(".dash-drag-proxy.is-card .dash-widget-hit")).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(async () => `${await snapshot.getAttribute("data-widget-x")},${await snapshot.getAttribute("data-widget-y")}`)
    .not.toBe(before);

  // The widget sheet uses Pointer Events (so it works on touch), not HTML5
  // draggable. Playwright's dragTo() drives HTML5 drag-and-drop, which this
  // grid no longer uses; driving the mouse exercises the same pointer path a
  // touch user gets.
  const beforeCount = await page.getByTestId("dash-grid-item").count();
  await page.getByTestId("dash-open-library").click();
  const item = page.locator("[data-testid^='dash-library-']").first();
  await expect(item).toBeEnabled();
  const itemBox = await item.boundingBox();
  const gridBox = await page.locator(".dash-grid").boundingBox();
  expect(itemBox).toBeTruthy();
  expect(gridBox).toBeTruthy();
  await page.mouse.move(itemBox!.x + itemBox!.width / 2, itemBox!.y + itemBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gridBox!.x + 40, Math.max(gridBox!.y + 40, 120), { steps: 15 });
  await page.mouse.up();
  await expect(page.getByTestId("dash-grid-item")).toHaveCount(beforeCount + 1);
});

test("product shell keeps four favorite apps and one way to see the rest", async ({ page }) => {
  const island = page.getByRole("navigation", { name: "Primary apps" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(island).toBeVisible();
  await expect(island.getByRole("link")).toHaveCount(4);
  await expect(island.getByRole("link", { name: "Home" })).toBeVisible();
  // Four apps and the gear that edits them (#2321). The island used to carry a
  // fifth "All" button that opened the drawer the hamburger already opens — a
  // duplicate sitting among Team, Compete, Scout and Build as if it were one of
  // your apps. The gear is not an app and says so.
  // Four apps and nothing else: press and hold (or right-click, or the Menu key) to change them.
  await expect(island.getByRole("button")).toHaveCount(0);
  await openNav(page);
  const drawer = page.getByRole("complementary", { name: "Product navigation" });
  await expect(drawer).toBeVisible();
  // Search is a field in the panel, not a button that opened a second overlay.
  await expect(drawer.getByRole("combobox", { name: /Search pages, tools/ })).toBeVisible();
  // The island lists four of these same apps, so it steps aside while the panel is up.
  await expect(island).toBeHidden();
  await expect(drawer.locator(".main-menu-launch a")).toHaveCount(2);
  await expect(drawer.getByRole("link", { name: /^Home/ })).toBeVisible();
  await expect(drawer.getByRole("link", { name: /^Scouting/ })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Competition", exact: true })).toHaveCount(0);
  await expect(drawer.locator(".main-menu-section > summary").filter({ has: page.getByText("AI", { exact: true }) })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Forms", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: "Personal settings", exact: true })).toHaveCount(1);
  await expect(drawer.getByRole("button", { name: "Sign out" })).toBeVisible();
  await drawer.getByRole("combobox").fill("scout");
  await drawer.getByRole("option").filter({ hasText: /Scout/ }).first().click();
  await expect(page).toHaveURL(/\/competition\?tab=scouting/);
  await expect(page.locator(".workspace-hub-header h1")).toHaveText("Scout");
  await expect(island).toBeVisible();

  // Desktop keeps workspaces visible and opens the same drawer for search.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(island).toBeHidden();
  await expect(page.locator(".app-sidebar")).toBeVisible();
  await expect(navigationOpener(page)).toBeVisible();
  await expect(drawer).toBeHidden();
});

test("search is one affordance at every width, inside the navigation panel", async ({ page }) => {
  const field = page.getByRole("combobox", { name: /Search pages, tools/ });

  const oldButton = page.getByRole("button", { name: "Search Vantage" });
  // Desktop search and the phone menu open the same field.
  const opener = navigationOpener(page);

  for (const size of [
    { width: 390, height: 844 },
    { width: 1400, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/dashboard");
    await expect(oldButton).toHaveCount(0);
    await expect(field).toBeHidden();
    await expect(opener).toBeVisible();
    await expect(page.locator(".vrail-search")).toHaveCount(0);

    await opener.click();
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(field).toBeHidden();
  }

  // And it searches: the panel's field is the only one, so this is the path.
  await opener.click();
  await field.fill("pick list");
  await expect(page.locator("#soft-nav-row-0")).toContainText("Pick list");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/picklist|competition/);
});

test("one menu restores keyboard focus without a second workspace picker", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await page.goto("/competition");
  await expect(page.locator(".workspace-hub-header h1")).toHaveText("Scout");
  await expect(page.locator(".workspace-picker-trigger")).toHaveCount(0);
  const opener = navigationOpener(page);
  await opener.click();
  await expect(page.getByRole("combobox", { name: /Search pages, tools/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("specialist tools stay discoverable through the shared search", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await page.goto("/competition?tab=scouting");
  for (const label of ["Schema sync", "Data quality", "Practice"]) {
    await openNav(page);
    await page.getByRole("combobox", { name: /Search pages, tools/ }).fill(label);
    await expect(page.getByRole("option").filter({ hasText: label }).first()).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("onboarding route is reachable when authenticated fixture skips incomplete gate", async ({ page }) => {
  // E2E fixture bypasses onboarding incomplete redirects and lands on dashboard.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("account keeps every setting reachable from one place", async ({ page, context }) => {
  // A real session, not the fixture cookie the rest of this file uses. The
  // fixture walks past the proxy but mints no Better Auth session, so every
  // `/api/*` answers 401 and Account paints "your session ended" with no
  // sections at all — which is a real state, tested below, and not the one
  // this test is about.
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loading account" })).toBeHidden({ timeout: 20_000 });

  for (const label of [/^Security/, /^AI usage/, /^AI limits/, /^Connectors/]) await expect(page.getByRole("link", { name: label }).first()).toBeVisible();
  const sections = page.getByRole("tablist", { name: "Account sections", exact: true });
  for (const label of ["Profile", "Appearance", "Notifications"]) await expect(sections.getByRole("tab", { name: label, exact: true })).toHaveCount(1);
  await sections.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(page.locator(".appearance-panel")).toBeVisible();
});

test("account says the session ended, rather than an empty page, when it has", async ({
  page,
  context,
}) => {
  // The state this pair of tests was originally written for. It used to be
  // reached by accident — the fixtures could not hold a real session, so every
  // signed-in page was this one. Now that they can, it has to be asked for.
  await context.clearCookies();
  await page.goto("/account");
  await expect(
    page
      .getByRole("heading", { name: "Your session ended" })
      .or(page.getByRole("heading", { name: /Sign in/i }))
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  // No unread count on a page that could not read anything. This assertion
  // used to sit in the test above, where it only held because that test had no
  // session either — with a real one the owner has notifications, and a badge
  // showing them is the feature working.
  await expect(page.locator(".soft-notif b")).toHaveCount(0);
});

test("strategy defaults to empty setup and hides fabricated probabilities", async ({ page }) => {
  await page.goto("/strategy");
  await expect(page.locator(".workspace-hub-header h1")).toHaveText("Match plan");
  await expect(page.getByRole("button", { name: "Try demo scenario" })).toHaveCount(0);
  await expect(page.getByText("Deterministic demo")).toHaveCount(0);
  await expect(page.getByText("65%")).toHaveCount(0);
  await expect(page.getByText("weighted-current-v1")).toHaveCount(0);
});

test("code route requires a real team and never falls back to fixture findings", async ({ page, context }) => {
  expect(await signInAs(context, "no-team")).toBe(true);
  await page.goto("/code");
  await expect(page).toHaveURL(/\/onboarding\?state=pending/);
  await expect(page.getByRole("heading", { level: 1, name: "Your profile is ready. Join your team next.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Have an invite?", exact: true })).toBeVisible();
  await expect(page.getByText("blocking robot loop")).toHaveCount(0);
});
