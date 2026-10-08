import { expect, test } from "@playwright/test";
import { isolateUi, orgId, userId } from "./fixture";

// Authored for the authorized hosted fixture; do not run on the laptop.
const listId = "6925a000-0000-4000-8000-000000000090";
const list = { id: listId, name: "Regional picks", eventKey: "2026test", updatedAt: null, revision: 5, status: "open", entries: [
  { teamKey: "frc254", teamNumber: 254, nickname: "Team 254", rank: 1, tier: "avoid", notes: "Drive compatibility" },
] };
const desk = { orgId, eventKey: "2026test", eventName: "Test Regional", teamNumber: 6925, canEdit: true,
  candidates: [], pickLists: [list], sources: [], pickMode: "full", pickModeReason: null, scoutedTeams: 1, teamCount: 1, epaDrifts: [], strategySeats: [] };

test("unconfirmed ranking saves retain edits, release Save and preserve avoid entries", async ({ page, context }) => {
  await isolateUi(page, context);
  await page.route("**/api/strategy/pick-desk?**", route => route.fulfill({ json: desk }));
  let writes = 0;
  await page.route("**/api/intel/pick-lists", route => {
    writes += 1;
    expect(route.request().postDataJSON()).toMatchObject({ id: listId, baseRevision: 5, entries: [{ teamKey: "frc254", rank: 1, tier: "avoid", notes: "Drive compatibility" }] });
    return route.fulfill({ status: 201, json: {} });
  });
  await page.goto(`/competition?tab=picks&orgId=${orgId}`);
  const workbench = page.getByRole("region", { name: "Pick list workbench", exact: true });
  await expect(workbench.locator('[data-tier-list="avoid"]')).toContainText("254");
  const name = workbench.getByLabel("List name", { exact: true });
  await name.fill("Our final picks");
  const save = workbench.getByRole("button", { name: "Save pick list", exact: true });
  await save.click();
  await expect(workbench.getByText(/Save could not be confirmed/)).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(name).toHaveValue("Our final picks");
  expect(writes).toBe(1);
  await workbench.getByRole("combobox", { name: "Saved pick list", exact: true }).selectOption("");
  await expect(page.getByRole("dialog", { name: "Discard unsaved ranking changes?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(name).toHaveValue("Our final picks");
});

test("failed discussion additions retain entered details", async ({ page, context }) => {
  await isolateUi(page, context);
  await page.route("**/api/picklist-collab?**", route => route.fulfill({ json: {
    status: "live", orgId, teamNumber: 6925, lists: [{ ...list, createdBy: userId, seasonYear: 2026 }],
    activeList: { ...list, createdBy: userId, seasonYear: 2026 }, entries: [],
    summary: { totalEntries: 0, totalVotes: 0, totalVoters: 0, byTier: [] }, fieldStats: {}, eventTeams: [], computedAt: "2026-10-07T12:00:00Z",
  } }));
  await page.route("**/api/picklist-collab", route => route.fulfill({ status: 503, json: { error: "The list could not be saved" } }));
  await page.goto(`/competition?tab=picks&view=discussion&orgId=${orgId}&listId=${listId}`);
  await page.getByText("Add a team that isn't in the ranking", { exact: true }).click();
  const form = page.locator("#picklist-collab-add");
  await form.getByRole("spinbutton", { name: "Team number", exact: true }).fill("254");
  await form.getByRole("textbox", { name: "Note (optional)", exact: true }).fill("Watch the climb in finals");
  await form.getByRole("button", { name: "Add to list", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The list could not be saved");
  await expect(form.getByRole("spinbutton", { name: "Team number", exact: true })).toHaveValue("254");
  await expect(form.getByRole("textbox", { name: "Note (optional)", exact: true })).toHaveValue("Watch the climb in finals");
  await expect(form.getByRole("button", { name: "Add to list", exact: true })).toBeEnabled();
});
