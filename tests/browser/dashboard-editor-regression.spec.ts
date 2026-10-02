import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./session";

const orgId = "6925a000-0000-4000-8000-000000000001";
test.use({ actionTimeout: 15_000 });
for (const width of [1440, 390]) test(`explicit cards resize, undo, save, reload and reset in Settings at ${width}px`, async ({ page, context }, info) => {
  test.setTimeout(120_000);
  expect(await signInAs(context, "owner")).toBe(true);
  const initial = await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json();
  const create = await context.request.post("/api/dashboards", { data: { orgId, action: "create", name: `Editor regression ${Date.now()}`, layout: [], activate: true } });
  expect(create.ok()).toBe(true); const board = await create.json();
  let rejectSave = false, rejectHome = false;
  try {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/dashboards*", async route => {
      if (route.request().method() === "POST") {
        if (rejectSave) return route.fulfill({ status: 503, json: { error: "Could not save right now." } });
        return route.continue();
      }
      if (rejectHome && new URL(route.request().url()).searchParams.get("mode") === "home") return route.fulfill({ status: 503, json: { error: "Refresh unavailable." } });
      const response = await route.fetch(); const body = await response.json();
      if (body.context) body.context = { ...body.context, setupRequired: true, eventKey: null, eventName: null, dataSourceHealth: null };
      if (body.widgets?.prediction_summary) body.widgets.prediction_summary = { type: "prediction_summary", status: "setup_required", message: "Choose an event to see predictions." };
      await route.fulfill({ response, json: body });
    });
    await page.goto(`/dashboard?orgId=${orgId}`);
    await page.getByTestId("dash-customize").click();
    await page.getByTestId("dash-open-library").click();
    await page.getByTestId("dash-widget-search").fill("Prediction");
    await page.getByTestId("dash-library-prediction_summary").click();
    if (width >= 720) await page.getByTestId("dash-widget-sheet").getByRole("button", { name: "Close", exact: true }).click();
    const card = page.locator('[data-widget-type="prediction_summary"]');
    await expect(card).toBeVisible();
    await card.getByTestId("dash-size-toggle").click();
    await expect(card.getByRole("button", { name: "Prediction size M", exact: true })).toBeVisible();
    expect((await card.getByTestId("dash-size-toggle").boundingBox())!.width).toBeGreaterThanOrEqual(128);
    expect((await card.getByRole("group", { name: "Resize Prediction" }).boundingBox())!.width).toBeGreaterThanOrEqual(200);
    const optionsBox = (await card.getByRole("group", { name: "Resize Prediction" }).boundingBox())!;
    const openerBox = (await card.getByTestId("dash-size-toggle").boundingBox())!;
    expect(optionsBox.y).toBeGreaterThanOrEqual(openerBox.y + openerBox.height);
    expect(Math.abs(optionsBox.x + optionsBox.width - openerBox.x - openerBox.width)).toBeLessThan(2);
    expect(await card.getByTestId("dash-size-toggle").evaluate(button => button.scrollWidth <= button.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('[data-widget-type="prediction_summary"]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`card-options-${width}.png`), fullPage: false });
    await card.getByRole("button", { name: "Prediction size M", exact: true }).press("Escape");
    await expect(card.getByTestId("dash-size-toggle")).toBeFocused();
    await expect(card.getByRole("group", { name: "Resize Prediction" })).toHaveCount(0);
    for (const size of ["S", "M", "L", "XL"]) {
      await card.getByTestId("dash-size-toggle").click();
      await card.getByRole("button", { name: `Prediction size ${size}`, exact: true }).click();
      await expect(card.getByTestId("dash-size-toggle")).toBeFocused();
      await card.getByTestId("dash-size-toggle").click();
      await expect(card.getByRole("button", { name: `Prediction size ${size}`, exact: true })).toHaveAttribute("aria-pressed", "true");
      await card.getByTestId("dash-size-toggle").click();
    }
    await card.getByTestId("dash-size-toggle").click();
    await card.getByRole("button", { name: "Reset Prediction to its default size", exact: true }).click();
    await card.getByTestId("dash-size-toggle").click();
    await expect(card.getByRole("button", { name: "Prediction size M", exact: true })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Prediction size L", exact: true }).click();
    await page.getByTestId("dash-undo").click();
    await card.getByTestId("dash-size-toggle").click();
    await expect(card.getByRole("button", { name: "Prediction size M", exact: true })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Prediction size L", exact: true }).click();
    rejectSave = true;
    await page.getByTestId("dash-edit-done").click();
    await expect(page.getByText("Could not save right now.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
    await expect(card).toBeVisible();
    rejectSave = false; rejectHome = true;
    const saved = page.waitForResponse(response => response.url().endsWith("/api/dashboards") && response.request().method() === "POST");
    await page.getByTestId("dash-edit-done").click(); expect((await saved).ok()).toBe(true);
    await expect(page.getByText("Home saved.", { exact: true })).toBeVisible();
    await expect(card).toBeVisible();
    expect((await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json()).active.layout[0]).toMatchObject({ type: "prediction_summary", w: 6, config: { alwaysShow: true, fixedSize: true } });
    // The saved device copy must also contain the newest layout when a cold refresh fails.
    await page.reload(); await expect(card).toBeVisible();
    rejectHome = false;
    await page.reload(); await expect(card).toBeVisible();
    if (width === 1440) expect((await card.boundingBox())!.width).toBeLessThan(650);
    await page.screenshot({ path: info.outputPath(`saved-card-${width}.png`), fullPage: false });
    await page.getByTestId("dash-customize").click();
    await card.getByTestId("dash-size-toggle").click();
    await card.getByRole("button", { name: "Remove Prediction", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.getByTestId("dash-undo").click(); await expect(card).toBeVisible();
    await page.getByTestId("dash-edit-cancel").click();
    await page.goto(`/account?tab=appearance&orgId=${orgId}`);
    await page.getByRole("button", { name: "Reset Home to default", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reset Home to default?", exact: true });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json()).active.layout).toHaveLength(1);
    await page.getByRole("button", { name: "Reset Home to default", exact: true }).click();
    rejectSave = true;
    await dialog.getByRole("button", { name: "Reset Home", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Could not save right now.");
    expect((await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json()).active.layout).toHaveLength(1);
    rejectSave = false;
    await dialog.getByRole("button", { name: "Reset Home", exact: true }).click();
    await expect(page.getByText("Home reset.")).toBeVisible();
    const reset = await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json();
    expect(reset.active.id).toBe(board.id);
    expect(reset.active.layout.some((item: { type: string }) => item.type === "team_todos")).toBe(true);
    expect(reset.active.layout).not.toHaveLength(1);
    rejectHome = true;
    await page.getByRole("link", { name: "Open Home", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?orgId=${orgId}`));
    await page.reload(); await expect(page.getByTestId("home-tasks")).toBeVisible();
    await expect(card).toHaveCount(0);
    rejectHome = false;
    await page.reload(); await expect(page.getByTestId("home-tasks")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`reset-home-${width}.png`), fullPage: false });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await context.request.delete("/api/dashboards", { data: { orgId, id: board.id } });
    if (initial.active.id) await context.request.post("/api/dashboards", { data: { orgId, id: initial.active.id, action: "activate" } });
  }
});

test("reset cannot claim success for a missing or another member's board", async ({ context, browser }, info) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const initial = await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json();
  const create = await context.request.post("/api/dashboards", { data: { orgId, action: "create", name: `Reset guard ${Date.now()}`, layout: [], activate: true } });
  expect(create.ok()).toBe(true); const board = await create.json();
  const member = await browser.newContext({ baseURL: String(info.project.use.baseURL) });
  try {
    expect(await signInAs(member, "scout")).toBe(true);
    const denied = await member.request.post("/api/dashboards", { data: { orgId, action: "reset", id: board.id, activate: true } });
    expect(denied.ok()).toBe(false);
    const missing = await context.request.post("/api/dashboards", { data: { orgId, action: "reset", id: "00000000-0000-4000-8000-000000000099", activate: true } });
    expect(missing.ok()).toBe(false);
    expect((await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json()).active.layout).toEqual([]);
  } finally {
    await member.close();
    await context.request.delete("/api/dashboards", { data: { orgId, id: board.id } });
    if (initial.active.id) await context.request.post("/api/dashboards", { data: { orgId, id: initial.active.id, action: "activate" } });
  }
});
