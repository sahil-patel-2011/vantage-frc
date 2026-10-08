import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, userId } from "./fixture";

// Authored for an authorized hosted runner. Never run on the laptop.
function fixture() {
  const slots = [1, 2].map(number => ({ matchKey: `2026test_qm${number}`, teamKey: "frc254", teamNumber: 254, matchNumber: number, compLevel: "qm", setNumber: 1,
    alliance: "red", status: "unscouted", assignmentCount: 0, entryCount: 0, scoutNames: [], scoutUserIds: [], assignedScouts: [] }));
  return { status: "live", orgId, eventKey: "2026test", eventName: "Test event", generatedAt: "2026-10-07T12:00:00Z", qualsOnly: true, canAssign: true,
    summary: { totalSlots: 2, unscouted: 2, assignedWaiting: 0, covered: 0, doubleCovered: 0, coverageRate: 0, doubleRate: 0 },
    live: { focusMatchKeys: slots.map(slot => slot.matchKey), focusSlots: slots, gapSlots: slots, doubleSlots: [] }, slots,
    scouts: [{ userId, name: "Ada", role: "scout", assignedCount: 0, isMe: true }], schemaRoles: { status: "ready", warnings: [] } };
}

for (const width of [390, 1280]) test(`range assignment reports refused matches and keeps the chosen range at ${width}px`, async ({ page, context }) => {
  await isolateUi(page, context);
  await page.setViewportSize({ width, height: 950 });
  const data = fixture();
  await page.route("**/api/scouting/coverage?**", route => route.fulfill({ json: data }));
  await page.route("**/api/scouting/coverage", route => {
    expect(route.request().postDataJSON()).toMatchObject({ orgId, action: "assign-range", eventKey: "2026test", teamKey: "254", firstMatchKey: "2026test_qm1", lastMatchKey: "2026test_qm2", userId });
    return route.fulfill({ json: { ...data, mutation: { action: "assign-range", eventKey: "2026test", assigned: 1, unchanged: 0, refused: ["Q1: already covering Team 118"] } } });
  });
  await page.goto(`/scouting/lineup?orgId=${orgId}`);
  const range = page.locator(".lineup-range");
  await range.getByRole("textbox", { name: "Robot", exact: true }).fill("254");
  await range.getByRole("button", { name: "Assign this range", exact: true }).click();
  await expect(page.locator(".lineup-receipt")).toContainText("1 assignment saved. 1 could not be assigned.");
  await expect(page.locator(".lineup-receipt")).toContainText("Q1: already covering Team 118");
  await expect(range.getByRole("textbox", { name: "Robot", exact: true })).toHaveValue("254");
  await accessible(page, ".lineup-page");
});

test("unconfirmed assignment retains the scout and refresh denial clears private coverage", async ({ page, context }) => {
  await isolateUi(page, context);
  await page.clock.install();
  const data = fixture();
  let reads = 0;
  let denied = false;
  await page.route("**/api/scouting/coverage?**", route => { reads += 1; return route.fulfill(denied ? { status: 403, json: { error: "Organization access denied" } } : { json: data }); });
  await page.route("**/api/scouting/coverage", route => route.fulfill({ json: data }));
  await page.goto(`/scouting/lineup?orgId=${orgId}`);
  const slot = page.locator(".lineup-assign").first();
  await slot.getByRole("combobox").selectOption(userId);
  await slot.getByRole("button", { name: "Assign scout", exact: true }).click();
  await expect(page.getByText(/The assignment could not be confirmed/)).toBeVisible();
  await expect(slot.getByRole("combobox")).toHaveValue(userId);
  const initialReads = reads;
  await page.clock.fastForward(45000);
  expect(reads).toBe(initialReads);
  denied = true;
  await page.getByRole("button", { name: "Refresh coverage", exact: true }).click();
  await expect(page.locator(".lineup-range")).toHaveCount(0);
  await expect(page.locator(".lineup-board")).toHaveCount(0);
});
