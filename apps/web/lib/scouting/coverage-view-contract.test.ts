import { describe, expect, it } from "vitest";
import { assignmentResult, isCoverageView } from "./coverage-view-contract";
import { coverageMutationRequest } from "./coverage-request";

const orgId = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const eventKey = "2026test";
const scope = { orgId, eventKey, qualsOnly: true };
function live() {
  return { status: "live", orgId, eventKey, eventName: null, teamNumber: 6925, generatedAt: "2026-10-09T12:00:00Z", qualsOnly: true, canAssign: true,
    summary: { totalSlots: 0, unscouted: 0, assignedWaiting: 0, covered: 0, doubleCovered: 0, coverageRate: null, doubleRate: null },
    live: { focusMatchKeys: [], focusSlots: [], gapSlots: [], doubleSlots: [] }, slots: [], playedMatchKeys: [], scouts: [],
    scope: { playedMatches: 0, playedRobots: 0, playedScouted: 0, playedMissed: 0, upcomingMatches: 0, upcomingRobots: 0, upcomingNoScout: 0, reportsBeforePlay: 0 },
    schemaRoles: { status: "no_schema", warnings: [] } };
}
describe("assignment snapshots", () => {
  it("requires actual view fields and matching team, event and qualification filters", () => {
    expect(isCoverageView(live(), scope)).toBe(true);
    expect(isCoverageView({ status: "live" }, scope)).toBe(false);
    expect(isCoverageView({ ...live(), orgId: otherOrg }, scope)).toBe(false);
    expect(isCoverageView({ ...live(), eventKey: "2026other" }, scope)).toBe(false);
    expect(isCoverageView({ ...live(), qualsOnly: false }, scope)).toBe(false);
    expect(isCoverageView({ ...live(), live: { focusMatchKeys: null } }, scope)).toBe(false);
  });
  it("does not label an unrelated action or missing outcome as a saved result", () => {
    expect(assignmentResult({ action: "assign-range", assigned: 1, unchanged: 2, refused: ["Q4 clashes"] }, "assign-range")).toMatchObject({ assigned: 1, unchanged: 2 });
    expect(assignmentResult({ action: "swap", assigned: 1, unchanged: 0, refused: [] }, "assign")).toBeNull();
    expect(assignmentResult({ action: "assign", assigned: -1 }, "assign")).toBeNull();
    expect(assignmentResult(null, "assign")).toBeNull();
  });
});
describe("assignment request boundaries", () => {
  const request = { orgId, action: "assign", matchKey: `${eventKey}_qm1`, teamKey: "00254", userId: otherOrg };
  it("normalizes real robot identifiers and validates action-specific input", () => {
    expect(coverageMutationRequest.parse(request)).toMatchObject({ teamKey: "frc254" });
    expect(coverageMutationRequest.safeParse({ ...request, userId: "foreign user" }).success).toBe(false);
    expect(coverageMutationRequest.safeParse({ ...request, matchKey: "fabricated" }).success).toBe(false);
    expect(coverageMutationRequest.safeParse({ ...request, teamKey: "frc0" }).success).toBe(false);
    expect(coverageMutationRequest.safeParse({ ...request, actorId: otherOrg }).success).toBe(false);
    expect(coverageMutationRequest.safeParse({ orgId, action: "assign-range", firstMatchKey: `${eventKey}_qm1` }).success).toBe(false);
  });
});
