import { describe, expect, it } from "vitest";
import { pickListRankingRequest } from "./ranking-request";

const request = { orgId: "11111111-1111-4111-8111-111111111111", eventKey: "2026test", name: "Final picks", expectedRevision: 4, entries: [{ teamKey: "frc6925", rank: 1, tier: "first" }] };
describe("ranking request boundaries", () => {
  it("accepts explicit empty first-save baselines and historical team-analysis tiers", () => {
    expect(pickListRankingRequest.safeParse({ ...request, expectedRevision: null }).success).toBe(true);
    expect(pickListRankingRequest.safeParse({ ...request, expectedRevision: undefined, entries: [{ teamKey: "frc6925", rank: 1, tier: "review" }] }).success).toBe(true);
  });
  it.each([
    [{ teamKey: "frc6925", rank: 1 }, { teamKey: "frc6925", rank: 2 }],
    [{ teamKey: "frc6925", rank: 1 }, { teamKey: "frc254", rank: 1 }],
    [{ teamKey: "frc6925", rank: 2 }],
    [{ teamKey: "frc0", rank: 1 }],
  ].map(entries => ({ entries })))("rejects duplicate identities, duplicate or gapped ranks and invalid teams: %j", ({ entries }) => {
    expect(pickListRankingRequest.safeParse({ ...request, entries }).success).toBe(false);
  });
  it("rejects unbounded notes and unexpected persistence fields", () => {
    expect(pickListRankingRequest.safeParse({ ...request, entries: [{ ...request.entries[0], notes: "x".repeat(2001) }] }).success).toBe(false);
    expect(pickListRankingRequest.safeParse({ ...request, createdBy: "another-user" }).success).toBe(false);
  });
});
