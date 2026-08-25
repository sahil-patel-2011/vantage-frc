import { describe, expect, it } from "vitest";
import {
  REVIEW_DELTA_PCT,
  allianceTeamKeys,
  distributeByShare,
  officialAllianceFoulPoints,
  officialAllianceTotal,
  reconcileEvent,
  reconcileMatch,
  robotEstimate,
  robotEstimateFromPayload,
  type ReconcileEntry,
  type ReconcileMatchRow,
} from "./reconcile";

const match = (
  overrides: Partial<ReconcileMatchRow> = {},
): ReconcileMatchRow => ({
  matchKey: "2025test_qm1",
  matchNumber: 1,
  compLevel: "qm",
  redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] },
  blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
  scoreBreakdown: { red: { totalPoints: 100 }, blue: { totalPoints: 80 } },
  ...overrides,
});

const entry = (
  teamKey: string,
  payload: Record<string, unknown>,
  suffix = "a",
): ReconcileEntry => ({
  entryId: `${teamKey}-${suffix}`,
  matchKey: "2025test_qm1",
  teamKey,
  payload,
});

describe("allianceTeamKeys / officialAllianceTotal", () => {
  it("reads both the worker shape and TBA's raw shape", () => {
    expect(allianceTeamKeys({ teamKeys: ["frc1"] })).toEqual(["frc1"]);
    expect(allianceTeamKeys({ team_keys: ["frc2"] })).toEqual(["frc2"]);
    expect(allianceTeamKeys(["frc3"])).toEqual(["frc3"]);
    expect(allianceTeamKeys(null)).toEqual([]);
  });

  it("returns null rather than zero when the breakdown is absent", () => {
    expect(officialAllianceTotal(null, "red")).toBeNull();
    expect(officialAllianceTotal({ red: {} }, "red")).toBeNull();
    expect(officialAllianceTotal({ red: { totalPoints: 42 } }, "red")).toBe(42);
    expect(officialAllianceTotal({ red: { total_points: "42" } }, "red")).toBe(42);
  });

  it("reads foul points, and stays null for a game that has no foul field", () => {
    expect(officialAllianceFoulPoints({ red: { totalPoints: 42, foulPoints: 6 } }, "red")).toBe(6);
    expect(officialAllianceFoulPoints({ red: { total_points: 42, foul_points: 4 } }, "red")).toBe(4);
    expect(officialAllianceFoulPoints({ red: { totalPoints: 42 } }, "red")).toBeNull();
    expect(officialAllianceFoulPoints(null, "red")).toBeNull();
  });
});

describe("foul points", () => {
  const scoutedFifty = [
    entry("frc1", { totalPoints: 20 }),
    entry("frc2", { totalPoints: 20 }),
    entry("frc3", { totalPoints: 10 }),
  ];

  it("compares against the robot-scored total, not the foul-inflated official total", () => {
    // 100 official = 50 scored by the robots + 50 handed over on blue's fouls.
    // Our scouts summed 50, which is EXACTLY right and must not read as -50%.
    const result = reconcileMatch(
      match({ scoreBreakdown: { red: { totalPoints: 100, foulPoints: 50 }, blue: {} } }),
      scoutedFifty,
    );
    expect(result.red.officialTotal).toBe(100);
    expect(result.red.officialFoulPoints).toBe(50);
    expect(result.red.officialScoringTotal).toBe(50);
    expect(result.red.delta).toBe(0);
    expect(result.red.deltaPct).toBe(0);
    expect(result.red.flag).toBe("ok");
    expect(result.red.message).toContain("100 official less 50 foul");
  });

  it("falls back to the official total for a game whose breakdown has no foul field", () => {
    const result = reconcileMatch(
      match({ scoreBreakdown: { red: { totalPoints: 50 }, blue: {} } }),
      scoutedFifty,
    );
    expect(result.red.officialFoulPoints).toBeNull();
    expect(result.red.officialScoringTotal).toBe(50);
    expect(result.red.deltaPct).toBe(0);
    expect(result.red.message).not.toContain("foul");
  });

  it("still flags a real gap once fouls are removed", () => {
    // 100 official - 10 foul = 90 scored; scouts summed 50 → 44% under.
    const result = reconcileMatch(
      match({ scoreBreakdown: { red: { totalPoints: 100, foulPoints: 10 }, blue: {} } }),
      scoutedFifty,
    );
    expect(result.red.officialScoringTotal).toBe(90);
    expect(result.red.flag).toBe("review");
    expect(result.red.deltaPct).toBeCloseTo((50 - 90) / 90, 10);
  });
});

