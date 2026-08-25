import { describe, expect, it } from "vitest";
import {
  aggregateVotes,
  applyReorder,
  bucketFromTier,
  clampVoteWeight,
  comparePickEntries,
  detectReorderConflict,
  normalizeRanks,
  normalizeTeamKey,
  rankAssignments,
  sortPickEntries,
  summarizeBuckets,
  teamNumberFromKey,
  tierFromBucket,
  type OrderableEntry,
} from "./ordering";
import type { PickListVote } from "./types";

function entry(id: string, rank: number, bucket: OrderableEntry["bucket"], teamNumber?: number): OrderableEntry {
  return { id, rank, bucket, teamNumber: teamNumber ?? null };
}

function vote(voterId: string, weight: number, rankSuggestion: number | null = null): PickListVote {
  return {
    id: `v-${voterId}`,
    voterId,
    voterName: voterId,
    weight,
    rankSuggestion,
    comment: null,
    updatedAt: "2026-03-01T00:00:00Z",
  };
}

describe("comparePickEntries", () => {
  it("orders buckets first_pick, second_pick, unranked, avoid", () => {
    const sorted = sortPickEntries([
      entry("a", 1, "avoid"),
      entry("b", 1, "unranked"),
      entry("c", 1, "second_pick"),
      entry("d", 1, "first_pick"),
    ]).map((e) => e.id);
    expect(sorted).toEqual(["d", "c", "b", "a"]);
  });

  it("is a total order — ties fall through rank, team number, then id", () => {
    expect(comparePickEntries(entry("b", 3, "first_pick", 254), entry("a", 3, "first_pick", 254))).toBeGreaterThan(0);
    expect(comparePickEntries(entry("a", 3, "first_pick", 118), entry("a", 3, "first_pick", 254))).toBeLessThan(0);
    expect(comparePickEntries(entry("a", 2, "first_pick"), entry("b", 3, "first_pick"))).toBeLessThan(0);
  });

  it("sorts a null team number last instead of crashing", () => {
    const sorted = sortPickEntries([entry("a", 1, "first_pick"), entry("b", 1, "first_pick", 900)]).map((e) => e.id);
    expect(sorted).toEqual(["b", "a"]);
  });
});

