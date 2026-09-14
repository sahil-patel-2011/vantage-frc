import { describe, expect, it } from "vitest";
import {
  crossValidateScoutPayload,
  fieldConfidenceHint,
  rankScoutsForStrategySeats,
} from "../src/trust";

const JARGON = /\b(TBA|EPA|Statbotics|score_breakdown)\b/;

describe("generated student-facing scouting trust copy", () => {
  it("field hints compare against official results", () => {
    const hint = fieldConfidenceHint({
      fieldKey: "climb",
      checks: 10,
      matches: 7,
      conflicts: 3,
      disagreementRate: 0.3,
      confidenceScore: 0.7,
    });
    expect(hint).toMatch(/30% disagreement vs official results/);
    expect(hint).not.toMatch(JARGON);
  });

  it("live official checks stay student-readable when cache is empty", () => {
    const flags = crossValidateScoutPayload({
      payload: { climb: "high" },
      fieldKeys: ["climb"],
      teamKey: "frc1",
      redAlliance: { teamKeys: ["frc1"] },
      blueAlliance: { teamKeys: [] },
      scoreBreakdown: null,
    });
    expect(flags[0]?.officialSource).toBe("tba");
    expect(flags[0]?.detail).toMatch(/Official score breakdown/);
    expect(flags[0]?.detail).not.toMatch(JARGON);
  });

  it("live official checks name the official field, not a cache table", () => {
    const flags = crossValidateScoutPayload({
      payload: { climb: "none" },
      fieldKeys: ["climb"],
      teamKey: "frc2",
      redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] },
      blueAlliance: { teamKeys: [] },
      scoreBreakdown: { red: { endGameRobot2: "DeepCage" } },
    });
    const climb = flags.find((flag) => flag.fieldKey === "climb");
    expect(climb?.detail).toMatch(/official endGameRobot2/);
    expect(climb?.detail).not.toMatch(JARGON);
  });

  it("strategy seats cite official results", () => {
    const seats = rankScoutsForStrategySeats({
      seatCount: 1,
      scouts: [{ userId: "accurate", checks: 10, matches: 9, entries: 12 }],
    });
    expect(seats[0]?.reason).toMatch(/vs official results/);
    expect(seats[0]?.reason).not.toMatch(JARGON);
  });
});