describe("robotEstimateFromPayload", () => {
  it("prefers an explicit total-points answer", () => {
    expect(robotEstimateFromPayload({ totalPoints: 30, autoScore: 5 })).toEqual({
      points: 30,
      basis: "total",
      fields: ["totalPoints"],
    });
  });

  it("sums the numeric answers whose inferred role scores points", () => {
    const result = robotEstimateFromPayload({
      autoScore: 6,
      teleopScore: 20,
      endgamePoints: 12,
      notes: "great cycles",
      defense: true,
    });
    expect(result?.points).toBe(38);
    expect(result?.basis).toBe("roles");
    expect(result?.fields).toEqual(["autoScore", "teleopScore", "endgamePoints"]);
  });

  it("honours an explicit role map over key inference", () => {
    const result = robotEstimateFromPayload(
      { widgets: 7, autoScore: 5 },
      { widgets: "teleop_score", autoScore: "none" },
    );
    expect(result?.points).toBe(7);
    expect(result?.fields).toEqual(["widgets"]);
  });

  it("returns null instead of reading a checkbox-only sheet as zero", () => {
    expect(robotEstimateFromPayload({ climbed: true, notes: "no numbers" })).toBeNull();
    expect(robotEstimateFromPayload(null)).toBeNull();
  });
});

describe("robotEstimate", () => {
  it("takes the median across scouts so one bad sheet cannot swing the total", () => {
    const robot = robotEstimate("frc1", [
      entry("frc1", { totalPoints: 30 }, "a"),
      entry("frc1", { totalPoints: 32 }, "b"),
      entry("frc1", { totalPoints: 300 }, "c"),
    ]);
    expect(robot.estimate).toBe(32);
    expect(robot.scoutCount).toBe(3);
    expect(robot.entryIds).toEqual(["frc1-a", "frc1-b", "frc1-c"]);
  });

  it("stays null with no numeric answer anywhere", () => {
    const robot = robotEstimate("frc1", [entry("frc1", { notes: "sat still" })]);
    expect(robot.estimate).toBeNull();
    expect(robot.basis).toBeNull();
    expect(robot.scoutCount).toBe(0);
  });
});

describe("reconcileMatch", () => {
  it("flags an alliance whose scouted sum is more than 15% off official", () => {
    // Red scouted 100 + 20 + 20 = 140 vs official 100 -> +40%.
    const result = reconcileMatch(match(), [
      entry("frc1", { totalPoints: 100 }),
      entry("frc2", { totalPoints: 20 }),
      entry("frc3", { totalPoints: 20 }),
    ]);
    expect(result.red.ourTotal).toBe(140);
    expect(result.red.officialTotal).toBe(100);
    expect(result.red.delta).toBe(40);
    expect(result.red.deltaPct).toBeCloseTo(0.4, 10);
    expect(result.red.flag).toBe("review");
    expect(result.needsReview).toBe(true);
    expect(result.worstDeltaPct).toBeCloseTo(0.4, 10);
  });

  it("passes an alliance inside the threshold", () => {
    // 35 + 35 + 35 = 105 vs 100 -> +5%.
    const result = reconcileMatch(match(), [
      entry("frc1", { totalPoints: 35 }),
      entry("frc2", { totalPoints: 35 }),
      entry("frc3", { totalPoints: 35 }),
    ]);
    expect(result.red.flag).toBe("ok");
    expect(result.red.deltaPct).toBeCloseTo(0.05, 10);
    expect(result.needsReview).toBe(false);
  });

  it("treats exactly the threshold as review", () => {
    const result = reconcileMatch(match(), [
      entry("frc1", { totalPoints: 55 }),
      entry("frc2", { totalPoints: 30 }),
      entry("frc3", { totalPoints: 30 }),
    ]);
    expect(result.red.deltaPct).toBeCloseTo(REVIEW_DELTA_PCT, 10);
    expect(result.red.flag).toBe("review");
  });

  it("never compares a partially scouted alliance to a full official total", () => {
    const result = reconcileMatch(match(), [entry("frc1", { totalPoints: 20 })]);
    expect(result.red.flag).toBe("partial");
    expect(result.red.scoutedRobots).toBe(1);
    expect(result.red.message).toContain("2, 3");
    expect(result.needsReview).toBe(false);
    expect(result.worstDeltaPct).toBeNull();
  });

  it("says so when there is no cached score breakdown", () => {
    const result = reconcileMatch(match({ scoreBreakdown: null }), [
      entry("frc1", { totalPoints: 35 }),
      entry("frc2", { totalPoints: 35 }),
      entry("frc3", { totalPoints: 35 }),
    ]);
    expect(result.red.flag).toBe("no_official");
    expect(result.red.officialTotal).toBeNull();
    expect(result.red.deltaPct).toBeNull();
  });

  it("says so when no scout entry carries a number", () => {
    const result = reconcileMatch(match(), [entry("frc1", { notes: "nothing numeric" })]);
    expect(result.red.flag).toBe("no_scouting");
    expect(result.red.ourTotal).toBeNull();
  });

  it("ignores entries belonging to a different match", () => {
    const result = reconcileMatch(match(), [
      { ...entry("frc1", { totalPoints: 35 }), matchKey: "2025test_qm2" },
    ]);
    expect(result.red.flag).toBe("no_scouting");
  });
});

