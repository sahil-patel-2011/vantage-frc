import { describe, expect, it } from "vitest";
import {
  confidenceAdjustmentsForResolution,
  confidenceWeight,
  conflictCountByTeam,
  coverageState,
  crossValidateScoutPayload,
  epaDrift,
  fatigueAwareAssignments,
  fieldConfidenceHint,
  lintSchemaBudget,
  lintPitClaimedScoring,
  rankScoutsByAccuracy,
  observationsForStrategyTrust,
  officialValueForTeam,
  rankScoutsForStrategySeats,
  selectPickInfluencingEntries,
  stripContradictedFields,
  summarizeFieldTrust,
  valuesAgree,
} from "../src/trust";

describe("scouting trust", () => {
  it("warns when forms exceed the collection budget", () => {
    const fields = Array.from({ length: 26 }, (_, index) => ({ key: `f${index}`, label: `F${index}`, type: "number" as const }));
    expect(lintSchemaBudget({ title: "Heavy", fields }).status).toBe("over_budget");
  });

  it("flags pit questions that ask claimed scoring instead of observable facts", () => {
    expect(
      lintPitClaimedScoring({
        title: "Pit",
        fields: [
          { key: "drivetrain_type", label: "Drivetrain", type: "drivetrain_type" },
          { key: "fuel_capacity", label: "Fuel capacity (claimed)", type: "number" },
        ],
      }).status,
    ).toBe("claimed_scoring");
    expect(
      lintPitClaimedScoring({
        title: "Pit",
        fields: [
          { key: "drivetrain_type", label: "Drivetrain", type: "drivetrain_type" },
          { key: "programming_language", label: "Programming language", type: "select" },
        ],
      }).status,
    ).toBe("ok");
  });


  it("ranks scouts by TBA accuracy, not entry volume", () => {
    const ranked = rankScoutsByAccuracy([
      { userId: "volume", name: "Volume", entries: 40, checks: 10, matches: 4, conflicts: 6 },
      { userId: "accurate", name: "Accurate", entries: 8, checks: 8, matches: 7, conflicts: 1 },
      { userId: "untested", name: "Untested", entries: 12, checks: 0, matches: 0, conflicts: 0 },
    ]);
    expect(ranked.map((row) => row.userId)).toEqual(["accurate", "volume", "untested"]);
    expect(ranked[0]?.accuracy).toBeCloseTo(0.875);
  });

  it("surfaces disagreement hints once a field has enough history", () => {
    expect(fieldConfidenceHint({
      fieldKey: "climb", checks: 2, matches: 1, conflicts: 1, disagreementRate: 0.5, confidenceScore: 0.5,
    })).toBeNull();
    expect(fieldConfidenceHint({
      fieldKey: "climb", checks: 10, matches: 7, conflicts: 3, disagreementRate: 0.3, confidenceScore: 0.7,
    })).toMatch(/30% disagreement/);
  });

  it("summarizes comparable validation history", () => {
    expect(
      summarizeFieldTrust([
        { fieldKey: "climb", status: "match" },
        { fieldKey: "climb", status: "conflict" },
      ])[0],
    ).toMatchObject({ checks: 2, disagreementRate: 0.5, confidenceScore: 0.5 });
  });

  it("extracts indexed TBA team values", () => {
    expect(
      officialValueForTeam({
        fieldKey: "climb",
        teamKey: "frc2",
        redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] },
        blueAlliance: { teamKeys: [] },
        scoreBreakdown: { red: { endGameRobot2: "High" } },
      }),
    ).toEqual({ value: "High", officialKey: "endGameRobot2" });
    expect(valuesAgree("high", "High")).toBe(true);
  });

  it("flags climb mobility and foul contradictions live", () => {
    const flags = crossValidateScoutPayload({
      payload: { climb: "none", mobility: true, fouls: 0 },
      fieldKeys: ["climb", "mobility", "fouls", "notes"],
      teamKey: "frc2",
      redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] },
      blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
      scoreBreakdown: {
        red: {
          endGameRobot2: "DeepCage",
          autoLineRobot2: "Yes",
          foulCount: 3,
        },
      },
      epaEndgame: 10,
    });
    expect(flags.find((flag) => flag.fieldKey === "climb" && flag.officialSource === "tba")?.status).toBe("conflict");
    expect(flags.find((flag) => flag.fieldKey === "mobility")?.status).toBe("match");
    expect(flags.find((flag) => flag.fieldKey === "fouls")?.status).toBe("conflict");
    expect(flags.some((flag) => flag.soft && flag.officialSource === "statbotics")).toBe(true);
    expect(flags.some((flag) => flag.fieldKey === "notes")).toBe(false);
  });

  it("marks unavailable when official results are not cached yet", () => {
    const flags = crossValidateScoutPayload({
      payload: { climb: "high" },
      fieldKeys: ["climb"],
      teamKey: "frc1",
      redAlliance: { teamKeys: ["frc1"] },
      blueAlliance: { teamKeys: [] },
      scoreBreakdown: null,
    });
    expect(flags[0]).toMatchObject({ status: "unavailable", officialSource: "tba" });
  });

  it("labels coverage and recent EPA drift", () => {
    expect(coverageState({ matchKey: "qm1", teamKey: "frc1", assignmentCount: 0, entryCount: 0 })).toBe("missing");
    expect(epaDrift({ seasonEpa: 60, recentScores: [78, 82, 80] })?.divergent).toBe(true);
  });

  it("caps consecutive load and reports mathematical undercoverage", () => {
    const result = fatigueAwareAssignments({
      scouts: ["a", "b"],
      matches: [{ matchKey: "qm1", teamKeys: ["frc1", "frc2", "frc3"] }],
      maximumConsecutiveMatches: 2,
    });
    expect(result.assignments).toHaveLength(2);
    expect(result.underCovered).toEqual(["qm1"]);
  });

  it("promotes the winning disagreement entry and down-weights losers", () => {
    expect(
      confidenceAdjustmentsForResolution({
        entryIds: ["a", "b", "c"],
        winningEntryId: "b",
        status: "resolved",
      }),
    ).toEqual([
      { entryId: "a", confidence: "low", reason: "losing_resolution" },
      { entryId: "b", confidence: "high", reason: "winning_resolution" },
      { entryId: "c", confidence: "low", reason: "losing_resolution" },
    ]);
    expect(
      confidenceAdjustmentsForResolution({
        entryIds: ["a", "b"],
        winningEntryId: "a",
        status: "dismissed",
      }),
    ).toEqual([]);
    expect(confidenceWeight("high")).toBe(1);
    expect(confidenceWeight("low")).toBe(0.35);
  });

  it("keeps low-confidence rows only when nothing else remains for strategy trust", () => {
    const mixed = [
      { confidence: "low" as const, id: 1 },
      { confidence: "normal" as const, id: 2 },
      { confidence: "high" as const, id: 3 },
    ];
    expect(observationsForStrategyTrust(mixed).map((row) => row.id)).toEqual([2, 3]);
    expect(observationsForStrategyTrust([{ confidence: "low" as const, id: 9 }])).toHaveLength(1);
  });

  it("attributes high-confidence scout rows that informed a pick", () => {
    const attributed = selectPickInfluencingEntries({
      listName: "Alliance picks",
      pickTeams: [{ teamKey: "frc254", rank: 1, tier: "first" }],
      entries: [
        { id: "low", teamKey: "frc254", scoutUserId: "u0", confidence: "low", updatedAt: "2026-03-01T12:00:00Z" },
        { id: "a", teamKey: "frc254", scoutUserId: "u1", confidence: "normal", updatedAt: "2026-03-01T12:00:00Z" },
        { id: "b", teamKey: "frc254", scoutUserId: "u2", confidence: "high", updatedAt: "2026-03-01T11:00:00Z" },
        { id: "c", teamKey: "frc111", scoutUserId: "u3", confidence: "high", updatedAt: "2026-03-01T13:00:00Z" },
      ],
      maxPerTeam: 2,
    });
    expect(attributed.map((row) => row.entryId)).toEqual(["b", "a"]);
    expect(attributed[0]?.reason).toContain("first pick #1");
  });

  it("seats scouts by accuracy not volume", () => {
    const seats = rankScoutsForStrategySeats({
      seatCount: 2,
      scouts: [
        { userId: "volume", checks: 2, matches: 1, entries: 40 },
        { userId: "accurate", checks: 10, matches: 9, entries: 12 },
        { userId: "perfect", checks: 4, matches: 4, entries: 4 },
      ],
    });
    expect(seats.map((seat) => seat.userId)).toEqual(["perfect", "accurate"]);
    expect(seats[0]?.accuracy).toBe(1);
  });

  it("strips TBA-contradicted fields so strategy never trusts them blindly", () => {
    const result = stripContradictedFields(
      { climb: "none", mobility: true, notes: "ok", fouls: 2 },
      [
        { fieldKey: "climb", status: "conflict" },
        { fieldKey: "mobility", status: "match" },
        { fieldKey: "fouls", status: "unavailable" },
      ],
    );
    expect(result.excludedFields).toEqual(["climb"]);
    expect(result.trustedPayload).toEqual({ mobility: true, notes: "ok", fouls: 2 });
    expect(
      conflictCountByTeam([
        { teamKey: "frc254", fieldKey: "climb", status: "conflict" },
        { teamKey: "frc254", fieldKey: "mobility", status: "conflict" },
      ]).get("frc254"),
    ).toEqual({ conflictCount: 2, conflictFields: ["climb", "mobility"] });
  });
});
