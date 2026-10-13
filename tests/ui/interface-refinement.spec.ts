import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, userId } from "./fixture";

for (const width of [390, 768, 1440]) {
  test(`compact search and grouped settings at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await isolateUi(page, context);
    await page.goto(`/settings?orgId=${orgId}`);
    await expect(page.getByRole("heading", { name: "Preferences", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team · AI", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Team profile/ })).toHaveCount(0);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search Vantage" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option")).toHaveCount(4);
    await expect(dialog.getByRole("combobox")).toBeFocused();
    await accessible(page);
    await page.screenshot({ path: info.outputPath(`search-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test(`chat stays in place and keeps the next draft at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await isolateUi(page, context);
    let sent = false;
    await page.route("**/api/agent?**", route => route.fulfill({ json: { threads: [], messages: [], memories: [], role: "owner", skills: [] } }));
    await page.route("**/api/agent/autonomous?**", route => route.fulfill({ json: { runs: [] } }));
    await page.route("**/api/agent", async route => {
      const body = route.request().postDataJSON();
      if (body.action === "thread") { await route.fulfill({ status: 201, json: { threadId: "test-thread" } }); return; }
      sent = true;
      await new Promise(resolve => setTimeout(resolve, 600));
      await route.fulfill({ status: 201, json: { messages: [
        { id: "test-user", role: "user", content: body.message, explicitlyShared: false },
        { id: "test-assistant", role: "assistant", content: "Test reply", explicitlyShared: false },
      ] } });
    });
    await page.goto(`/ai?orgId=${orgId}`);
    const field = page.getByRole("textbox", { name: "Message", exact: true });
    await field.fill("First question");
    const before = page.url();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => sent).toBe(true);
    await field.fill("Next question while waiting");
    await expect(page.getByText("Test reply", { exact: true })).toBeVisible();
    await expect(field).toHaveValue("Next question while waiting");
    expect(page.url()).toBe(before);
    await accessible(page);
    await page.screenshot({ path: info.outputPath(`chat-${width}.png`) });
  });

  test(`calendar details extend one draft at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await isolateUi(page, context);
    await page.route("**/api/team/calendar?**", route => route.fulfill({ json: {
      status: "ready", context: { orgId, userId, teamNumber: 6925, orgName: "Test Robotics", role: "owner", canManage: true },
      subteams: [], members: [], events: [], duties: [], travelLegs: [], mySubteamIds: [], attendanceEvents: [], practiceSessions: [],
      calendarFeed: { token: null, scope: "personal", subteamId: null },
    } }));
    await page.goto(`/team?tab=calendar&orgId=${orgId}`);
    await page.getByRole("button", { name: "Add event", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add to calendar" });
    await dialog.getByRole("textbox", { name: "Event title", exact: true }).fill("Drive practice");
    await dialog.getByText("Event details", { exact: true }).click();
    await expect(dialog.locator("form")).toHaveCount(1);
    await expect(dialog.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Drive practice");
    const action = await dialog.getByRole("button", { name: "Add event", exact: true }).boundingBox();
    const bounds = await dialog.boundingBox();
    expect(action && bounds && action.y + action.height <= bounds.y + bounds.height).toBe(true);
    await accessible(page);
    await page.screenshot({ path: info.outputPath(`calendar-${width}.png`) });
  });
}

test("personal-key sharing preserves its audience and removes former recipients", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await isolateUi(page, context);
  const teammate = "6925a000-0000-4000-8000-000000000010";
  const former = "6925a000-0000-4000-8000-000000000011";
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/organizations/ai-keys**", async route => {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } }); return;
    }
    await route.fulfill({ json: { tier: "free", canManage: false, keys: [], providers: [],
      memberKeys: [{ id: "6925a000-0000-4000-8000-000000000020", provider: "google", label: "My key", baseUrl: null, model: null, createdAt: null, lastUsedAt: null, shareScope: "selected", shareUserIds: [teammate, former] }],
      sharingReady: true, sharingMembers: [{ userId: teammate, name: "Grace" }],
    } });
  });
  await page.goto(`/team/ai-keys?orgId=${orgId}`);
  const share = page.getByRole("checkbox", { name: "Let teammates use my AI credits" });
  await share.uncheck(); await share.check();
  await expect(page.getByRole("radio", { name: "Selected people", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: /Former teammate/ }).click();
  await expect(page.getByRole("checkbox", { name: /Former teammate/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Save sharing", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ shareScope: "selected", shareUserIds: [teammate], scope: "member" });
  await accessible(page);
  await page.screenshot({ path: info.outputPath("key-sharing.png") });
});

test("closing a previous background result cannot leave a new request busy", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await isolateUi(page, context);
  const run = { id: "old-run", goal: "Previous background goal", status: "completed", provider: "google", model: "test", stepCount: 0, finalAnswer: "Previous result", startedAt: "2026-10-13T12:00:00Z", finishedAt: "2026-10-13T12:01:00Z" };
  let started = false;
  await page.route("**/api/agent?**", route => route.fulfill({ json: { threads: [], messages: [], memories: [], role: "owner", skills: [] } }));
  await page.route("**/api/agent/autonomous**", async route => {
    if (route.request().method() === "POST") {
      started = true; await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ json: { run: { ...run, id: "new-run", goal: "New background goal" }, persistedSteps: [] } }); return;
    }
    await route.fulfill({ json: new URL(route.request().url()).searchParams.has("runId") ? { run, steps: [] } : { runs: [run] } });
  });
  await page.goto(`/ai?orgId=${orgId}`);
  await page.getByRole("button", { name: /Previous background goal/ }).click();
  await page.getByText("Options", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Work on this in the background" }).check();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("New background goal");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Close background work" }).click();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Next goal");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
});

