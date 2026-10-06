import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./session";

async function openRobots(page: Page) {
  await page.goto("/competition?tab=teams");
  await expect(page.locator(".stp-row").first()).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  expect(await signInAs(context, "owner"), "Real owner session and seeded scouting required").toBe(true);
});

test("profile sections preserve comparison and expose real reports without duplicate navigation", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRobots(page);
  const detail = page.locator(".std");
  await detail.getByRole("button", { name: "Add to comparison" }).click();
  await detail.getByRole("tab", { name: "Matches", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Match by match" })).toBeVisible();
  await expect(detail.locator(".stml-table tbody tr").first()).toBeVisible();
  await detail.getByText("Original scout reports", { exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Original match reports" })).toBeVisible();
  await detail.getByRole("tab", { name: "Capabilities", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "From our scouting" })).toBeVisible();
  await expect(detail.getByRole("group", { name: "Scouting result view" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Remove from comparison" })).toHaveAttribute("aria-pressed", "true");
  await detail.getByRole("tab", { name: "Capabilities", exact: true }).press("ArrowRight");
  await expect(detail.getByRole("tab", { name: "Notes", exact: true })).toBeFocused();
  await expect(detail.getByRole("heading", { name: "Private scout notes" })).toBeVisible();
  await detail.getByRole("tab", { name: "Notes", exact: true }).press("Home");
  await expect(detail.getByRole("tab", { name: "Overview", exact: true })).toBeFocused();
  const trend = detail.locator(".sdc-trend-line");
  await expect(trend).toHaveCSS("fill", "none");
  await expect(trend).toHaveCSS("stroke-width", "2px");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await trend.evaluate(line => Number.parseFloat(getComputedStyle(line).strokeDashoffset))).toBe(0);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, issue: n.failureSummary })) }))).toEqual([]);
  await page.screenshot({ path: info.outputPath("robot-profile-1440.png") });
});

test("phone returns to the same filtered robot and keyboard focus", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openRobots(page);
  await expect(page.locator(".std")).toBeHidden();
  await page.getByRole("searchbox", { name: "Find a team" }).fill("254");
  const robot = page.locator(".stp-row-main").first();
  await robot.scrollIntoViewIfNeeded();
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await robot.click();
  await expect(page.locator(".std")).toBeVisible();
  await expect(page.locator(".std")).toBeFocused();
  await expect(page.locator(".stp-browse")).toBeHidden();
  await page.getByRole("tab", { name: "Capabilities", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: info.outputPath("robot-profile-320.png") });
  await page.getByRole("button", { name: "All robots" }).click();
  await expect(page.getByRole("searchbox", { name: "Find a team" })).toHaveValue("254");
  await expect(robot).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(beforeScroll, 0);
  await expect(page.locator(".std")).toBeHidden();
});

test("failed match history offers a working retry against the real API", async ({ page }) => {
  let fail = true;
  await page.route("**/api/scouting/team-matches?**", route => fail
    ? route.fulfill({ status: 500, json: { error: "Temporary test failure" } }) : route.continue());
  await openRobots(page);
  await page.locator(".std").getByRole("tab", { name: "Matches", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry matches" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry matches" }).click();
  await expect(page.locator(".stml-table tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry matches" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add a video link" })).toBeVisible();
});

test("offline match history recovers on reconnection and expired sessions ask for sign-in", async ({ page, context }) => {
  await openRobots(page);
  await context.setOffline(true);
  await page.locator(".std").getByRole("tab", { name: "Matches", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry matches" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".stml-table tbody tr").first()).toBeVisible();
  await page.route("**/api/scouting/team-matches?**", route => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.locator(".stp-row-main").nth(1).click();
  await page.locator(".std").getByRole("tab", { name: "Matches", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in again", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry matches" })).toHaveCount(0);
});

test("robot list can retry a failed load and still show robots with no scored total", async ({ page }) => {
  let fail = true;
  let unscoredTeam = "";
  await page.route("**/api/scouting/teams?**", async route => {
    if (fail) return route.fulfill({ status: 500, json: { error: "Temporary test failure" } });
    const response = await route.fetch();
    const data = await response.json();
    // Keep the real recorded observations but remove one robot's scored view,
    // as happens when its reports cannot produce a valid formula total.
    unscoredTeam = data.profiles[0].teamKey;
    data.profiles = data.profiles.filter((row: { teamKey: string }) => row.teamKey !== unscoredTeam);
    data.pickOrder = data.pickOrder.filter((row: { teamKey: string }) => row.teamKey !== unscoredTeam);
    data.weighted = data.weighted.filter((row: { teamKey: string }) => row.teamKey !== unscoredTeam);
    await route.fulfill({ response, json: data });
  });
  await page.goto("/competition?tab=teams");
  await expect(page.getByRole("button", { name: "Retry scouting" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry scouting" }).click();
  await expect(page.locator(".stp-row").first()).toBeVisible();
  await page.getByText("Robots without a scored total", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Recorded robot capabilities" }).getByRole("combobox", { name: "Robot", exact: true })).toHaveValue(unscoredTeam);
  await expect(page.getByRole("region", { name: "Recorded robot capabilities" }).getByRole("heading", { name: "From our scouting" })).toBeVisible();
});
