import { describe, expect, it } from "vitest";
import { confirmedRankingList, rankingEntries, rankingIsDirty, rankingTier } from "./ranking-document";
import type { PickDeskEntry, PickDeskList } from "../strategy/pick-desk";

const entry: PickDeskEntry = { teamKey: "frc6925", teamNumber: 6925, nickname: "WA", rank: 1, tier: "third", bucket: "second_pick", notes: "Fast cycles" };
const list: PickDeskList = { id: "list", name: "Alliance picks", eventKey: "2026test", updatedAt: null, revision: 3, status: "open", entries: [entry] };

describe("ranking documents", () => {
  it("keeps the canonical Avoid bucket visible, and maps legacy third picks consistently", () => {
    expect(rankingTier({ tier: "first", bucket: "avoid" })).toBe("avoid");
    expect(rankingTier({ tier: "third" })).toBe("second");
  });
  it("makes the editable tier authoritative after normalization", () => {
    const draft = rankingEntries([entry]);
    expect(rankingIsDirty(list, list.name, draft)).toBe(false);
    draft[0]!.tier = "avoid";
    expect(rankingIsDirty(list, list.name, draft)).toBe(true);
  });
  it("ignores refreshed names and timestamps, while detecting changed notes and ranking", () => {
    const refreshed = { ...list, updatedAt: "2026-10-09", revision: 4, entries: [{ ...entry, nickname: "Renamed" }] };
    expect(rankingIsDirty(refreshed, " Alliance picks ", rankingEntries([entry]))).toBe(false);
    expect(rankingIsDirty(list, list.name, [{ ...entry, notes: "Slow cycles" }])).toBe(true);
    expect(rankingIsDirty(list, "Final picks", [entry])).toBe(true);
  });
  it("requires the same event, identity, positive revision and complete unique ranking before accepting a save", () => {
    expect(confirmedRankingList(list, "2026test", "list")).toBe(true);
    expect(confirmedRankingList(list, "2026other", "list")).toBe(false);
    expect(confirmedRankingList(list, "2026test", "other")).toBe(false);
    expect(confirmedRankingList({ ...list, revision: undefined }, "2026test")).toBe(false);
    expect(confirmedRankingList({ ...list, entries: [entry, entry] }, "2026test")).toBe(false);
    expect(confirmedRankingList({ ...list, entries: [{ ...entry, rank: 2 }] }, "2026test")).toBe(false);
  });
});
