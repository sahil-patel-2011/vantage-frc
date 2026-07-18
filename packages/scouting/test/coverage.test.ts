import { describe, expect, it } from "vitest";
import {
  buildCoverageGapBoard,
  focusLiveCoverage,
  summarizeCoverageGaps,
  toGapStatus,
} from "../src/coverage";

describe("coverage gap board", () => {
  it("maps double vs unscouted states", () => {
    expect(toGapStatus({ matchKey: "qm1", teamKey: "frc1", assignmentCount: 0, entryCount: 0 })).toBe(
      "unscouted",
    );
    expect(toGapStatus({ matchKey: "qm1", teamKey: "frc1", assignmentCount: 1, entryCount: 0 })).toBe(
      "assigned",
    );
    expect(toGapStatus({ matchKey: "qm1", teamKey: "frc1", assignmentCount: 0, entryCount: 1 })).toBe(
      "covered",
    );
    expect(toGapStatus({ matchKey: "qm1", teamKey: "frc1", assignmentCount: 0, entryCount: 2 })).toBe(
      "double",
    );
  });

  it("summarizes live double vs unscouted rates", () => {
    const board = buildCoverageGapBoard([
      { matchKey: "qm1", teamKey: "frc10", matchNumber: 1, compLevel: "qm", assignmentCount: 0, entryCount: 0 },
      { matchKey: "qm1", teamKey: "frc20", matchNumber: 1, compLevel: "qm", assignmentCount: 1, entryCount: 0 },
      { matchKey: "qm1", teamKey: "frc30", matchNumber: 1, compLevel: "qm", assignmentCount: 0, entryCount: 1 },
      {
        matchKey: "qm1",
        teamKey: "frc40",
        matchNumber: 1,
        compLevel: "qm",
        assignmentCount: 0,
        entryCount: 2,
        scoutNames: ["A", "B"],
      },
    ]);
    const summary = summarizeCoverageGaps(board);
    expect(summary).toMatchObject({
      totalSlots: 4,
      unscouted: 1,
      assignedWaiting: 1,
      covered: 1,
      doubleCovered: 1,
      coverageRate: 0.5,
      doubleRate: 0.25,
    });
    expect(board.find((slot) => slot.status === "double")?.scoutNames).toEqual(["A", "B"]);
  });

  it("focuses the live window and surfaces gaps", () => {
    const board = buildCoverageGapBoard([
      { matchKey: "qm1", teamKey: "frc1", matchNumber: 1, compLevel: "qm", assignmentCount: 0, entryCount: 1 },
      { matchKey: "qm2", teamKey: "frc2", matchNumber: 2, compLevel: "qm", assignmentCount: 0, entryCount: 0 },
      {
        matchKey: "qm2",
        teamKey: "frc3",
        matchNumber: 2,
        compLevel: "qm",
        assignmentCount: 0,
        entryCount: 3,
        scoutNames: ["X", "Y", "Z"],
      },
      { matchKey: "qm3", teamKey: "frc4", matchNumber: 3, compLevel: "qm", assignmentCount: 0, entryCount: 0 },
    ]);
    const live = focusLiveCoverage(board, { matchKey: "qm2", windowSize: 2 });
    expect(live.focusMatchKeys).toEqual(["qm2", "qm3"]);
    expect(live.gapSlots.map((slot) => slot.teamKey)).toEqual(["frc2", "frc4"]);
    expect(live.doubleSlots).toHaveLength(1);
  });
});
