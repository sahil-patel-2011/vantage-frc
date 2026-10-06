import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./session";
import { waitForLoadingGone } from "./ready";

const savedLayout = [
  { i: "setup-test", type: "onboarding_checklist", x: 0, y: 0, w: 12, h: 4 },
  { i: "match-test", type: "next_match", x: 0, y: 4, w: 12, h: 5 },
  { i: "coverage-test", type: "scouting_coverage", x: 0, y: 9, w: 6, h: 4 },
  { i: "todos-test", type: "team_todos", x: 6, y: 9, w: 6, h: 4 },
];

async function missingEvent(page: Page, options: { withTodo?: boolean; resultsMissing?: boolean } = {}) {
  let writes = 0;
  page.on("request", request => { if (request.url().includes("/api/dashboards") && request.method() !== "GET") writes++; });
  await page.route("**/api/dashboards?**", async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.active) body.active.layout = structuredClone(savedLayout);
    if (body.context) body.context = { ...body.context, setupRequired: true, eventKey: null, eventName: null,
      tbaConfigured: !options.resultsMissing, homeStrip: { items: [] }, dataSourceHealth: null };
    if (body.widgets) {
      for (const type of Object.keys(body.widgets)) body.widgets[type] = { type, status: "empty", data: {} };
      body.widgets.onboarding_checklist = { type: "onboarding_checklist", status: "setup_required" };
      body.widgets.next_match = { type: "next_match", status: "setup_required", message: "No event picked yet." };
      body.widgets.scouting_coverage = { type: "scouting_coverage", status: "setup_required" };
      if (options.withTodo) body.widgets.team_todos = { type: "team_todos", status: "live", data: {
        open: 1, mineOpen: 0, overdue: 0, items: [{ id: "test-todo", title: "Check the robot battery", status: "todo", dueOn: null, assigneeName: null }],
      } };
    }
    await route.fulfill({ response, json: body });
  });
  return () => writes;
}

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

for (const width of [1440, 390]) {
  test(`missing event retains chosen cards and real work with one event action at ${width}px`, async ({ page, context }, testInfo) => {
    expect(await signInAs(context, "owner")).toBe(true);
    const writes = await missingEvent(page, { withTodo: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await waitForLoadingGone(page);
    const prompt = page.getByTestId("dash-context-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole("link", { name: "Choose event", exact: true })).toHaveCount(1);
    await expect(page.locator('[data-widget-type="next_match"]')).toHaveCount(1);
    await expect(page.locator('[data-widget-type="next_match"]')).not.toContainText("Qual");
    await expect(page.locator('[data-widget-type="onboarding_checklist"]')).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Check the robot battery" })).toBeVisible();
    await expect(page.getByTestId("dash-now")).toContainText("One open team task");
    await expect(page.getByText("No widgets on this board")).toHaveCount(0);
    expect((await prompt.boundingBox())!.height).toBeLessThan(width === 390 ? 190 : 120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await testInfo.attach(`compact-event-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByTestId("dash-customize").click();
    await expect(page.getByTestId("dash-grid-item")).toHaveCount(4);
    await expect(page.getByTestId("dash-hidden-row")).toHaveCount(0);
    expect(writes()).toBe(0);
  });
}

test("a board waiting for competition setup is not described as an empty board", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const writes = await missingEvent(page);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dash-context-prompt")).toBeVisible();
  await expect(page.getByTestId("dash-place-canvas")).toHaveCount(0);
  await expect(page.getByText("No widgets on this board")).toHaveCount(0);
  expect(writes()).toBe(0);
  await page.getByTestId("dash-context-prompt").getByRole("link", { name: "Choose event" }).click();
  await expect(page).toHaveURL(/pickEvent=1/);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("scouts get practice scouting instead of team-admin setup", async ({ page, context }) => {
  expect(await signInAs(context, "member")).toBe(true);
  await missingEvent(page);
  await page.goto("/dashboard");
  const prompt = page.getByTestId("dash-context-prompt");
  await expect(prompt).toContainText("Your team lead chooses the event");
  await expect(prompt.getByRole("link", { name: "Choose event" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Quick actions", exact: true }).getByRole("link", { name: /^Practice scouting/ }).click();
  await expect(page).toHaveURL(/mode=free/);
  await expect(page.getByRole("heading", { name: "Practice scouting", exact: true })).toBeVisible();
  await page.getByLabel("Team number", { exact: true }).fill("6925");
  await page.getByRole("radio", { name: "Pit", exact: true }).check();
  await page.getByRole("button", { name: "Start scouting", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toBeVisible();
});

test("the real match board returns when the missing-event response is resolved", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const writes = await missingEvent(page);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dash-context-prompt")).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.getByTestId("dash-context-prompt")).toHaveCount(0);
  await expect(page.locator('.dash-grid-item[data-widget-type="next_match"]')).toBeVisible();
  expect(writes()).toBe(0);
});

test("missing match results share one prompt while unrelated work remains", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await missingEvent(page, { withTodo: true, resultsMissing: true });
  await page.goto("/dashboard");
  const prompt = page.getByTestId("dash-context-prompt");
  await expect(prompt.getByRole("link", { name: "Connect match results" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Check the robot battery" })).toBeVisible();
  await expect(page.locator('[data-widget-type="next_match"]')).toHaveCount(1);
    await expect(page.locator('[data-widget-type="next_match"]')).not.toContainText("Qual");
});