describe("reconcileEvent", () => {
  const fullyScouted = (matchKey: string, matchNumber: number, redTotal: number) => ({
    row: match({ matchKey, matchNumber }),
    entries: ["frc1", "frc2", "frc3"].map((teamKey, index) => ({
      entryId: `${matchKey}-${teamKey}`,
      matchKey,
      teamKey,
      payload: { totalPoints: index === 0 ? redTotal - 40 : 20 },
    })),
  });

  it("sorts flagged matches first, worst gap first, and summarises honestly", () => {
    const clean = fullyScouted("2025test_qm1", 1, 100);
    const bad = fullyScouted("2025test_qm2", 2, 200);
    const report = reconcileEvent({
      matches: [clean.row, bad.row],
      entries: [...clean.entries, ...bad.entries],
    });
    expect(report.matches[0]!.matchKey).toBe("2025test_qm2");
    expect(report.matches[0]!.needsReview).toBe(true);
    expect(report.matches[1]!.needsReview).toBe(false);
    expect(report.summary.matches).toBe(2);
    expect(report.summary.flaggedMatches).toBe(1);
    expect(report.reviewDeltaPct).toBe(REVIEW_DELTA_PCT);
    // Only red is fully scouted in both matches; blue has no entries at all.
    expect(report.summary.comparedAlliances).toBe(2);
    expect(report.summary.meanAbsDeltaPct).toBeCloseTo(0.5, 10);
  });

  it("counts matches with no breakdown and matches with no scouting separately", () => {
    const report = reconcileEvent({
      matches: [
        match({ matchKey: "2025test_qm1", matchNumber: 1, scoreBreakdown: null }),
        match({ matchKey: "2025test_qm2", matchNumber: 2 }),
      ],
      entries: [],
    });
    expect(report.summary.matchesWithoutBreakdown).toBe(1);
    expect(report.summary.matchesWithoutScouting).toBe(1);
    expect(report.summary.meanAbsDeltaPct).toBeNull();
    expect(report.summary.flaggedMatches).toBe(0);
  });

  it("is deterministic across repeated runs", () => {
    const clean = fullyScouted("2025test_qm1", 1, 100);
    const bad = fullyScouted("2025test_qm2", 2, 200);
    const input = { matches: [clean.row, bad.row], entries: [...clean.entries, ...bad.entries] };
    expect(JSON.stringify(reconcileEvent(input))).toBe(JSON.stringify(reconcileEvent(input)));
  });
});

describe("distributeByShare", () => {
  it("splits the official total in proportion to the scouted estimates", () => {
    const result = distributeByShare(120, [
      { teamKey: "frc1", estimate: 30 },
      { teamKey: "frc2", estimate: 20 },
      { teamKey: "frc3", estimate: 10 },
    ]);
    expect(result.status).toBe("distributed");
    if (result.status !== "distributed") return;
    expect(result.robots.map((robot) => robot.points)).toEqual([60, 40, 20]);
    expect(result.robots.reduce((sum, robot) => sum + robot.points, 0)).toBeCloseTo(120, 10);
    expect(result.robots[0]!.share).toBeCloseTo(0.5, 10);
  });

  it("refuses when a robot was never scouted", () => {
    const result = distributeByShare(120, [
      { teamKey: "frc1", estimate: 30 },
      { teamKey: "frc2", estimate: null },
    ]);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toContain("2");
  });

  it("refuses when there is no official total or no share to divide by", () => {
    expect(distributeByShare(null, [{ teamKey: "frc1", estimate: 10 }]).status).toBe("unavailable");
    expect(
      distributeByShare(120, [
        { teamKey: "frc1", estimate: 0 },
        { teamKey: "frc2", estimate: 0 },
      ]).status,
    ).toBe("unavailable");
    expect(distributeByShare(120, []).status).toBe("unavailable");
    expect(distributeByShare(120, [{ teamKey: "frc1", estimate: -5 }]).status).toBe("unavailable");
  });
});
