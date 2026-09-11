import { describe, expect, it } from "vitest";
import { fixtureSeasonRows, isScorePredictionSkip, predictAllianceScores } from "../src/calibrated-score";
import { matchPlanFromPrediction } from "../src/match-plan";

describe("match plan from a score prediction", () => {
  it("writes a 20-second briefing with an error band and no made-up side", () => {
    const [row] = fixtureSeasonRows();
    const prediction = predictAllianceScores(row!);
    expect(isScorePredictionSkip(prediction)).toBe(false);
    if (isScorePredictionSkip(prediction)) return;
    const plan = matchPlanFromPrediction(prediction, "red");
    expect(plan.briefing).toMatch(/You are red/);
    expect(plan.briefing).toMatch(/typical error ±90 \(last measured set\)/);
    expect(plan.pointDeltas[0]).toMatch(/typical error ±90 \(last measured set\)/);
    expect(plan.auto.length).toBeGreaterThan(10);
    expect(plan.climb.length).toBeGreaterThan(10);
  });

  it("refuses to pick a defender when no defense flag is on the card", () => {
    const [row] = fixtureSeasonRows();
    const prediction = predictAllianceScores(row!);
    expect(isScorePredictionSkip(prediction)).toBe(false);
    if (isScorePredictionSkip(prediction)) return;
    const plan = matchPlanFromPrediction(prediction, "blue");
    expect(plan.defend).toMatch(/Do not assign a defender|defense/i);
  });
});
