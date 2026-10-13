import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, userId } from "./fixture";

const grits = { eventKey: "catalog:grits-2026", catalogId: "grits-2026", name: "GRITS 2026", year: 2026, startDate: "2026-10-15", endDate: "2026-10-17", city: "Gainesville", stateProv: "Georgia", custom: true, eventType: 99, timeZone: "America/New_York", sourceUrl: "https://gafirst.org/events/grits-2026" };

for (const width of [390, 768, 1440]) {
  test(`calendar shares competition planning at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 850 });
    await isolateUi(page, context);
    await page.route("**/api/team/calendar?**", route => route.fulfill({ json: { status: "ready", context: { orgId, userId, teamNumber: 6925, orgName: "Test Robotics", role: "owner", canManage: true }, subteams: [], members: [], events: [], duties: [], travelLegs: [], mySubteamIds: [], attendanceEvents: [], practiceSessions: [], calendarFeed: { token: null, scope: "personal", subteamId: null } } }));
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/context/event?**", route => route.fulfill({ json: { canSetEvent: true, activeEventKey: "2026previous", events: posted ? [{ ...grits, eventKey: "2026custom-6925a000-grits-2026", catalogId: undefined, calendarId: "calendar-one", autoActivate: true }] : [grits] } }));
    await page.route("**/api/context/event", route => { posted = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, eventKey: "2026custom-6925a000-grits-2026", eventName: "GRITS 2026", scheduled: true, calendarId: "calendar-one" } }); });
    await page.goto(`/team?tab=calendar&orgId=${orgId}`);
    await page.getByRole("button", { name: "Add event", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add to calendar" });
    await dialog.getByRole("button", { name: "Competition", exact: true }).click();
    await dialog.getByRole("searchbox", { name: "Search competitions" }).fill("grits");
    await dialog.getByRole("button", { name: /GRITS 2026/ }).click();
    await expect(dialog.getByLabel("First day", { exact: true })).toHaveValue("2026-10-15");
    await expect(dialog.getByLabel("Last day", { exact: true })).toHaveValue("2026-10-17");
    expect(posted).toBeNull();
    await accessible(page);
    await page.screenshot({ path: info.outputPath(`competition-${width}.png`) });
    await dialog.getByRole("button", { name: "Add to team calendar", exact: true }).click();
    await expect.poll(() => posted).toMatchObject({ orgId, catalogId: "grits-2026", intent: "schedule", schedule: { startsAt: "2026-10-15T04:00:00.000Z", endsAt: "2026-10-18T04:00:00.000Z", timeZone: "America/New_York", autoActivate: true } });
    await expect(dialog.getByText("On calendar", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /GRITS 2026/ })).toHaveCount(1);
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
    await expect(sidebar.getByRole("link", { name: /Switch team/ })).toHaveCount(0);
    if (width < 1024) {
      await page.getByRole("button", { name: "Browse all pages", exact: true }).click();
      await expect(page.getByRole("link", { name: /Switch team/ })).toHaveCount(0);
    }
    await accessible(page);
  });
}

test("save an undated scrimmage without activating it or adding a calendar row", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 691 });
  await isolateUi(page, context);
  await page.route("**/api/command?**", route => route.fulfill({ json: { status: "setup_required", orgId, canSetEvent: true, eventKey: null, matches: [], scoutQueue: [], coverage: { upcomingUnscouted: 0 }, prediction: { status: "empty" }, setupSteps: [], links: {} } }));
  await page.route("**/api/context/event?**", route => route.fulfill({ json: { canSetEvent: true, activeEventKey: null, events: [] } }));
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/context/event", route => { posted = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, eventKey: "2027custom-6925a000-shop-scrimmage", eventName: "Shop scrimmage", scheduled: false } }); });
  await page.goto(`/competition?tab=command&pickEvent=1&orgId=${orgId}`);
  const dialog = page.getByRole("dialog", { name: "Competition events" });
  await dialog.getByRole("spinbutton", { name: "Competition season" }).fill("2027");
  await dialog.getByRole("button", { name: "Add an unlisted event", exact: true }).click();
  await dialog.getByLabel("Event name", { exact: true }).fill("Shop scrimmage");
  await dialog.getByText("Time zone", { exact: true }).click();
  await dialog.getByLabel("City", { exact: true }).fill("Atlanta");
  await dialog.getByRole("checkbox", { name: "Add to the whole team’s calendar" }).uncheck();
  const save = dialog.getByRole("button", { name: "Save event", exact: true });
  await expect(save).toBeVisible();
  const [action, bounds] = await Promise.all([save.boundingBox(), dialog.boundingBox()]);
  expect(action && bounds && action.y >= bounds.y && action.y + action.height <= bounds.y + bounds.height).toBe(true);
  await accessible(page);
  await page.screenshot({ path: info.outputPath("unlisted-short.png") });
  await dialog.getByRole("button", { name: "Save event", exact: true }).click();
  await expect.poll(() => posted).toMatchObject({ intent: "save", create: { name: "Shop scrimmage", year: 2027, startDate: null, endDate: null } });
  expect(posted).not.toHaveProperty("schedule");
  await expect(dialog.getByText("Shop scrimmage is saved for preparation.")).toBeVisible();
});
