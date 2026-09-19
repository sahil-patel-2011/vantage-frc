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
    expect(plan.briefing).toMatch(/typical error ±4 \(last measured set\)/);
    expect(plan.pointDeltas[0]).toMatch(/typical error ±4 \(last measured set\)/);
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

describe("the briefing measures a lead against this match, not the model", () => {
  const trio = (prefix: string, over: Record<string, unknown> = {}) =>
    [1, 2, 3].map((n) => ({
      teamKey: `frc${prefix}${n}`,
      autoEpa: 10,
      teleopEpa: 25,
      endgameEpa: 8,
      ...over,
    }));

  const planFor = (redOver: Record<string, unknown>, blueOver: Record<string, unknown>, redMean = 12) => {
    const prediction = predictAllianceScores({
      matchKey: "2026test_qm7",
      red: trio("R", { teleopEpa: 25 + redMean, ...redOver }) as never,
      blue: trio("B", blueOver) as never,
    });
    if (isScorePredictionSkip(prediction)) throw new Error("skipped");
    return { plan: matchPlanFromPrediction(prediction, "red"), prediction };
  };

  it("calls the same lead safe between known robots and shaky between unknown ones", () => {
    // Identical predicted margin; opposite advice, because the robots are not
    // equally predictable. This is the thing a single model-wide ±4 could
    // never say.
    const known = planFor({ matchSd: 2 }, { matchSd: 2 });
    const unknown = planFor({ matchSd: 28 }, { matchSd: 28 });

    expect(known.plan.briefing).toMatch(/play it safe, do not chase/);
    expect(unknown.plan.briefing).toMatch(/anybody's|reliable cycle/);
  });

  it("tells the drive team how often they win this one", () => {
    const { plan } = planFor({ matchSd: 4 }, { matchSd: 4 });
    expect(plan.briefing).toMatch(/You win this about \d+% of the time\./);
  });

  it("says nothing about a side when no bumper colour is set", () => {
    const [row] = fixtureSeasonRows();
    const prediction = predictAllianceScores(row!);
    if (isScorePredictionSkip(prediction)) throw new Error("skipped");
    const plan = matchPlanFromPrediction(prediction, null);
    expect(plan.briefing).toMatch(/Alliance color is not set|Set bumper color/);
    // And no dangling gap where the win-chance sentence would have been.
    expect(plan.briefing).not.toMatch(/ {2}/);
  });
});
