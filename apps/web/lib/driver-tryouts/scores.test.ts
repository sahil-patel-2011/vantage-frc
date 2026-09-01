import { describe, expect, it } from "vitest";
import { averageLoggedScores, parseLoggedRubricScores, parseRubricScore } from "./scores";
import type { DriverTryoutsEvaluation } from "./types";

function evaluation(
  overrides: Partial<DriverTryoutsEvaluation> = {},
): DriverTryoutsEvaluation {
  return {
    id: "e1",
    candidateId: "c1",
    evaluatorId: "u1",
    evaluatedOn: "2026-02-01",
    scorePrecision: 4,
    scoreAwareness: 4,
    scoreCommunication: 4,
    scoreComposure: 4,
    scoreMechanical: 4,
    notes: null,
    ...overrides,
  };
}

describe("parseRubricScore", () => {
  it("accepts integers 1 through 5 only", () => {
    expect(parseRubricScore(1)).toBe(1);
    expect(parseRubricScore(5)).toBe(5);
    expect(parseRubricScore("3")).toBe(3);
  });

  it("refuses missing, non-integer, and out-of-range values instead of inventing 0 or 1", () => {
    expect(parseRubricScore(undefined)).toBeNull();
    expect(parseRubricScore(null)).toBeNull();
    expect(parseRubricScore("")).toBeNull();
    expect(parseRubricScore(" ")).toBeNull();
    expect(parseRubricScore("precision")).toBeNull();
    expect(parseRubricScore(0)).toBeNull();
    expect(parseRubricScore(6)).toBeNull();
    expect(parseRubricScore(3.4)).toBeNull();
    expect(parseRubricScore(NaN)).toBeNull();
  });
});

describe("parseLoggedRubricScores", () => {
  it("requires every criterion to be a logged 1–5 score", () => {
    expect(
      parseLoggedRubricScores({
        scorePrecision: 5,
        scoreAwareness: 4,
        scoreCommunication: 3,
        scoreComposure: 2,
        scoreMechanical: 1,
      }),
    ).toEqual({
      precision: 5,
      awareness: 4,
      communication: 3,
      composure: 2,
      mechanical: 1,
    });
  });

  it("returns null when any criterion was not logged", () => {
    expect(
      parseLoggedRubricScores({
        scorePrecision: 5,
        scoreAwareness: 4,
        scoreCommunication: undefined,
        scoreComposure: 2,
        scoreMechanical: 1,
      }),
    ).toBeNull();
  });
});

describe("averageLoggedScores", () => {
  it("returns null when nothing has been scored — never a zero average", () => {
    expect(averageLoggedScores([])).toBeNull();
    expect(averageLoggedScores([evaluation({ scorePrecision: 0 })])).toBeNull();
  });

  it("averages only evaluations with a full logged rubric", () => {
    const rolled = averageLoggedScores([
      evaluation({
        id: "high",
        scorePrecision: 5,
        scoreAwareness: 5,
        scoreCommunication: 5,
        scoreComposure: 5,
        scoreMechanical: 5,
      }),
      evaluation({
        id: "mid",
        scorePrecision: 3,
        scoreAwareness: 3,
        scoreCommunication: 3,
        scoreComposure: 3,
        scoreMechanical: 3,
      }),
      evaluation({ id: "junk", scorePrecision: 0, scoreAwareness: 9 }),
    ]);
    expect(rolled).toEqual({
      averages: {
        precision: 4,
        awareness: 4,
        communication: 4,
        composure: 4,
        mechanical: 4,
      },
      overallAverage: 4,
      loggedCount: 2,
    });
  });
});