test("admin navigation and Platform settings stay usable on a short laptop screen", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 1440, height: 691 });
  await isolateUi(page, context);
  await page.route("**/api/me**", route => route.fulfill({ json: { authenticated: true, userId, orgId, name: "Ada", role: "owner", teamNumber: 6925, platformAdmin: true, memberships: [{ orgId, orgName: "Test Robotics", role: "owner", teamNumber: 6925 }], hubAccess: null, sponsorsAllowed: true } }));
  await page.route("**/api/navigation/preferences**", route => route.fulfill({ json: { tabs: ["/dashboard", "/competition?tab=scouting", "/competition?tab=teams", "/competition?tab=strategy", "/competition?tab=my-day", "/team?tab=todos", "/learn/team"] } }));
  await page.goto(`/settings?orgId=${orgId}`);
  const platform = page.locator("section[aria-labelledby='settings-group-platform']");
  await expect(platform.getByRole("heading", { name: "Platform", exact: true })).toBeVisible();
  const heading = await platform.getByRole("heading").boundingBox();
  const firstRow = await platform.getByRole("link").first().boundingBox();
  expect(heading && firstRow && heading.y + heading.height <= firstRow.y).toBe(true);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const utilities = sidebar.getByRole("navigation", { name: "Workspace utilities" });
  await expect(utilities.getByRole("link")).toHaveCount(4);
  const boxes = await utilities.getByRole("link").evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { y: rect.y, height: rect.height, width: rect.width }; }));
  expect(new Set(boxes.map(box => Math.round(box.y))).size).toBe(1);
  expect(boxes.every(box => box.width >= 44 && box.height >= 44)).toBe(true);
  const nav = sidebar.locator(".app-sidebar-navigation");
  const resources = sidebar.getByRole("link", { name: "Team resources", exact: true });
  await resources.focus();
  const pin = await resources.boundingBox(), scrollBounds = await nav.boundingBox(), footer = await utilities.boundingBox();
  expect(pin && scrollBounds && footer && pin.y >= scrollBounds.y && pin.y + pin.height <= scrollBounds.y + scrollBounds.height && scrollBounds.y + scrollBounds.height <= footer.y).toBe(true);
  const business = sidebar.getByRole("button", { name: "Business", exact: true });
  await business.scrollIntoViewIfNeeded(); await business.click();
  await expect(sidebar.locator(".app-sidebar-workspace").filter({ has: business })).toHaveAttribute("open", "");
  await accessible(page);
  await page.screenshot({ path: info.outputPath("admin-short-laptop.png"), fullPage: true });
});
