import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, responses, schema } from "./fixture";

for (const width of [390, 1440]) test(`cached form refresh cannot overwrite a selected draft at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 900 });
  await isolateUi(page, context);
  let revision = 1;
  let unavailable = false;
  let release: (() => void) | undefined;
  let delay: Promise<void> | undefined;
  let refreshing = false;
  await page.route("**/api/scouting/schemas?**", async route => {
    refreshing = true;
    if (delay) await delay;
    await route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { error: "Forms unavailable." } : {
      eventKey: "2026test", year: 2026, canManageSchemas: true,
      schemas: ["pit", "match"].map(type => ({ ...schema, id: type === "pit" ? schema.id : "6925a000-0000-4000-8000-000000000004", type, version: revision,
        definition: { title: `${type} version ${revision}`, fields: [{ key: "notes", label: `${type} observation`, type: "text" }] },
      })),
    } });
  });
  const builder = page.locator(".sfb-page");
  const title = builder.getByLabel("Form title", { exact: true });
  const type = builder.getByRole("combobox", { name: "Form type", exact: true });
  await page.goto(`/competition?tab=forms&orgId=${orgId}`);
  await expect(title).toHaveValue("pit version 1");
  await expect(type).toBeEnabled(); // Initial cache write has completed.
  revision = 2;
  refreshing = false;
  delay = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.reload();
    await expect.poll(() => refreshing).toBe(true);
    await expect(title).toHaveValue("pit version 1");
    await expect(title).toBeDisabled();
    await expect(type).toBeDisabled();
    await expect(builder).toContainText("Checking the latest forms");
  } finally { release?.(); }
  delay = undefined;
  await expect(title).toHaveValue("pit version 2");
  await expect(type).toBeEnabled();
  await type.selectOption("match");
  await expect(title).toHaveValue("match version 2");
  await title.fill("Edited match form");
  await type.selectOption("pit");
  await expect(title).toHaveValue("pit version 2");
  await type.selectOption("match");
  await expect(title).toHaveValue("Edited match form");
  unavailable = true;
  await page.reload();
  await expect(title).toHaveValue("pit version 2");
  await expect(type).toBeEnabled();
  await expect(builder).toContainText("Showing the last copy on this device");
  await type.selectOption("match");
  await expect(title).toHaveValue("match version 2");
});

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`responses preserve zero, filter real rows, retry and revoke access at ${width}px ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await isolateUi(page, context, theme);
    let status = 200;
    await page.route("**/api/scouting/form-responses?**", route => route.fulfill({ status, json: status === 200 ? responses : { error: status === 403 ? "Team access revoked." : "Responses unavailable." } }));
    await page.goto(`/competition?tab=forms&orgId=${orgId}`);
    await page.getByRole("navigation", { name: "Form workspace" }).getByRole("button", { name: "Responses", exact: true }).click();
    const panel = page.getByRole("region", { name: "Form responses" });
    // A section with an accessible label is a region in the accessibility tree.
    await expect(panel).toContainText("2 responses");
    await expect(panel).toContainText("1 answered · Average 0.0");
    await panel.getByLabel("Team number", { exact: true }).fill("254");
    await expect(panel).toContainText("1 response");
    await expect(panel).not.toContainText("Average 0.0");
    await panel.getByLabel("Team number", { exact: true }).fill("");
    await panel.getByRole("navigation", { name: "Response view" }).getByRole("button", { name: "Table", exact: true }).click();
    await expect(panel.getByRole("table")).toContainText("Zero observed");
    await accessible(page, ".sfb-page");
    await page.screenshot({ path: info.outputPath(`responses-${width}-${theme}.png`) });
    // Trigger the same resume refresh used after returning to a browser tab.
    status = 503;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(panel).toContainText("Showing responses last loaded");
    await expect(panel.getByRole("table")).toContainText("Zero observed");
    status = 200;
    await page.getByRole("button", { name: "Retry responses", exact: true }).click();
    await expect(page.getByText("Responses unavailable.", { exact: false })).toHaveCount(0);
    status = 403;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".sfb-response-loading").getByRole("alert")).toContainText("Team access revoked.");
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText("Zero observed", { exact: true })).toHaveCount(0);
    status = 200;
    await page.getByRole("button", { name: "Retry responses", exact: true }).click();
    await expect(panel.getByRole("table")).toContainText("Zero observed");
    status = 401;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("link", { name: "Sign in again", exact: true })).toHaveAttribute("href", /signin\?next=/);
    await expect(page.getByRole("table")).toHaveCount(0);
  });
}

