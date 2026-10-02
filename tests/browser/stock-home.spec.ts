import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { signInAs } from "./session";

const orgId = "6925a000-0000-4000-8000-000000000001";
const ownerId = "6925e2e0-0000-4000-8000-000000000001";
test.use({ actionTimeout: 15_000 });

for (const width of [1440, 390]) test(`stock Home works immediately and reflects committed changes at ${width}px`, async ({ page, context }, info) => {
  test.setTimeout(120_000);
  expect(await signInAs(context, "owner")).toBe(true);
  await page.setViewportSize({ width, height: 950 });
  const pool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const original = await (await context.request.get(`/api/dashboards?orgId=${orgId}&mode=home`)).json();
  const board = original.active;
  const title = `Stock Home task ${width} ${Date.now()}`;
  const activity = `Stock Home practice ${width} ${Date.now()}`;
  let eventId: string | undefined;
  let taskId: string | undefined;
  let matchKey: string | undefined;
  try {
    expect((await context.request.post("/api/dashboards", { data: { orgId, action: "reset", id: board.id } })).ok()).toBe(true);
    await page.goto(`/dashboard?orgId=${orgId}`);
    const tasks = page.getByTestId("home-tasks");
    await expect(tasks).toBeVisible();
    await expect(page.getByTestId("dash-edit-toolbar")).toHaveCount(0);
    await expect(page.locator('[data-widget-type="team_todos"], [data-widget-type="my_day"], [data-widget-type="scouting_coverage"]')).toHaveCount(0);
    await tasks.getByRole("textbox", { name: "New team task" }).fill(title);
    const created = page.waitForResponse(response => response.url().endsWith("/api/todos") && response.request().method() === "POST");
    await tasks.getByRole("button", { name: "Add task", exact: true }).click();
    expect((await created).ok()).toBe(true);
    const stored = await pool.query("SELECT id,status FROM team_todos WHERE org_id=$1 AND title=$2", [orgId, title]);
    expect(stored.rows).toHaveLength(1);
    taskId = stored.rows[0].id;
    await expect(tasks.getByRole("link", { name: title, exact: false })).toBeVisible();
    await tasks.getByRole("checkbox", { name: `Complete ${title}`, exact: true }).click();
    await expect(tasks.getByRole("link", { name: title, exact: false })).toHaveCount(0);
    expect((await pool.query("SELECT status FROM team_todos WHERE id=$1", [taskId])).rows[0].status).toBe("done");

    // Another team's client commits a task. Home must update without navigation or reload.
    const other = await context.request.post("/api/todos", { data: { orgId, action: "update-todo", todoId: taskId, status: "todo" } });
    expect(other.ok()).toBe(true);
    await expect(tasks.getByRole("checkbox", { name: `Complete ${title}`, exact: true })).toBeVisible({ timeout: 25_000 });

    // Let an older real snapshot arrive after completion; it must not resurrect the task.
    let release = () => {};
    let captured = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { captured = resolve; });
    let held = false;
    await page.route("**/api/dashboards?**", async route => {
      if (held || !route.request().url().includes("context=full")) return route.continue();
      held = true;
      const response = await route.fetch();
      const body = await response.json();
      captured();
      await gate;
      await route.fulfill({ response, json: body });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await ready;
    try {
      await tasks.getByRole("checkbox", { name: `Complete ${title}`, exact: true }).click();
      await expect(tasks.getByRole("checkbox", { name: `Complete ${title}`, exact: true })).toHaveCount(0);
    } finally { release(); }
    await page.unrouteAll({ behavior: "wait" });
    await expect(tasks.getByRole("checkbox", { name: `Complete ${title}`, exact: true })).toHaveCount(0);
    // Put this test task back on the board for its open-details navigation below.
    expect((await context.request.post("/api/todos", { data: { orgId, action: "update-todo", todoId: taskId, status: "todo" } })).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(tasks.getByRole("checkbox", { name: `Complete ${title}`, exact: true })).toBeVisible();

    eventId = (await pool.query("INSERT INTO subteam_calendar_events(org_id,title,starts_at,ends_at,created_by) VALUES($1,$2,now()-interval '20 minutes',now()+interval '2 hours',$3) RETURNING id", [orgId, activity, ownerId])).rows[0].id;
    await expect(page.getByTestId("dash-overview").getByRole("link", { name: activity, exact: false })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("dash-overview")).toContainText("Happening now");
    const eventKey = (await pool.query("SELECT active_event_key FROM org_active_context WHERE org_id=$1", [orgId])).rows[0].active_event_key;
    const matchNumber = width === 1440 ? 99881 : 99882;
    matchKey = `${eventKey}_qm${matchNumber}`;
    await pool.query("INSERT INTO matches_ref(match_key,event_key,comp_level,set_number,match_number,red_alliance,blue_alliance,event_time) VALUES($1,$2,'qm',1,$3,$4::jsonb,$5::jsonb,now()+interval '20 minutes')", [matchKey, eventKey, matchNumber,
      JSON.stringify({ teamKeys: ["frc6925", "frc254", "frc1678"], score: -1 }), JSON.stringify({ teamKeys: ["frc1323", "frc2056", "frc999"], score: -1 })]);
    const match = page.getByTestId("home-next-match");
    await expect(match).toContainText(`Qual ${matchNumber}`, { timeout: 25_000 });
    await expect(match).toContainText("RED bumpers");
    expect((await match.boundingBox())!.y).toBeLessThan((await tasks.boundingBox())!.y);
    await expect(page.locator('[data-widget-type="next_match"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({ page }).include(".dash-overview").analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`stock-home-${width}.png`), fullPage: true });
    await tasks.getByRole("link", { name: title, exact: false }).click();
    await expect(page).toHaveURL(new RegExp(`todoId=${taskId}`));
  } finally {
    await page.goto("/privacy");
    if (taskId) await pool.query("DELETE FROM team_todos WHERE org_id=$1 AND id=$2", [orgId, taskId]);
    if (eventId) await pool.query("DELETE FROM subteam_calendar_events WHERE org_id=$1 AND id=$2", [orgId, eventId]);
    if (matchKey) await pool.query("DELETE FROM matches_ref WHERE match_key=$1", [matchKey]);
    await pool.query("UPDATE dashboards SET layout=$2::jsonb WHERE id=$1 AND org_id=$3", [board.id, JSON.stringify(board.layout), orgId]);
    await pool.end();
  }
});

test("Home refreshes on reconnection and a failed task write preserves the draft", async ({ page, context }) => {
  test.setTimeout(90_000);
  expect(await signInAs(context, "member")).toBe(true);
  await page.goto(`/dashboard?orgId=${orgId}`);
  const tasks = page.getByTestId("home-tasks");
  await expect(tasks).toBeVisible();
  const request = page.waitForRequest(request => request.url().includes("mode=snapshot") && request.url().includes("context=full"));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await request;
  const input = tasks.getByRole("textbox", { name: "New team task" });
  await input.fill("Keep my task draft after a failed save");
  await page.route("**/api/todos", route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "Task save unavailable" } }) : route.continue());
  await tasks.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(tasks.getByRole("alert")).toContainText("Task save unavailable");
  await expect(input).toHaveValue("Keep my task draft after a failed save");
  await expect(tasks.getByRole("status")).not.toContainText("Task added.");
  await page.unrouteAll({ behavior: "wait" });
});