describe("normalizeRanks", () => {
  it("densifies gaps and ties into 1..n", () => {
    const result = normalizeRanks([
      entry("a", 7, "first_pick", 254),
      entry("b", 7, "first_pick", 118),
      entry("c", 40, "second_pick", 1),
    ]);
    expect(result.map((r) => [r.id, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
  });

  it("is idempotent", () => {
    const once = normalizeRanks([entry("a", 5, "first_pick"), entry("b", 9, "avoid")]);
    const twice = normalizeRanks(once);
    expect(twice).toEqual(once);
  });

  it("returns 1-based ranks for a single entry", () => {
    expect(normalizeRanks([entry("a", 99, "unranked")])[0]!.rank).toBe(1);
  });
});

describe("applyReorder", () => {
  const list = [
    entry("a", 1, "first_pick", 111),
    entry("b", 2, "first_pick", 222),
    entry("c", 3, "first_pick", 333),
    entry("d", 4, "second_pick", 444),
  ];

  it("moves an entry down and renumbers everyone", () => {
    const result = applyReorder(list, { entryId: "a", toIndex: 2 });
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("moves an entry up", () => {
    const result = applyReorder(list, { entryId: "c", toIndex: 0 });
    expect(result.map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("changes bucket and position in one move without re-sorting the drag away", () => {
    const result = applyReorder(list, { entryId: "d", toIndex: 1, bucket: "first_pick" });
    expect(result.map((r) => r.id)).toEqual(["a", "d", "b", "c"]);
    expect(result.find((r) => r.id === "d")!.bucket).toBe("first_pick");
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("keeps a bucket-demoted entry below every remaining first pick", () => {
    const result = applyReorder(list, { entryId: "a", toIndex: 0, bucket: "avoid" });
    expect(result.map((r) => r.id)).toEqual(["b", "c", "d", "a"]);
    expect(result.at(-1)!.rank).toBe(4);
  });

  it("clamps an out-of-range destination instead of dropping the row", () => {
    expect(applyReorder(list, { entryId: "a", toIndex: 99 }).map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
    expect(applyReorder(list, { entryId: "c", toIndex: -5 }).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps bucket grouping authoritative — dragging above a higher bucket does not promote", () => {
    const result = applyReorder(list, { entryId: "d", toIndex: 0 });
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.find((r) => r.id === "d")!.bucket).toBe("second_pick");
  });

  it("is a no-op normalization when the entry id is unknown", () => {
    expect(applyReorder(list, { entryId: "nope", toIndex: 0 }).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("never loses or duplicates a row", () => {
    const result = applyReorder(list, { entryId: "b", toIndex: 3 });
    expect(new Set(result.map((r) => r.id)).size).toBe(list.length);
    expect(new Set(result.map((r) => r.rank)).size).toBe(list.length);
  });
});

describe("two devices reordering the same list", () => {
  const base = [
    entry("a", 1, "first_pick", 111),
    entry("b", 2, "first_pick", 222),
    entry("c", 3, "first_pick", 333),
  ];

  it("is last-write-wins: the second device's move lands on top of the first", () => {
    const deviceOne = applyReorder(base, { entryId: "c", toIndex: 0 }); // c, a, b
    const deviceTwo = applyReorder(deviceOne, { entryId: "a", toIndex: 2 }); // c, b, a
    expect(deviceTwo.map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(deviceTwo.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("reports the loser's move as a visible conflict rather than swallowing it", () => {
    // Device two started editing at revision 4; device one already pushed revision 5.
    const conflict = detectReorderConflict({
      expectedRevision: 4,
      actualRevision: 5,
      lastEditedBy: "Device One",
      lastEditedAt: "2026-03-01T10:00:00Z",
    });
    expect(conflict).not.toBeNull();
    expect(conflict?.message).toContain("Device One");
  });

  it("converges: replaying the same move sequence from the same base gives the same ranks", () => {
    const a = applyReorder(applyReorder(base, { entryId: "b", toIndex: 0 }), { entryId: "c", toIndex: 1 });
    const b = applyReorder(applyReorder(base, { entryId: "b", toIndex: 0 }), { entryId: "c", toIndex: 1 });
    expect(a).toEqual(b);
  });
});

describe("rankAssignments", () => {
  it("splits into parallel arrays for the bulk update", () => {
    expect(rankAssignments([{ id: "a", rank: 1 }, { id: "b", rank: 2 }])).toEqual({
      ids: ["a", "b"],
      ranks: [1, 2],
    });
  });
});

describe("aggregateVotes", () => {
  it("sums weights into a consensus score", () => {
    expect(aggregateVotes([vote("u1", 1), vote("u2", 2.5), vote("u3", 0.25)]).weightedScore).toBe(3.75);
  });

  it("weight-averages rank suggestions and ignores voters who gave none", () => {
    const result = aggregateVotes([vote("u1", 3, 2), vote("u2", 1, 10), vote("u3", 5, null)]);
    expect(result.averageRankSuggestion).toBe(4);
    expect(result.voterCount).toBe(3);
  });

  it("returns null rank suggestion when nobody suggested one", () => {
    expect(aggregateVotes([vote("u1", 2)]).averageRankSuggestion).toBeNull();
  });

  it("drops non-finite or non-positive weights rather than poisoning the score", () => {
    const result = aggregateVotes([vote("u1", Number.NaN, 1), vote("u2", 0, 1), vote("u3", 2, 6)]);
    expect(result.weightedScore).toBe(2);
    expect(result.averageRankSuggestion).toBe(6);
    expect(result.voterCount).toBe(1);
  });

  it("returns a zero score for an unvoted entry, not a fabricated one", () => {
    expect(aggregateVotes([])).toEqual({ weightedScore: 0, averageRankSuggestion: null, voterCount: 0 });
  });
});

describe("clampVoteWeight", () => {
  it("keeps weights inside the 0.1–5 DB check", () => {
    expect(clampVoteWeight(9)).toBe(5);
    expect(clampVoteWeight(0)).toBe(0.1);
    expect(clampVoteWeight(-3)).toBe(0.1);
    expect(clampVoteWeight(Number.NaN)).toBe(1);
    expect(clampVoteWeight(1.239)).toBe(1.24);
  });
});

describe("detectReorderConflict", () => {
  it("reports last-write-wins when the caller's revision is stale", () => {
    const conflict = detectReorderConflict({
      expectedRevision: 4,
      actualRevision: 7,
      lastEditedBy: "Priya",
      lastEditedAt: "2026-03-01T10:00:00Z",
    });
    expect(conflict?.code).toBe("stale_revision");
    expect(conflict?.message).toContain("Priya");
    expect(conflict?.actualRevision).toBe(7);
  });

  it("stays silent when the caller was up to date", () => {
    expect(
      detectReorderConflict({ expectedRevision: 7, actualRevision: 7, lastEditedBy: "Priya", lastEditedAt: null }),
    ).toBeNull();
  });

  it("stays silent when the caller did not supply a revision", () => {
    expect(
      detectReorderConflict({ expectedRevision: null, actualRevision: 9, lastEditedBy: null, lastEditedAt: null }),
    ).toBeNull();
  });

  it("falls back to a neutral actor label when the editor is unknown", () => {
    const conflict = detectReorderConflict({
      expectedRevision: 1,
      actualRevision: 2,
      lastEditedBy: "  ",
      lastEditedAt: null,
    });
    expect(conflict?.message).toContain("another device");
  });
});

describe("tier <-> bucket mapping", () => {
  it("maps legacy strategy tiers onto the shared vocabulary", () => {
    expect(bucketFromTier("first")).toBe("first_pick");
    expect(bucketFromTier("Second")).toBe("second_pick");
    expect(bucketFromTier("third")).toBe("second_pick");
    expect(bucketFromTier("avoid")).toBe("avoid");
    expect(bucketFromTier("watch")).toBe("unranked");
    expect(bucketFromTier(null)).toBe("unranked");
  });

  it("round-trips the buckets that have a tier string", () => {
    expect(bucketFromTier(tierFromBucket("first_pick"))).toBe("first_pick");
    expect(bucketFromTier(tierFromBucket("second_pick"))).toBe("second_pick");
    expect(bucketFromTier(tierFromBucket("avoid"))).toBe("avoid");
    expect(tierFromBucket("unranked")).toBeNull();
  });
});

describe("summarizeBuckets", () => {
  it("counts every bucket including the empty ones", () => {
    expect(summarizeBuckets([{ bucket: "first_pick" }, { bucket: "first_pick" }, { bucket: "avoid" }])).toEqual([
      { bucket: "first_pick", count: 2 },
      { bucket: "second_pick", count: 0 },
      { bucket: "unranked", count: 0 },
      { bucket: "avoid", count: 1 },
    ]);
  });
});

describe("team key normalization", () => {
  it("accepts a bare number or a team key", () => {
    expect(normalizeTeamKey("254")).toBe("frc254");
    expect(normalizeTeamKey("frc254")).toBe("frc254");
    expect(normalizeTeamKey("FRC0254")).toBe("frc254");
    expect(normalizeTeamKey(1678)).toBe("frc1678");
  });

  it("refuses junk instead of inventing a team", () => {
    expect(normalizeTeamKey("")).toBeNull();
    expect(normalizeTeamKey("frc")).toBeNull();
    expect(normalizeTeamKey("the good one")).toBeNull();
    expect(normalizeTeamKey(null)).toBeNull();
  });

  it("extracts the number back out", () => {
    expect(teamNumberFromKey("frc971")).toBe(971);
    expect(teamNumberFromKey("nope")).toBeNull();
    expect(teamNumberFromKey(null)).toBeNull();
  });
});