test("failed preference loads cannot overwrite saved choices", async ({ page, context }) => {
  await isolateUi(page, context);
  let failing = true;
  const writes: string[] = [];
  for (const path of ["cockpit", "navigation"]) {
    const url = path === "cockpit" ? "**/api/account/cockpit" : "**/api/navigation/preferences";
    await page.route(url, route => {
      if (route.request().method() !== "GET") writes.push(path);
      return route.fulfill({ status: failing ? 503 : 200, json: failing ? { error: "Unavailable" } : path === "cockpit" ? { cockpit: { confirmWrites: false } } : { tabs: ["/dashboard", "/competition", "/competition?tab=scouting", "/team"] } });
    });
  }
  await page.goto(`/account?tab=appearance&orgId=${orgId}`);
  await page.getByText("More display settings", { exact: true }).click();
  await expect(page.getByText("Your code preferences could not load.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Confirm before Bugbot opens a pull request", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset shortcuts", exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
  failing = false;
  await page.getByRole("button", { name: "Retry code preferences", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Confirm before Bugbot opens a pull request", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "Confirm before Bugbot opens a pull request", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Retry shortcuts", exact: true }).click();
  await expect(page.getByText("Your shortcuts could not load.")).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const width of [390, 1440]) test(`saved corrections refresh past the device cache at ${width}px`, async ({ page, context }) => {
  const { schemaId, userId } = await import("./fixture");
  await page.setViewportSize({ width, height: 900 });
  await isolateUi(page, context);
  let score = 1;
  let refreshStarted = false;
  const gate: { release?: () => void; wait?: Promise<void> } = {};
  await page.route("**/api/scouting/bootstrap?**", async route => {
    refreshStarted = true;
    if (gate.wait) await gate.wait;
    await route.fulfill({ json: {
      eventKey: "2026test", eventName: "Test Event", canManageSchemas: true,
      schemas: [{ id: schemaId, orgId, year: 2026, type: "match", version: 1, definition: { title: "Match", fields: [{ key: "autoPoints", label: "Auto points", type: "number" }] } }],
      assignments: [], matches: [{ matchKey: "2026test_qm1", matchNumber: 1, compLevel: "qm", redAlliance: { teamKeys: ["frc254"] }, blueAlliance: { teamKeys: [] } }],
      recentEntries: [], scoutIdentity: { userId, displayName: "Ada" },
      myEntries: [{ id: "row", type: "match", matchKey: "2026test_qm1", teamKey: "frc254", clientId: schemaId, payload: { autoPoints: score }, confidence: "low", updatedAt: "2026-10-06T12:00:00Z" }],
    } });
  });
  const href = `/competition?tab=scouting&orgId=${orgId}&matchKey=2026test_qm1&teamKey=frc254`;
  await page.goto(href);
  const auto = page.getByRole("spinbutton", { name: "Auto points", exact: true });
  await expect(auto).toHaveValue("1");
  // The first visit writes the normal browser cache. The next visit gets that
  // old cache immediately while its server copy contains the correction.
  await page.goto(`/notifications?orgId=${orgId}`);
  score = 9; refreshStarted = false; gate.wait = new Promise<void>(resolve => { gate.release = resolve; });
  await page.goto(href);
  await expect.poll(() => refreshStarted).toBe(true);
  await expect(auto).toBeVisible();
  gate.release!();
  await expect(auto).toHaveValue("9");
  await expect(page.locator(".scout-answers")).toContainText("You already scouted");
});

for (const width of [390, 1440]) test(`search opens connection setup directly and keeps the team at ${width}px`, async ({ page, context }) => {
  const { navigationOpener } = await import("../browser/nav");
  await page.setViewportSize({ width, height: 900 });
  await isolateUi(page, context);
  await page.goto(`/ai?tab=writer&orgId=${orgId}`);
  await navigationOpener(page).click();
  await page.getByRole("combobox", { name: "Search pages, tools, and your team's data", exact: true }).fill("Connect AI");
  await page.getByRole("option", { name: "Connect AI AI › Controls", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/ai/connect\\?orgId=${orgId}`));
  await expect(page.getByRole("heading", { name: "Connect AI", exact: true })).toBeVisible();
  await expect(page.locator(".ai-connect-method")).toHaveCount(2);
  for (const link of await page.locator(".ai-connect-method").all()) expect(new URL((await link.getAttribute("href"))!, page.url()).searchParams.get("orgId")).toBe(orgId);
});

test("response metrics follow the selected scout and adapt when lead access changes", async ({ page, context }) => {
  await isolateUi(page, context);
  let lead = true;
  await page.route("**/api/scouting/form-responses?**", route => route.fulfill({ json: lead ? {
    ...responses,
    rows: responses.rows.map((row, index) => ({ ...row, scoutId: String(index), scout: index ? "Ben" : "Ada" })),
    scouts: ["Ada", "Ben"].map((name, index) => ({ id: String(index), name, total: 1, teams: 1, lastAt: "2026-10-06T12:00:00Z" })),
    idle: [],
  } : responses }));
  await page.goto(`/competition?tab=forms&orgId=${orgId}`);
  await page.getByRole("navigation", { name: "Form workspace" }).getByRole("button", { name: "Responses", exact: true }).click();
  const panel = page.getByRole("region", { name: "Form responses" });
  await panel.getByLabel("Scout", { exact: true }).selectOption("0");
  await expect(panel.getByRole("heading", { name: "1 response", exact: true })).toBeVisible();
  await expect(panel.getByText("Scouts reporting", { exact: true }).locator("..")).toContainText("1");
  await panel.getByRole("button", { name: "By scout", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "2 responses", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Table", exact: true }).click();
  lead = false;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(panel.getByLabel("Scout", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "2 responses", exact: true })).toBeVisible();
  await expect(panel.getByText("Filed by you", { exact: true })).toBeVisible();
});
