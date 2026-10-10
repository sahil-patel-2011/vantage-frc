import { describe, expect, it } from "vitest";
import { distributeByShare, reconcileEvent } from "./reconcile";
import { scopedReconcileView } from "./reconcile-view";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventKey = "2026txho";
function fixture() {
  const report = reconcileEvent({ matches: [{ matchKey: `${eventKey}_qm1`, matchNumber: 1, compLevel: "qm", redAlliance: { teamKeys: ["frc1", "frc2", "frc3"], score: 30 }, blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"], score: 20 } }], entries: [] });
  return { ...report, orgId, eventKey, status: "live", generatedAt: "2026-10-09T00:00:00Z", scoutedEntries: 0, truncated: false,
    matches: report.matches.map(match => ({ ...match, distribution: { red: distributeByShare(match.red.officialScoringTotal, match.red.robots), blue: distributeByShare(match.blue.officialScoringTotal, match.blue.robots) } })) };
}
describe("alliance review responses", () => {
  it("preserves missing observations rather than turning them into zero", () => {
    const view = scopedReconcileView(fixture(), orgId, eventKey);
    expect(view?.status).toBe("live");
    if (view?.status === "live") expect(view.matches[0]?.red.robots[0]?.estimate).toBeNull();
  });
  it("rejects another team, another event, or a nested foreign-event match", () => {
    expect(scopedReconcileView(fixture(), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", eventKey)).toBeNull();
    expect(scopedReconcileView(fixture(), orgId, "2026other")).toBeNull();
    const foreign = fixture(); foreign.matches[0]!.matchKey = "2026other_qm1";
    expect(scopedReconcileView(foreign, orgId, eventKey)).toBeNull();
  });
  it("rejects malformed robot details and invalid summary counts", () => {
    const malformed = fixture();
    expect(scopedReconcileView({ ...malformed, summary: { ...malformed.summary, comparedAlliances: -1 } }, orgId, eventKey)).toBeNull();
    expect(scopedReconcileView({ ...malformed, matches: [{ ...malformed.matches[0], red: { robots: null } }] }, orgId, eventKey)).toBeNull();
    expect(scopedReconcileView(null, orgId, eventKey)).toBeNull();
  });
});
