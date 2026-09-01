import { describe, expect, it } from "vitest";
import {
  compareCoverageByWatchlist,
  normalizeWatchlistTeamKey,
  orderCoverageByWatchlist,
  watchlistPriority,
  watchlistTeamKeys,
} from "./order";

describe("normalizeWatchlistTeamKey", () => {
  it("canonicalizes frc keys and bare numbers", () => {
    expect(normalizeWatchlistTeamKey("frc254")).toBe("frc254");
    expect(normalizeWatchlistTeamKey(" FRC118 ")).toBe("frc118");
    expect(normalizeWatchlistTeamKey(4414)).toBe("frc4414");
    expect(normalizeWatchlistTeamKey("not-a-team")).toBeNull();
    expect(normalizeWatchlistTeamKey("")).toBeNull();
  });
});

describe("watchlistTeamKeys", () => {
  it("keeps first-seen order and drops junk duplicates", () => {
    expect(
      watchlistTeamKeys([
        { teamKey: "frc4414" },
        { teamKey: "frc118" },
        { teamKey: "frc4414" },
        { teamKey: "nope" },
        { teamKey: "118" },
      ]),
    ).toEqual(["frc4414", "frc118"]);
  });
});

describe("orderCoverageByWatchlist", () => {
  it("watchlist team sorts earlier", () => {
    const slots = [
      { teamKey: "frc118", matchNumber: 1 },
      { teamKey: "frc254", matchNumber: 1 },
      { teamKey: "frc4414", matchNumber: 2 },
    ];

    expect(orderCoverageByWatchlist(slots, ["frc4414"]).map((slot) => slot.teamKey)).toEqual([
      "frc4414",
      "frc118",
      "frc254",
    ]);
  });

  it("preserves watchlist rank among watched teams and schedule order among the rest", () => {
    const slots = [
      { teamKey: "frc1" },
      { teamKey: "frc2" },
      { teamKey: "frc3" },
      { teamKey: "frc4" },
    ];

    expect(orderCoverageByWatchlist(slots, ["frc4", "frc2"]).map((slot) => slot.teamKey)).toEqual([
      "frc4",
      "frc2",
      "frc1",
      "frc3",
    ]);
  });

  it("leaves schedule order alone when nothing is watched", () => {
    const slots = [{ teamKey: "frc118" }, { teamKey: "frc254" }];
    expect(orderCoverageByWatchlist(slots, [])).toEqual(slots);
    expect(orderCoverageByWatchlist(slots, ["not-a-team"])).toEqual(slots);
  });
});

describe("compareCoverageByWatchlist", () => {
  it("ranks a watched team before an unwatched one", () => {
    expect(compareCoverageByWatchlist({ teamKey: "frc4414" }, { teamKey: "frc118" }, ["frc4414"])).toBeLessThan(
      0,
    );
    expect(watchlistPriority("frc4414", ["frc254", "frc4414"])).toBe(1);
    expect(watchlistPriority("frc118", ["frc4414"])).toBeGreaterThan(watchlistPriority("frc4414", ["frc4414"]));
  });
});
