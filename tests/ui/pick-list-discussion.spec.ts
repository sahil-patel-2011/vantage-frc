import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, userId } from "./fixture";
import type { PicklistCollabView } from "../../apps/web/lib/picklist-collab/compute-picklist-collab";

// Hosted fixture only. No laptop runtime is authorized.
const listId = "6925a000-0000-4000-8000-000000000090";
const entryId = "6925a000-0000-4000-8000-000000000091";
function fixture(): Extract<PicklistCollabView, { status: "live" }> {
  const list = { id: listId, name: "Regional picks", eventKey: "2026test", seasonYear: 2026, status: "open" as const, createdBy: userId, updatedAt: "2026-10-07T12:00:00Z" };
  return { status: "live", orgId, userId, teamNumber: 6925, lists: [list], activeList: list,
    entries: [{ id: entryId, teamNumber: 254, teamName: "Team 254", tier: "first_pick", position: 1, note: "Check drive compatibility", addedBy: userId, weightedScore: 3, averageRankSuggestion: 2,
      votes: [{ id: "own-vote", voterId: userId, voterName: "Ada", weight: 1, rankSuggestion: null, comment: "Quick cycles", updatedAt: list.updatedAt },
        { id: "peer-vote", voterId: "peer", voterName: "Grace", weight: 2, rankSuggestion: 2, comment: "Reliable autonomous path", updatedAt: list.updatedAt }] }],
    summary: { totalEntries: 1, totalVotes: 2, totalVoters: 2, byTier: [{ tier: "first_pick", count: 1 }] }, fieldStats: {}, eventTeams: [], computedAt: list.updatedAt };
}

for (const width of [390, 1280]) test(`team discussion edits only my feedback and restores focus at ${width}px`, async ({ page, context }) => {
  await isolateUi(page, context);
  await page.setViewportSize({ width, height: 950 });
  const data = fixture();
  await page.route("**/api/picklist-collab?**", route => route.fulfill({ json: data }));
  await page.route("**/api/picklist-collab", route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ orgId, listId, entryId });
    if (body.action === "cast-vote") Object.assign(data.entries[0].votes[0], { weight: body.weight, rankSuggestion: body.rankSuggestion, comment: body.comment });
    else if (body.action === "remove-vote") data.entries[0].votes = data.entries[0].votes.filter(vote => vote.voterId !== userId);
    else throw new Error(`Unexpected action ${body.action}`);
    return route.fulfill({ json: data });
  });
  await page.goto(`/competition?tab=picks&view=discussion&orgId=${orgId}&listId=${listId}`);
  const opener = page.getByRole("button", { name: "Discuss team 254", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Team 254 discussion", exact: true });
  await expect(dialog.getByText("Grace", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Reliable autonomous path", { exact: true })).toBeVisible();
  const comment = dialog.getByRole("textbox", { name: "Reason or observation", exact: true });
  await expect(comment).toHaveValue("Quick cycles");
  await comment.fill("Quick cycles, good defense fit");
  await comment.press("Escape");
  await expect(page.getByRole("dialog", { name: "Discard unsaved feedback?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(comment).toHaveValue("Quick cycles, good defense fit");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByText("Your vote and feedback are saved.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Quick cycles, good defense fit", { exact: true })).toBeVisible();
  await accessible(page, ".picklist-discussion");
  await dialog.getByRole("button", { name: "Withdraw my vote", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Withdraw your vote?", exact: true });
  await confirmation.getByRole("button", { name: "Withdraw my vote", exact: true }).click();
  await expect(dialog.getByText("Your vote was withdrawn.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Reliable autonomous path", { exact: true })).toBeVisible();
  expect(data.entries[0].votes).toHaveLength(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("a stale successful vote response never claims the feedback was saved", async ({ page, context }) => {
  await isolateUi(page, context);
  const data = fixture();
  await page.route("**/api/picklist-collab?**", route => route.fulfill({ json: data }));
  await page.route("**/api/picklist-collab", route => route.fulfill({ json: data }));
  await page.goto(`/competition?tab=picks&view=discussion&orgId=${orgId}&listId=${listId}`);
  await page.getByRole("button", { name: "Discuss team 254", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Team 254 discussion", exact: true });
  const comment = dialog.getByRole("textbox", { name: "Reason or observation", exact: true });
  await comment.fill("New observation that was not saved");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByText(/Your vote could not be confirmed/)).toBeVisible();
  await expect(comment).toHaveValue("New observation that was not saved");
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await expect(dialog.getByText("Your vote and feedback are saved.", { exact: true })).toHaveCount(0);
});

test("refreshing a removed team preserves the open unsaved feedback", async ({ page, context }) => {
  await isolateUi(page, context);
  const data = fixture();
  await page.route("**/api/picklist-collab?**", route => route.fulfill({ json: data }));
  await page.goto(`/competition?tab=picks&view=discussion&orgId=${orgId}&listId=${listId}`);
  await page.getByRole("button", { name: "Discuss team 254", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Team 254 discussion", exact: true });
  const comment = dialog.getByRole("textbox", { name: "Reason or observation", exact: true });
  await comment.fill("Unsaved observation to retain");
  data.entries = [];
  data.summary.totalEntries = 0;
  await dialog.getByRole("button", { name: "Refresh feedback", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("This robot was removed");
  await expect(comment).toHaveValue("Unsaved observation to retain");
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
});
