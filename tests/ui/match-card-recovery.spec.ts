import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId } from "./fixture";
import type { MatchStrategyCardsView } from "../../apps/web/lib/match-strategy-cards/compute-match-strategy-cards";
import { EMPTY_CARD_CONTENT } from "../../apps/web/lib/match-strategy-cards/card-content";

// For an authorized hosted runner only; do not run on the laptop.
function fixture(): Extract<MatchStrategyCardsView, { status: "live" }> {
  const card = { ...EMPTY_CARD_CONTENT, id: "2026test_qm12", matchKey: "2026test_qm12", eventKey: "2026test", compLevel: "qm", matchNumber: 12, setNumber: 1,
    scheduledAt: null, ownAllianceColor: "red" as const, isNextMatch: true, isUpcoming: true, hasCard: true, updatedAt: "2026-10-07T12:00:00Z", gamePlan: "Saved plan",
    alliances: [{ color: "red" as const, teamNumbers: [6925, 254, 118], isOwnAlliance: true }, { color: "blue" as const, teamNumbers: [1, 2, 3], isOwnAlliance: false }] };
  return { status: "live", orgId, teamNumber: 6925, eventKey: card.eventKey, eventName: "Test event", nextMatchKey: card.matchKey, briefingPayload: null, computedAt: card.updatedAt,
    cards: [card, { ...card, id: "2026test_qm10", matchKey: "2026test_qm10", matchNumber: 10, isNextMatch: false, isUpcoming: false }] };
}

for (const width of [390, 1280]) test(`match plans keep drafts, confirm saves and clear a confirmed deletion at ${width}px`, async ({ page, context }) => {
  await isolateUi(page, context);
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } }));
  const data = fixture();
  await page.route("**/api/match-strategy-cards?**", route => route.fulfill({ json: data }));
  await page.route("**/api/match-strategy-cards", route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ orgId, matchKey: data.cards[0].matchKey, eventKey: data.eventKey, baseRevision: data.cards[0].updatedAt });
    if (body.action === "save-card") Object.assign(data.cards[0], body, { hasCard: true, updatedAt: "2026-10-07T13:00:00Z" });
    else if (body.action === "delete-card") Object.assign(data.cards[0], EMPTY_CARD_CONTENT, { hasCard: false, updatedAt: null });
    else throw new Error(`Unexpected mutation ${body.action}`);
    return route.fulfill({ json: data });
  });
  await page.goto(`/match-strategy-cards?orgId=${orgId}`);
  const editor = page.locator(".msc-card:visible");
  const plan = editor.getByRole("textbox", { name: "Game plan", exact: true });
  await expect(plan).toHaveValue("Saved plan");
  await expect(page.getByRole("button", { name: "Open the plan for Qualification 10", exact: true })).toBeHidden();
  await plan.fill("Visible unsaved plan");
  await editor.getByRole("button", { name: "Copy draft", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain("Visible unsaved plan");
  await editor.getByRole("button", { name: "Safe duty", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(plan).toHaveValue("Visible unsaved plan");
  await editor.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Plan saved to your team." })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await accessible(page, ".msc-card:visible");
  await editor.getByRole("button", { name: "Delete plan", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete plan", exact: true }).click();
  await expect(plan).toHaveValue("");
  await expect(editor.getByText("Plan deleted. Scouting reports are kept.", { exact: true })).toBeVisible();
});

test("unconfirmed save preserves the draft and deliberate reload accepts the latest team plan", async ({ page, context }) => {
  await isolateUi(page, context);
  const data = fixture();
  await page.route("**/api/match-strategy-cards?**", route => route.fulfill({ json: data }));
  await page.route("**/api/match-strategy-cards", route => route.fulfill({ json: data }));
  await page.goto(`/match-strategy-cards?orgId=${orgId}`);
  const editor = page.locator(".msc-card:visible");
  const plan = editor.getByRole("textbox", { name: "Game plan", exact: true });
  await plan.fill("Unconfirmed new draft");
  await editor.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(editor.getByText("Save could not be confirmed. Your draft is still here.", { exact: true })).toBeVisible();
  await expect(plan).toHaveValue("Unconfirmed new draft");
  data.cards[0].gamePlan = "Teammate's newer plan";
  data.cards[0].updatedAt = "2026-10-07T14:00:00Z";
  await editor.getByRole("button", { name: "Reload saved plan", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reload plan", exact: true }).click();
  await expect(plan).toHaveValue("Teammate's newer plan");
  await expect(editor.getByText("Latest saved plan loaded.", { exact: true })).toBeVisible();
});
