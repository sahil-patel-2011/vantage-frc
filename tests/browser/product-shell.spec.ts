import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

test("dashboard home is decluttered and exposes customize controls", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Decluttered means Edit Home is inside "More", not beside the greeting.
  await expect(page.getByTestId("dash-customize")).not.toBeVisible();
  await page.locator(".dash-home-more > summary").click();
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
  await expect(island.getByRole("button")).toHaveCount(1);
  await expect(island.getByRole("button", { name: "Edit these apps" })).toBeVisible();
  await page.getByRole("button", { name: "Menu and search" }).click();
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

  // At desktop width the left rail replaces the phone bar (#2321, app-rail.css):
  // one navigation, not two.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(island).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Pillars" })).toBeVisible();
});

test("search is one affordance at every width, inside the navigation panel", async ({ page }) => {
  const field = page.getByRole("combobox", { name: /Search pages, tools/ });

  // There is no separate search button at any width any more. 538f3df62 gave
  // the top bar a real menu and folded search into it — one control labelled
  // "Menu and search" — and this spec kept looking for the old button, so it
  // had been failing on a shell that was behaving exactly as designed.
  const oldButton = page.getByRole("button", { name: "Search Vantage" });
  // Since #2321 the desktop rail carries Search itself and the top bar's
  // "Menu and search" is a phone control (app-rail.css hides it ≥1024px). One
  // opener per width, never two: the other one is not rendered visibly.
  const openerFor = (width: number) =>
    width >= 1024
      ? page.locator(".vrail-search")
      : page.getByRole("button", { name: "Menu and search" });

  for (const size of [
    { width: 390, height: 844 },
    { width: 1400, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/dashboard");
    await expect(oldButton).toHaveCount(0);
    await expect(field).toBeHidden();
    const other = size.width >= 1024 ? page.getByRole("button", { name: "Menu and search" }) : page.locator(".vrail-search");
    await expect(other).toBeHidden();

    await openerFor(size.width).click();
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(field).toBeHidden();
  }

  // And it searches: the panel's field is the only one, so this is the path.
  await openerFor(1400).click();
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
  // The strip shows three chips now, not six, so a tool being present and a
  // tool being a chip are different claims. What this test is about is which
  // tools the strip *offers at all* — so the ones further down are checked
  // where they actually live, behind one control.
  await expect(scoutingStrip.getByText("Accuracy", { exact: true })).toHaveCount(0);
  await expect(scoutingStrip.getByText("Cross-check", { exact: true })).toHaveCount(0);
  await expect(scoutingStrip.getByText("Schema A/B", { exact: true })).toHaveCount(0);
  await scoutingStrip.getByRole("button", { name: /More tools/ }).click();
  await expect(scoutingStrip).toContainText("Field value");
  await expect(scoutingStrip).toContainText("Data quality");
  // Still hidden, even with everything open: these are meta jobs that keep a
  // route but do not belong in a workbench strip.
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

  // This used to look for a <nav aria-label="All settings">, which the
  // settings switcher has not been since it became a card of rows. The point
  // of the test is that the settings are reachable, so it checks that.
  //
  // Two kinds of destination, and they are not interchangeable: the account's
  // own sections are tabs on this page, and everything else is a link away to
  // its own surface. Asserting a link named "Appearance" failed for a while
  // and looked like a missing feature — the panel was there all along, one
  // tab across.
  for (const tab of ["Profile", "Appearance", "Notifications"]) {
    // Buttons in a ToolStrip, not a tablist — Account's sections switch in
    // place but do not carry tab semantics.
    await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
  }
  for (const link of ["Security", "AI usage", "Billing", "Connectors"]) {
    await expect(page.getByRole("link", { name: link, exact: true }).first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Appearance", exact: true }).click();
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
