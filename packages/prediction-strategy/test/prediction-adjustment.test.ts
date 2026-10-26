import { describe, expect, it } from "vitest";
import { PREDICTION_AI_ENABLED, applyBoundedAdjustment } from "../src/prediction-adjustment";
import type { CategoryScores as Scores } from "../src/walk-forward";

const side = (auto: number, teleop: number, endgame: number, foul: number): Scores => ({
  auto,
  teleop,
  endgame,
  foul,
  total: auto + teleop + endgame + foul,
});

describe("bounded prediction adjustment", () => {
  const red = side(40, 180, 10, 4);
  const blue = side(30, 160, 0, 4);

  it("is off until a measurement says otherwise", () => {
    expect(PREDICTION_AI_ENABLED).toBe(false);
  });

  it("leaves the statistical forecast alone when no deltas are sent", () => {
    const result = applyBoundedAdjustment({ red, blue, redWinProbability: 0.62 });
    expect(result.applied).toBe(false);
    expect(result.red).toEqual(red);
    expect(result.blue).toEqual(blue);
    expect(result.redWinProbability).toBe(0.62);
  });

  it("clamps a small delta and rebuilds the total from the pieces", () => {
    const result = applyBoundedAdjustment({
      red,
      blue,
      redWinProbability: 0.62,
      redDeltas: { teleop: 2, note: "Climber looked slow." },
      adjustedWinProbability: 0.7,
    });
    expect(result.applied).toBe(true);
    expect(result.red.teleop).toBe(182);
    expect(result.red.total).toBe(236);
    expect(result.redWinProbability).toBe(0.65);
    expect(result.note).toBe("Climber looked slow.");
  });

  it("rejects a delta that is a full score", () => {
    const result = applyBoundedAdjustment({
      red,
      blue,
      redWinProbability: 0.62,
      redDeltas: { teleop: 180 },
      adjustedWinProbability: 0.99,
    });
    expect(result.applied).toBe(false);
    expect(result.red.teleop).toBe(180);
    expect(result.redWinProbability).toBe(0.62);
    expect(result.rejected.join(" ")).toMatch(/full score/);
  });
});
