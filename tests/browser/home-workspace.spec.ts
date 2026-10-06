import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { signInAs } from "./session";

const orgId = "6925a000-0000-4000-8000-000000000001";
test.use({ actionTimeout: 15_000 });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

for (const recovered of [true, false]) test(`reference data ${recovered ? "recovers silently" : "reports an unavailable result"}`, async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await page.route("**/api/dashboards?**", async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.active) body.active.layout = [{ i: "results", type: "recent_result", x: 0, y: 0, w: 12, h: 4, config: { alwaysShow: true } }];
    if (body.context) body.context = { ...body.context, tbaConfigured: true, dataSourceHealth: {
      degraded: true, mode: "unavailable", usingLastGoodCache: recovered, cacheHasRows: recovered, sources: [],
      bannerTitle: "Provider refresh failed", bannerDetail: "Internal fixture diagnostics", teamDataHref: "/team/data",
    } };
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/dashboard?orgId=${orgId}`);
  await expect(page.getByTestId("dash-widget-grid")).toBeVisible();
  await expect(page.getByText("Using saved copy", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Internal fixture diagnostics", { exact: true })).toHaveCount(0);
  if (recovered) await expect(page.locator(".data-source-degraded-banner")).toHaveCount(0);
  else await expect(page.locator(".data-source-degraded-banner")).toContainText("Rankings and schedule unavailable");
});

for (const width of [1440, 390]) {
  test(`Home shows real scouting progress and the next calendar activity at ${width}px`, async ({ page, context }, info) => {
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    const scheduled = new Date(Date.now() + 3_600_000).toISOString();
    let reports: number | undefined;
    let writes = 0;
    page.on("request", req => { if (req.url().includes("/api/dashboards") && req.method() !== "GET") writes++; });
    await page.route("**/api/dashboards?**", async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.active) body.active.layout = [{ i: "scouting", type: "scouting_coverage", x: 0, y: 0, w: 12, h: 5 }];
      if (body.widgets) {
        reports = body.widgets.scouting_coverage?.data?.reports;
        body.widgets.calendar_today = { type: "calendar_today", status: "live", data: { items: [{ title: "Dashboard practice fixture", startsAt: scheduled }] } };
        body.widgets.my_day = { type: "my_day", status: "empty" };
        body.widgets.next_match = { type: "next_match", status: "empty" };
        body.widgets.hours_month = { type: "hours_month", status: "empty" };
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto(`/dashboard?orgId=${orgId}`);
    const overview = page.getByTestId("dash-widget-grid");
    await expect(overview).toBeVisible();
    await expect(overview.getByRole("heading", { name: "Scouting", exact: true })).toBeVisible();
    await expect(page.getByTestId("dash-now")).toContainText("Dashboard practice fixture");
    await expect.poll(() => reports).toBeGreaterThan(0);
    await expect(overview.locator(".dash-scout-card")).toContainText(String(reports));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({ page }).include(".dash-grid-wrap").analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`home-overview-${width}.png`), fullPage: true });
    expect(writes).toBe(0);
    await page.getByTestId("dash-now-cta").click();
    await expect(page).toHaveURL(/tab=calendar/);
    await expect(page.getByRole("heading", { name: "Calendar", exact: true }).first()).toBeVisible();
  });

  test(`ranking and discussion use the same saved pick list at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    const created = await context.request.post("/api/picklist-collab", { data: { orgId, action: "create-list", name: `Unified workspace ${Date.now()}`, eventKey: "2026gacmp" } });
    expect(created.ok(), await created.text()).toBe(true);
    const view = await created.json();
    const listId = view.activeList.id;
    const pool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    try {
      expect((await context.request.post("/api/picklist-collab", { data: { orgId, listId, action: "add-entry", teamNumber: 254, tier: "first_pick", note: "Shared list fixture" } })).ok()).toBe(true);
      await page.goto(`/competition?tab=picks&orgId=${orgId}&listId=${listId}`);
      await expect(page.getByLabel("List name", { exact: true })).toHaveValue(view.activeList.name);
      await page.getByLabel("List name", { exact: true }).fill("Unsaved ranking fixture");
      await page.getByRole("button", { name: "Team discussion", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Keep your ranking changes?" })).toBeVisible();
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(page.getByLabel("List name", { exact: true })).toHaveValue("Unsaved ranking fixture");
      await page.getByRole("button", { name: "Team discussion", exact: true }).click();
      await page.getByRole("button", { name: "Discard and switch", exact: true }).click();
      await expect(page).toHaveURL(/view=discussion/);
      const row = page.locator(".picklist-collab-entry").filter({ hasText: "#254" });
      await expect(row).toBeVisible();
      const vote = page.waitForResponse(response => response.url().includes("/api/picklist-collab") && response.request().method() === "POST");
      await row.getByRole("button", { name: "Vote", exact: true }).click();
      expect((await vote).ok()).toBe(true);
      await expect(row).toContainText("1 vote");
      const stored = await (await context.request.get(`/api/picklist-collab?orgId=${orgId}&listId=${listId}`)).json();
      expect(stored.entries[0].votes).toHaveLength(1);
      await page.getByRole("button", { name: "Rank teams", exact: true }).click();
      await expect(page.getByLabel("List name", { exact: true })).toHaveValue(view.activeList.name);
      await page.goto(`/picklist-collab?orgId=${orgId}&listId=${listId}`);
      await expect(page).toHaveURL(/tab=picks/);
      await expect(row).toContainText("1 vote");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`pick-list-discussion-${width}.png`), fullPage: true });
    } finally {
      await pool.query("DELETE FROM pick_lists WHERE org_id=$1 AND id=$2", [orgId, listId]);
      await pool.end();
    }
  });
}
