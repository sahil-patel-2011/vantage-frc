import { expect, test, type Page } from "@playwright/test";
import { signInFixture } from "./session";
import { workspace } from "./fixtures/workspace-ui";
import { openNav } from "./nav";
import AxeBuilder from "@axe-core/playwright";

// Real page components with API fixtures; persistence is covered by the API suites.
async function productWorkspace(page: Page) {
  await workspace(page);
  const context = { orgId: "ui-team", orgName: "Circuit Breakers", teamNumber: 6925, role: "owner", userId: "ui-user", canManage: true };
  const start = new Date(); start.setHours(16, 0, 0, 0);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/team/calendar") body = {
      status: "ready", context, subteams: [], members: [], mySubteamIds: [], duties: [], travelLegs: [], attendanceEvents: [], practiceSessions: [],
      calendarFeed: { token: null, scope: "personal", subteamId: null },
      events: [{ id: "event-1", title: "Drive practice", kind: "practice", startsAt: start.toISOString(), endsAt: new Date(+start + 3_600_000).toISOString(), location: "Build room", notes: "Check autonomous routines", subteamId: null, subteamName: null, subteamColor: null, attendanceEventId: null, attendanceEventTitle: null, milestoneId: null, driverSessionId: null, createdBy: "ui-user", createdByName: "Alex", myRsvp: "going", rsvpGoing: 4, rsvpMaybe: 1, rsvpNo: 0 }],
    };
    if (path === "/api/todos") body = {
      status: "live", orgId: "ui-team", teamNumber: 6925, currentUserId: "ui-user", members: [{ userId: "ui-user", name: "Alex", role: "owner" }], subteams: [],
      todos: [{ id: "task-1", title: "Check the robot battery", notes: "Before drive practice", status: "todo", assigneeUserId: "ui-user", assigneeName: "Alex", subteamId: null, subteamName: null, subteamColor: null, dueOn: null, completedAt: null, completedBy: null, createdBy: "ui-user", createdByName: "Alex", createdAt: start.toISOString(), updatedAt: start.toISOString(), flags: { overdue: false, dueSoon: false, daysToDue: null } }],
      metrics: { total: 1, todo: 1, doing: 0, done: 0, overdue: 0, dueSoon: 0, mineOpen: 1 }, focusTodoId: null, computedAt: start.toISOString(),
    };
    if (path === "/api/account") body = { displayName: "Alex Morgan", firstName: "Alex", lastName: "Morgan", email: "alex@example.test", teamRole: "student" };
    if (path === "/api/sustainability") body = { status: "setup_required", message: "Record funding sources to see your sustainability check." };
    if (path === "/api/kickoff") body = { status: "ready", context: { ...context, defaultSeasonYear: 2026 }, actions: [], priorities: [], ruleNotes: [], nextSeasonSignals: [] };
    if (path === "/api/business") body = {
      status: "live", orgId: "ui-team", orgName: "Circuit Breakers", teamNumber: 6925, role: "owner", canManageFinance: true, sponsorsAllowed: true, seasonYear: 2026, seasons: [2026],
      budget: { totalBudgetCents: 2_000_000, seasonBudgetCents: 2_000_000, fundraisingGoalCents: 1_000_000, sponsorIncomeCents: 500_000, grantIncomeCents: 100_000, requestedCents: 0, committedCents: 400_000, spentCents: 300_000, remainingCents: 1_600_000, monthlySpend: [] },
      impact: { activities: 0, hours: 0, peopleReached: 0 }, categories: [], purchases: [], sponsors: [], sponsorReminders: [], interactions: [], prospects: [], grants: [], awards: [], drafts: [],
      fundraisingProgress: { goalCents: 1_000_000, actualCashCents: 500_000, grantIncomeCents: 100_000, actualCents: 600_000, pledgedPipelineCents: 0, remainingCents: 400_000, percentOfGoal: 60, stages: [] },
    };
    if (body === undefined) return route.fallback();
    await route.fulfill({ json: body });
  });
}

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

for (const width of [1440, 390]) {
  test(`shared chrome and working feature controls fit at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(90_000);
    await signInFixture(context);
    await productWorkspace(page);
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const [route, ready] of [
      ["/team?tab=calendar", ".tc-page .tc-layout"],
      ["/team?tab=todos", ".todos-create"],
      ["/build?tab=kickoff", ".kick-embedded-controls"],
      ["/business?tab=overview", ".biz-kpis"],
      ["/account?tab=profile", ".account-form"],
    ]) {
      await page.goto(`${route}&orgId=ui-team`);
      await expect(page.locator(ready)).toBeVisible();
      if (!route.startsWith("/account")) await expect(page.locator(".workspace-hub-header h1")).toBeInViewport();
      if (route.startsWith("/business")) await expect(page.locator(".biz-sustain")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Something went wrong on this screen", exact: true })).toHaveCount(0);
      await expect(page.locator(".app-sidebar")).toBeVisible({ visible: width >= 1100 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const name = `${route.split("?")[0].slice(1)}-${route.split("=")[1]}-${width}.png`;
      const path = info.outputPath(name);
      await page.screenshot({ path, fullPage: true });
      await info.attach(name, { path, contentType: "image/png" });
    }
    expect(errors).toEqual([]);
    await expect(page.getByRole("button", { name: "Save profile", exact: true })).toBeVisible();
    if (width === 390) {
      await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      await expect(page.locator(".account-panel").first()).toHaveCSS("background-color", "rgb(32, 35, 43)");
      await info.attach("settings-dark-mobile.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
  });
}

test("sidebar collapse persists, workspace tabs support the keyboard, and search restores focus across breakpoints", async ({ page, context }) => {
  await signInFixture(context);
  await productWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/team?tab=calendar&orgId=ui-team");
  const tabs = page.getByRole("tablist", { name: "Team sections", exact: true });
  const calendar = tabs.getByRole("tab", { name: "Calendar", exact: true });
  await expect(calendar).toHaveAttribute("aria-selected", "true");
  await calendar.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/tab=messages/);
  await expect(tabs.getByRole("tab", { name: "Chat", exact: true })).toBeFocused();
  await calendar.click();
  await expect(page).not.toHaveURL(/tab=messages/);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.locator("body")).toHaveClass(/shell-sidebar-collapsed/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.locator("body")).not.toHaveClass(/shell-sidebar-collapsed/);
  await expect(page.locator(".app-sidebar-team")).toHaveAttribute("href", "/workspace");
  await openNav(page);
  const search = page.getByRole("combobox", { name: "Search pages, tools, and your team's data", exact: true });
  await expect(search).toBeFocused();
  await search.fill("calendar");
  await expect(page.locator(".command-group")).toContainText("Calendar");
  await page.setViewportSize({ width: 390, height: 960 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu and search", exact: true })).toBeFocused();
  await openNav(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search pages, tools, and team data", exact: true })).toBeFocused();
});

test("shared navigation and workspace tabs have no accessibility violations", async ({ page, context }) => {
  await signInFixture(context);
  await productWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/team?tab=calendar&orgId=ui-team");
  await expect(page.locator(".tc-layout")).toBeVisible();
  const audit = await new AxeBuilder({ page }).include(".app-sidebar").include(".soft-topbar").include(".workspace-hub-tabs").analyze();
  expect(audit.violations).toEqual([]);
});
