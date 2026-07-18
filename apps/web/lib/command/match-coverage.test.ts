import { describe, expect, it } from "vitest";
import {
  buildCoverageBoard,
  coverageGapFingerprint,
  coverageGapMessage,
  summarizeCoverageBoard,
} from "./match-coverage";

describe("event day match coverage", () => {
  it("summarizes missing vs double-covered rows and fingerprints gaps", () => {
    const board = buildCoverageBoard({
      matches: [{ matchKey: "2026ny_qm12", matchNumber: 12, compLevel: "qm", teamKeys: ["frc1", "frc2"] }],
      assignmentCounts: { "2026ny_qm12|frc2": 1 },
      entryCounts: { "2026ny_qm12|frc2": 2 },
    });
    expect(summarizeCoverageBoard(board)).toEqual({
      missing: 1,
      assigned: 0,
      covered: 0,
      doubleCovered: 1,
      total: 2,
    });
    expect(coverageGapFingerprint(board)).toBe("2026ny_qm12:frc1");
    expect(
      coverageGapMessage({
        eventKey: "2026ny",
        missing: 1,
        sample: board.filter((cell) => cell.state === "missing"),
      }),
    ).toContain("QM 12 · 1");
  });
});
