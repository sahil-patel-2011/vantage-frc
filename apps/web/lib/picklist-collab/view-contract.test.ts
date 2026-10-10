import { describe, expect, it } from "vitest";
import { confirmsCollabMutation, isCollabView, type CollabLiveView } from "./view-contract";
const entry = { id: "entry", teamNumber: 6925, teamName: "WA", tier: "first_pick" as const, position: 1, note: null, addedBy: "lead", votes: [], weightedScore: 0, averageRankSuggestion: null };
const before: CollabLiveView = { status: "live", orgId: "org", teamNumber: 6925, lists: [], activeList: { id: "list", eventKey: "2026test", name: "Final picks", seasonYear: 2026, status: "open", createdBy: "lead", updatedAt: "now", revision: 4 }, entries: [entry], summary: { totalEntries: 1, totalVotes: 0, totalVoters: 0, byTier: [] }, computedAt: "now", currentUserId: "member", canManage: false };
const after: CollabLiveView = { ...before, activeList: { ...before.activeList!, revision: 5 } };
describe("discussion acknowledgement", () => {
  it("rejects another team's data and a different selected list", () => {
    expect(isCollabView(after, "other")).toBe(false);
    expect(isCollabView(after, "org", "other")).toBe(false);
    expect(isCollabView(after, "org", "list")).toBe(true);
  });
  it("does not call an unchanged response a saved edit", () => {
    expect(confirmsCollabMutation(before, { action: "update-list-status", status: "open" }, before)).toBe(false);
    expect(confirmsCollabMutation({ ...after, activeList: { ...after.activeList!, status: "locked" } }, { action: "update-list-status", status: "locked" }, before)).toBe(true);
  });
  it("rejects malformed cached evidence before the sliders or discussion render", () => {
    expect(isCollabView({ ...after, entries: [{ ...entry, votes: [null] }] })).toBe(false);
    expect(isCollabView({ ...after, fieldStats: { autoPoints: { mean: 10, std: -1, n: 2 } } })).toBe(false);
    expect(isCollabView({ ...after, eventTeams: [{ teamKey: "frc6925", values: null }] })).toBe(false);
    expect(isCollabView({ ...after, formMetricSamples: { frc6925: { "form:cycles": -1 } } })).toBe(false);
    expect(isCollabView({ ...after, formMetricDefinitions: { "form:cycles": null } })).toBe(false);
    expect(isCollabView({ status: "setup_required", orgId: "org", message: "Choose a list", steps: [null] })).toBe(false);
  });
  it("requires the signed-in member's exact vote, not somebody else's", () => {
    const vote = { id: "vote", voterId: "member", weight: 2, rankSuggestion: 3, comment: "Reliable auto", updatedAt: "now" };
    const voted = { ...after, entries: [{ ...entry, votes: [vote] }] };
    const request = { action: "cast-vote", entryId: "entry", weight: 2, rankSuggestion: 3, comment: "Reliable auto" };
    expect(confirmsCollabMutation(voted, request, before)).toBe(true);
    expect(confirmsCollabMutation({ ...voted, currentUserId: "someone-else" }, request, before)).toBe(false);
    expect(confirmsCollabMutation(voted, { ...request, weight: 1 }, before)).toBe(false);
    expect(confirmsCollabMutation(voted, { action: "remove-vote", entryId: "entry" }, before)).toBe(false);
    expect(confirmsCollabMutation(after, { action: "remove-vote", entryId: "entry" }, before)).toBe(true);
  });
  it("requires the new list identity when creating and exact entry disappearance when removing", () => {
    expect(confirmsCollabMutation(after, { action: "create-list", name: "New list" }, before)).toBe(false);
    expect(confirmsCollabMutation(after, { action: "delete-entry", entryId: "entry" }, before)).toBe(false);
    expect(confirmsCollabMutation({ ...after, entries: [] }, { action: "delete-entry", entryId: "entry" }, before)).toBe(true);
  });
});
