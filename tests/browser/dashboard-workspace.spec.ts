import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

import { workspace } from "./fixtures/workspace-ui";

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

for (const width of [1440, 390, 320]) {
  test(`daily brief, actions, and editable board fit at ${width}px`, async ({ page, context }, testInfo) => {
    await signInFixture(context);
    await workspace(page);
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/dashboard?orgId=ui-team");
    await expect(page.getByTestId("dash-now")).toContainText("One task assigned to you");
    await expect(page.getByTestId("dash-workspace-actions")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar", exact: false }).filter({ has: page.locator("i") })).toHaveAttribute("href", "/team?tab=calendar&orgId=ui-team");
    await expect(page.getByTestId("home-tasks")).toContainText("Check the robot battery");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const screenshot = testInfo.outputPath(`dashboard-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`dashboard-${width}.png`, { path: screenshot, contentType: "image/png" });
    if (width === 1440) {
      const board = await page.getByTestId("dash-widget-grid").boundingBox();
      const actions = await page.locator(".dash-workspace").boundingBox();
      expect(board!.width).toBeCloseTo(actions!.width, 0);
    }
    if (width === 390) {
      await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      await expect(page.locator(".dash-workspace-action").first()).toHaveCSS("background-color", "rgb(32, 35, 43)");
      await expect(page.locator(".dash-widget h2").first()).toHaveCSS("color", "rgb(240, 241, 246)");
      await testInfo.attach("dashboard-dark.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
    await page.getByTestId("dash-customize").click();
    await expect(page.getByTestId("dash-workspace-actions")).not.toBeVisible();
    await expect(page.getByTestId("dash-place-canvas")).toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("dash-drag-handle").first()).toBeVisible();
  });
}

test("quick task creation posts to the existing API and refreshes the board", async ({ page, context }) => {
  await signInFixture(context);
  const writes = await workspace(page);
  await page.goto("/dashboard?orgId=ui-team");
  await page.getByTestId("dash-workspace-actions").getByRole("button", { name: "Add a task" }).click();
  const dialog = page.getByRole("dialog", { name: "Create team task" });
  await dialog.getByRole("textbox", { name: "Task title" }).fill("Prepare spare battery");
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).toContainText("Team task created.");
  await expect(page.getByTestId("home-tasks")).toContainText("Prepare spare battery");
  expect(writes).toEqual([{ orgId: "ui-team", action: "create-todo", title: "Prepare spare battery", notes: "", dueOn: null }]);
});

test("viewers get a task destination instead of a creation button", async ({ page, context }) => {
  await signInFixture(context);
  await workspace(page, "viewer");
  await page.goto("/dashboard?orgId=ui-team");
  const actions = page.getByTestId("dash-workspace-actions");
  await expect(actions.getByRole("link", { name: "Team tasks" })).toHaveAttribute("href", "/todos?orgId=ui-team");
  await expect(actions.getByRole("button", { name: "Add a task" })).toHaveCount(0);
  await expect(actions.getByRole("link", { name: "Explore teams" })).toHaveAttribute("href", "/competition?tab=teams&orgId=ui-team");
});

test("scouting without an event opens practice mode", async ({ page, context }) => {
  await signInFixture(context);
  await workspace(page, "scout");
  await page.goto("/dashboard?orgId=ui-team");
  await expect(page.getByTestId("dash-workspace-actions").getByRole("link", { name: "Practice scouting" }))
    .toHaveAttribute("href", "/competition?tab=scouting&orgId=ui-team&mode=free");
});

test("an upcoming match keeps its scoreboard without a duplicate daily brief", async ({ page, context }) => {
  await signInFixture(context);
  await workspace(page, "owner", true);
  await page.goto("/dashboard?orgId=ui-team");
  await expect(page.locator(".dash-next-match.nm")).toContainText("Qual 12");
  await expect(page.getByTestId("dash-now")).toHaveCount(0);
  await expect(page.getByTestId("dash-workspace-actions").getByRole("link", { name: "Start scouting" }))
    .toHaveAttribute("href", "/competition?tab=scouting&orgId=ui-team");
});
