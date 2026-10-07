import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, userId, schemaId } from "./fixture";
import { MATCH_CAPTURE_KEY, validatePayload, type ScoutSchema, type SyncEntry } from "../../packages/scouting/src";
import { freeScoutDefinition, parseFreeScoutReport, type SavedFreeScoutReport } from "../../apps/web/lib/scouting/free-scout";

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) test(`match activity survives reload, saves offline and synchronizes at ${width}px ${theme}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await isolateUi(page, context, theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const definition = { title: "Match observations", fields: [{ key: "auto_fuel", label: "Auto fuel scored", type: "number" as const, config: { requireObservation: true, min: 0, integer: true } }] };
  const saved: SyncEntry[] = [];
  await page.route("**/api/scouting/bootstrap?**", route => route.fulfill({ json: {
    eventKey: "2026test", eventName: "Test Regional", schemas: [{ id: schemaId, orgId, year: 2026, type: "match", version: 1, definition }], assignments: [],
    matches: [{ matchKey: "2026test_qm1", matchNumber: 1, compLevel: "qm", redAlliance: { teamKeys: ["frc254"] }, blueAlliance: { teamKeys: [] } }],
    recentEntries: saved.map(entry => ({ ...entry, id: entry.clientId, scoutName: "Ada", scoutUserId: userId, updatedAt: new Date().toISOString() })), myEntries: [], scoutIdentity: { userId, displayName: "Ada" },
  } }));
  await page.route("**/api/scouting/sync", async route => {
    const body = route.request().postDataJSON() as { entries: SyncEntry[] };
    for (const entry of body.entries) { expect(validatePayload(definition, entry.payload)).toEqual([]); saved.push(entry); }
    await route.fulfill({ json: { acknowledgements: body.entries.map(entry => ({ clientId: entry.clientId })), rejected: [] } });
  });
  await page.goto(`/competition?tab=scouting&orgId=${orgId}&matchKey=2026test_qm1&teamKey=frc254`);
  const recorder = page.getByRole("region", { name: "Live match activity" });
  await expect(recorder).toBeVisible();
  await expect(recorder.getByRole("button", { name: "Shooting", exact: true })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "Before match", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("spinbutton", { name: "Auto fuel scored", exact: true })).toHaveCount(0);
  const epoch = Date.parse("2026-10-06T13:00:00Z");
  await page.clock.setFixedTime(new Date(epoch));
  await page.getByRole("button", { name: "Start match timer when auto starts" }).click();
  await page.clock.setFixedTime(new Date(epoch + 1000));
  await expect(recorder).toContainText("0:01 elapsed");
  await recorder.getByRole("button", { name: "Shooting", exact: true }).click();
  await page.clock.setFixedTime(new Date(epoch + 11000));
  await expect(recorder).toContainText("0:11 elapsed");
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('"kind":"shooting"') && value.includes('"endMs":null')))).toBe(true);
  // Autosave is the real browser draft path, not a prefilled fixture payload.
  await page.reload();
  await expect(recorder.getByRole("button", { name: "Stop shooting", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
  await recorder.getByRole("button", { name: "Stop shooting", exact: true }).click();
  await recorder.getByLabel("Fuel released in last shooting bout", { exact: true }).fill("20");
  await page.clock.setFixedTime(new Date(epoch + 34000));
  await expect(recorder).toContainText("0:34 elapsed");
  await expect(recorder).toContainText("Hub status unconfirmed");
  await recorder.getByLabel("FMS: first inactive hub", { exact: true }).selectOption("red");
  await expect(recorder).toContainText("Hub inactive");
  await recorder.getByRole("button", { name: "Defense", exact: true }).click();
  await page.clock.setFixedTime(new Date(epoch + 39000));
  await expect(recorder).toContainText("0:39 elapsed");
  await recorder.getByRole("button", { name: "Stop defense", exact: true }).click();
  await recorder.getByRole("button", { name: "Shooting", exact: true }).click();
  await page.clock.setFixedTime(new Date(epoch + 40000));
  await expect(recorder).toContainText("0:40 elapsed");
  await recorder.getByRole("button", { name: "Stop shooting", exact: true }).click();
  await recorder.getByLabel("Fuel released in last shooting bout", { exact: true }).fill("0");
  await recorder.getByText("Review recorded activity", { exact: true }).click();
  await expect(recorder).toContainText("1.82 fuel/s · 20 in 11.0s");
  await accessible(page, '.scout-answers');
  await page.screenshot({ path: info.outputPath(`activity-${width}-${theme}.png`) });
  await page.clock.setFixedTime(new Date(epoch + 170000));
  await expect(page.getByRole("timer")).toContainText("Ready to review");
  await expect(page.getByRole("tab", { name: "Review", exact: true })).toHaveAttribute("aria-selected", "true");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save on this phone", exact: true }).click();
  await expect(page.locator("#scout-save-confirmation")).toBeVisible();
  expect(saved).toHaveLength(0);
  await context.setOffline(false);
  await expect.poll(() => saved.length).toBe(1);
  const capture = saved[0]!.payload[MATCH_CAPTURE_KEY] as { bouts: Array<{ kind: string; count: number | null; startMs: number; endMs: number }> };
  expect(capture.bouts.map(bout => [bout.kind, bout.count, bout.endMs - bout.startMs])).toEqual([["shooting", 20, 10000], ["defending", null, 5000], ["shooting", 0, 1000]]);
  expect(saved[0]?.payload).not.toHaveProperty("auto_fuel");
  await page.route("**/api/scouting/teams?**", route => route.fulfill({ json: {
    status: "needs_formula", eventKey: "2026test", message: "No scoring formula", observations: [
      { teamKey: "frc254", reports: [{ matchKey: "2026test_qm1", eventKey: "2026test", confidence: "normal", payload: saved[0]!.payload, fields: definition.fields }] },
      { teamKey: "frc6925", reports: [{ matchKey: "2026test_qm1", eventKey: "2026test", confidence: "normal", payload: { auto_fuel: 0, tower_level: "L3" }, fields: [...definition.fields, { key: "tower_level", label: "Endgame tower climb", type: "select", options: ["none", "L1", "L2", "L3"] }] }] },
    ],
  } }));
  await page.goto(`/competition?tab=teams&orgId=${orgId}`);
  const capabilities = page.getByRole("region", { name: "Recorded robot capabilities" });
  await expect(capabilities.getByRole("heading", { name: "2 robots watched" })).toBeVisible();
  await capabilities.getByText("Compare recorded capabilities", { exact: true }).click();
  const table = capabilities.getByRole("table");
  const shooting = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Shooting · Observed throughput", exact: true }) });
  await expect(shooting).toContainText("1.82 fuel/second");
  await expect(shooting).toContainText("Not recorded");
  const climb = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Endgame tower climb", exact: true }) });
  await expect(climb).toContainText("L3: 1/1");
  await expect(climb).toContainText("Not recorded");
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`comparison-${width}-${theme}.png`) });
  await capabilities.getByLabel("Robot", { exact: true }).selectOption("frc254");
  await capabilities.getByRole("button", { name: "Match reports", exact: true }).click();
  await capabilities.locator(".intel-report-list details > summary").first().click();
  await expect(capabilities.getByRole("region", { name: "Observed match activity" })).toContainText("20 in 11.0s");
  await accessible(page, ".stp-observations");
  await page.screenshot({ path: info.outputPath(`report-${width}-${theme}.png`) });
});

test("practice scouting retains its clock, rejects an unfinished bout and saves explicit zero", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await isolateUi(page, context);
  const reports: SavedFreeScoutReport[] = [];
  await page.route("**/api/scouting/bootstrap?**", route => route.fulfill({ json: { eventKey: null, schemas: [], matches: [], assignments: [], recentEntries: [], scoutIdentity: { userId, displayName: "Ada" } } }));
  await page.route("**/api/scouting/free-reports**", route => {
    if (route.request().method() === "POST") {
      const report = parseFreeScoutReport(route.request().postDataJSON().report);
      reports.push({ ...report, scoutUserId: userId, definition: freeScoutDefinition(report.year, report.type) });
      return route.fulfill({ json: { id: report.id } });
    }
    return route.fulfill({ json: { userId, reports, hasMore: false } });
  });
  await page.goto(`/competition?tab=scouting&mode=free&scoutTab=match&orgId=${orgId}`);
  await page.getByLabel("Team number", { exact: true }).fill("254");
  await page.getByRole("button", { name: "Start scouting", exact: true }).click();
  const epoch = Date.parse("2026-10-06T13:00:00Z");
  await page.clock.setFixedTime(new Date(epoch));
  await page.getByRole("button", { name: "Start match timer when auto starts" }).click();
  const recorder = page.getByRole("region", { name: "Live match activity" });
  await page.clock.setFixedTime(new Date(epoch + 1000));
  await expect(recorder).toContainText("0:01 elapsed");
  await recorder.getByRole("button", { name: "Shooting", exact: true }).click();
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByRole("region", { name: "Practice scouting" })).toContainText("Stop the current match activity before saving");
  expect(reports).toHaveLength(0);
  await page.reload();
  await expect(recorder.getByRole("button", { name: "Stop shooting", exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(epoch + 4000));
  await expect(recorder).toContainText("0:04 elapsed");
  await recorder.getByRole("button", { name: "Stop shooting", exact: true }).click();
  await recorder.getByLabel("Fuel released in last shooting bout", { exact: true }).fill("0");
  await accessible(page, ".free-scout");
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect.poll(() => reports.length).toBe(1);
  await expect(page.getByRole("region", { name: "Practice reports" })).toContainText("Uploaded");
  expect(reports[0]?.payload[MATCH_CAPTURE_KEY]).toMatchObject({ bouts: [{ kind: "shooting", startMs: 1000, endMs: 4000, count: 0 }] });
  expect(reports[0]?.payload).not.toHaveProperty("auto_fuel");
});

test("a new team builds and publishes the season form without losing collection rules", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await isolateUi(page, context);
  const published: ScoutSchema[] = [];
  await page.route("**/api/scouting/schemas**", route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.type).toBe("match");
      expect(validatePayload(body.definition, {})).toEqual([]);
      published.push({ id: schemaId, orgId, year: 2026, type: "match", version: 1, definition: body.definition });
      return route.fulfill({ json: { id: schemaId, version: 1 } });
    }
    return route.fulfill({ json: { eventKey: "2026test", year: 2026, schemas: published, canManageSchemas: true } });
  });
  await page.goto(`/competition?tab=forms&orgId=${orgId}`);
  await page.getByRole("combobox", { name: "Form type", exact: true }).selectOption("match");
  const auto = page.locator(".sfb-question").filter({ has: page.locator(".sfb-question-select", { hasText: "Auto fuel scored" }) });
  await auto.locator(".sfb-question-select").click();
  await auto.getByText("Description, chart and advanced options", { exact: true }).click();
  await expect(auto.getByLabel("Match section for question 2", { exact: true })).toHaveValue("auto");
  await expect(auto.getByRole("checkbox", { name: "Keep untouched counts blank", exact: true })).toBeChecked();
  await auto.getByLabel("Match section for question 2", { exact: true }).selectOption("review");
  await page.getByLabel("Form title", { exact: true }).fill("Regional observations");
  await accessible(page, ".sfb-page");
  await page.getByRole("button", { name: "Publish this form", exact: true }).first().click();
  await expect.poll(() => published.length).toBe(1);
  expect(published[0]?.definition.fields.find(field => field.key === "auto_fuel")?.config).toMatchObject({ scoutPhase: "review", requireObservation: true, min: 0, integer: true });
  expect(published[0]?.definition.fields.find(field => field.key === "auto_tower_level")?.options).toEqual(["none", "L1"]);
  expect(published[0]?.definition.fields.find(field => field.key === "tower_level")?.options).toEqual(["none", "L1", "L2", "L3"]);
});
