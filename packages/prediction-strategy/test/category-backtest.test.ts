import { describe, expect, it } from "vitest";
import { load2026FixtureFile, replayMatchesFromFixture, type FixtureScore } from "./replay-fixtures";
import {
  HOLDOUT_EVENT_KEYS,
  SHIPPED_CATEGORY_MODEL,
  TUNING_EVENT_KEYS,
  chooseCategoryModel,
  forecastMatch,
  isMatchForecastSkip,
  metricsOf,
  replayHoldout,
  replaySplit,
  replayTuning,
  type CategorySample,
  type CutMetrics,
  type ModelSpec,
  type ReplayMatch,
} from "../src/walk-forward";

const file = load2026FixtureFile();
const matches = replayMatchesFromFixture(file);

function expectCut(actual: CutMetrics, expected: Partial<CutMetrics> & { mae: CutMetrics["mae"]; rmse?: CutMetrics["rmse"] }) {
  expect(actual.matches).toBe(expected.matches);
  expect(actual.decided).toBe(expected.decided);
  expect(actual.picks).toBe(expected.picks);
  expect(actual.mae).toEqual(expected.mae);
  if (expected.rmse) expect(actual.rmse).toEqual(expected.rmse);
  expect(actual.winnerAccuracy).toBe(expected.winnerAccuracy);
  expect(actual.brier).toBe(expected.brier);
  expect(actual.logLoss).toBe(expected.logLoss);
}

function blank(partial: Pick<ModelSpec, "id" | "kind"> & Partial<ModelSpec>): ModelSpec {
  return {
    decay: 1,
    ridge: 0.5,
    priorK: 0,
    epaPrior: 4,
    foul: "component",
    epaPriorK: 0,
    epaFoul: "component",
    winShare: 0.3,
    ensembleWeight: 1,
    relativeError: null,
    ...partial,
  };
}

function samplesOf(match: ReplayMatch): CategorySample[] {
  const side = (teams: string[], score: ReplayMatch["redScore"]): CategorySample => ({
    teams,
    auto: score.auto,
    teleop: score.teleop,
    endgame: score.endgame,
    foul: score.foul,
    total: score.total,
    order: match.order,
    matchKey: match.key,
  });
  return [side(match.red, match.redScore), side(match.blue, match.blueScore)];
}

describe("2026 played-match fixture", () => {
  it("is the public record fetched on 2026-10-26, with pieces that add up", () => {
    expect(file.fetched).toBe("2026-10-26");
    expect(file.identityMisses).toBe(0);
    expect(file.matchCount).toBe(1209);
    expect(matches).toHaveLength(1209);
    const counts: Record<string, number> = {};
    let ties = 0;
    for (const raw of file.matches) {
      counts[raw.event] = (counts[raw.event] ?? 0) + 1;
      if (raw.redScore.total === raw.blueScore.total) ties += 1;
      for (const score of [raw.redScore, raw.blueScore] as FixtureScore[]) {
        expect(score.auto + score.teleop + score.endgame + score.foul + score.adjust).toBe(score.total);
        expect(score.teleop + score.endgame).toBe(score.teleopTotal);
      }
    }
    expect(ties).toBe(2);
    expect(counts).toEqual({
      "2026gagr": 74,
      "2026arc": 141,
      "2026cur": 139,
      "2026dal": 140,
      "2026gal": 140,
      "2026hop": 140,
      "2026joh": 140,
      "2026mil": 139,
      "2026new": 140,
      "2026cmptx": 16,
    });
  });
});

describe("walk-forward leakage", () => {
  const spec = SHIPPED_CATEGORY_MODEL;

  it("does not use a match's own score", () => {
    const tuning = new Set<string>(TUNING_EVENT_KEYS);
    const original = replaySplit(matches, spec, tuning, tuning);
    const target = original.find((row) => row.event === "2026arc" && row.cut === "mid");
    expect(target).toBeTruthy();
    const bumped = matches.map((match) =>
      match.key === target!.key
        ? {
            ...match,
            redScore: {
              ...match.redScore,
              auto: (match.redScore.auto ?? 0) + 80,
              total: match.redScore.total + 80,
            },
          }
        : match,
    );
    const again = replaySplit(bumped, spec, tuning, tuning).find((row) => row.key === target!.key);
    expect(again?.red.total).toBe(target!.red.total);
    expect(again?.pRed).toBe(target!.pRed);
  });

  it("does not let a parallel division or a later offseason change a division's predictions", () => {
    const hop = matches.filter((match) => match.event === "2026hop" || match.event === "2026arc" || match.event === "2026gagr");
    const hopOnly = matches.filter((match) => match.event === "2026hop");
    const withOthers = replaySplit(hop, spec, new Set(["2026hop"]), new Set(["2026hop", "2026arc", "2026gagr"]));
    const alone = replaySplit(hopOnly, spec, new Set(["2026hop"]), new Set(["2026hop"]));
    expect(withOthers.map((row) => row.pRed)).toEqual(alone.map((row) => row.pRed));
    expect(withOthers.map((row) => row.red.total)).toEqual(alone.map((row) => row.red.total));
  });
});

describe("shipped category model", () => {
  const tuning = metricsOf(replayTuning(matches, SHIPPED_CATEGORY_MODEL));
  const holdout = metricsOf(replayHoldout(matches, SHIPPED_CATEGORY_MODEL));

  it("was chosen on the tuning events only, with the ± taken from the holdout afterwards", () => {
    expect(SHIPPED_CATEGORY_MODEL).toMatchObject({
      id: "component-opr-d1-r2-k0-mean-ek0-mean-e4-w1-s0.2",
      kind: "component-opr",
      decay: 1,
      ridge: 2,
      priorK: 0,
      foul: "mean",
      winShare: 0.2,
      ensembleWeight: 1,
      relativeError: 0.212,
    });
    expect([...TUNING_EVENT_KEYS]).toEqual(["2026gagr", "2026arc", "2026cur", "2026dal", "2026gal"]);
    expect([...HOLDOUT_EVENT_KEYS]).toEqual(["2026hop", "2026joh", "2026mil", "2026new", "2026cmptx"]);
  });

  it("locks tuning and holdout error, winners, and calibration", () => {
    expectCut(tuning.byCut.all, {
      matches: 629,
      decided: 627,
      picks: 577,
      mae: { auto: 22.81, teleop: 80.1, endgame: 1.09, foul: 8.73, total: 89.44 },
      rmse: { auto: 28.74, teleop: 101.99, endgame: 2.53, foul: 13.84, total: 115.06 },
      winnerAccuracy: 0.752,
      brier: 0.173,
      logLoss: 0.516,
    });
    expect(tuning.byCut.early.matches).toBe(183);
    expect(tuning.byCut.early.mae).toEqual({ auto: 24.99, teleop: 95.29, endgame: 0.79, foul: 7.81, total: 108.74 });
    expect(tuning.byCut.early.winnerAccuracy).toBe(0.695);
    expect(tuning.byCut.early.brier).toBe(0.208);
    expect(tuning.byCut.early.logLoss).toBe(0.597);
    expect(tuning.byCut.mid.mae.total).toBe(86.35);
    expect(tuning.byCut.mid.winnerAccuracy).toBe(0.759);
    expect(tuning.byCut.late.mae.total).toBe(78.04);
    expect(tuning.byCut.late.winnerAccuracy).toBe(0.776);
    expect(tuning.calibration).toEqual([
      { label: "0–20%", n: 95, predicted: 0.106, actual: 0.084 },
      { label: "20–40%", n: 105, predicted: 0.3, actual: 0.371 },
      { label: "40–60%", n: 183, predicted: 0.507, actual: 0.508 },
      { label: "60–80%", n: 123, predicted: 0.702, actual: 0.732 },
      { label: "80–100%", n: 121, predicted: 0.897, actual: 0.934 },
    ]);

    expectCut(holdout.byCut.all, {
      matches: 570,
      decided: 570,
      picks: 523,
      mae: { auto: 24.52, teleop: 85.26, endgame: 1.28, foul: 8.27, total: 94.53 },
      rmse: { auto: 30.84, teleop: 106.59, endgame: 2.85, foul: 11.64, total: 118.48 },
      winnerAccuracy: 0.715,
      brier: 0.188,
      logLoss: 0.552,
    });
    expect(holdout.byCut.early.mae.total).toBe(110.14);
    expect(holdout.byCut.early.winnerAccuracy).toBe(0.758);
    expect(holdout.byCut.mid.mae.total).toBe(88.47);
    expect(holdout.byCut.mid.winnerAccuracy).toBe(0.693);
    expect(holdout.byCut.late.mae.total).toBe(88.05);
    expect(holdout.byCut.late.winnerAccuracy).toBe(0.709);
    expect(holdout.calibration).toEqual([
      { label: "0–20%", n: 68, predicted: 0.113, actual: 0.162 },
      { label: "20–40%", n: 113, predicted: 0.304, actual: 0.257 },
      { label: "40–60%", n: 167, predicted: 0.501, actual: 0.539 },
      { label: "60–80%", n: 140, predicted: 0.698, actual: 0.664 },
      { label: "80–100%", n: 82, predicted: 0.89, actual: 0.915 },
    ]);
  });

  it("beats the current card, plain OPR, untuned components, EPA, and a coin flip on tuning total error", () => {
    const rows: Array<{ id: string; spec: ModelSpec; tuning: Partial<CutMetrics>; holdout: Partial<CutMetrics> }> = [
      {
        id: "mean",
        spec: blank({ id: "mean", kind: "mean" }),
        tuning: { matches: 630, mae: { auto: 32.35, teleop: 114.16, endgame: 0.94, foul: 8.89, total: 137.5 }, winnerAccuracy: null, brier: 0.25, logLoss: 0.693, picks: 0, decided: 628 },
        holdout: { matches: 571, mae: { auto: 30.73, teleop: 102.77, endgame: 1.27, foul: 8.27, total: 121.76 }, winnerAccuracy: null, brier: 0.25, logLoss: 0.693, picks: 0, decided: 571 },
      },
      {
        id: "vantage",
        spec: blank({ id: "vantage", kind: "vantage" }),
        tuning: { matches: 629, mae: { auto: null, teleop: null, endgame: null, foul: null, total: 92.38 }, winnerAccuracy: 0.752, brier: 0.178, logLoss: 0.53, picks: 577, decided: 627 },
        holdout: { matches: 570, mae: { auto: null, teleop: null, endgame: null, foul: null, total: 99.14 }, winnerAccuracy: 0.707, brier: 0.19, logLoss: 0.558, picks: 523, decided: 570 },
      },
      {
        id: "plain-opr",
        spec: blank({ id: "plain-opr", kind: "plain-opr", ridge: 0.001 }),
        tuning: { matches: 629, mae: { auto: null, teleop: null, endgame: null, foul: null, total: 116.93 }, winnerAccuracy: 0.729, brier: 0.195, logLoss: 0.59, picks: 576, decided: 627 },
        holdout: { matches: 570, mae: { auto: null, teleop: null, endgame: null, foul: null, total: 126.71 }, winnerAccuracy: 0.686, brier: 0.211, logLoss: 0.635, picks: 523, decided: 570 },
      },
      {
        id: "component-opr-default",
        spec: blank({ id: "component-opr-default", kind: "component-opr" }),
        tuning: { matches: 629, mae: { auto: 23.38, teleop: 83.79, endgame: 1.38, foul: 10.9, total: 92.56 }, winnerAccuracy: 0.75, brier: 0.177, logLoss: 0.528, picks: 577, decided: 627 },
        holdout: { matches: 570, mae: { auto: 25.8, teleop: 90.09, endgame: 1.56, foul: 10.47, total: 98.44 }, winnerAccuracy: 0.709, brier: 0.188, logLoss: 0.552, picks: 523, decided: 570 },
      },
      {
        id: "epa-default",
        spec: blank({ id: "epa-default", kind: "epa", ensembleWeight: 0 }),
        tuning: { matches: 629, mae: { auto: 22.94, teleop: 81.46, endgame: 0.97, foul: 9.34, total: 92.01 }, winnerAccuracy: 0.74, brier: 0.183, logLoss: 0.545, picks: 577, decided: 627 },
        holdout: { matches: 570, mae: { auto: 24.55, teleop: 85.4, endgame: 1.2, foul: 8.92, total: 95.25 }, winnerAccuracy: 0.717, brier: 0.194, logLoss: 0.57, picks: 523, decided: 570 },
      },
    ];
    for (const row of rows) {
      const tuned = metricsOf(replayTuning(matches, row.spec)).byCut.all;
      const held = metricsOf(replayHoldout(matches, row.spec)).byCut.all;
      expect(tuned.mae).toEqual(row.tuning.mae);
      expect(tuned.winnerAccuracy).toBe(row.tuning.winnerAccuracy);
      expect(tuned.brier).toBe(row.tuning.brier);
      expect(tuned.logLoss).toBe(row.tuning.logLoss);
      expect(tuned.matches).toBe(row.tuning.matches);
      expect(tuned.picks).toBe(row.tuning.picks);
      expect(tuned.decided).toBe(row.tuning.decided);
      expect(held.mae).toEqual(row.holdout.mae);
      expect(held.winnerAccuracy).toBe(row.holdout.winnerAccuracy);
      expect(held.brier).toBe(row.holdout.brier);
      expect(held.logLoss).toBe(row.holdout.logLoss);
      expect(held.matches).toBe(row.holdout.matches);
      expect(held.picks).toBe(row.holdout.picks);
      expect(held.decided).toBe(row.holdout.decided);
    }
    expect(tuning.byCut.all.mae.total!).toBeLessThan(92.38);
    expect(holdout.byCut.all.mae.total!).toBeLessThan(99.14);
  });

  it("still selects this spec from the tuning set alone", () => {
    const choice = chooseCategoryModel(matches);
    expect(choice.spec.id).toBe(SHIPPED_CATEGORY_MODEL.id);
    expect(choice.spec.relativeError).toBeNull();
    expect(choice.spec.winShare).toBe(0.2);
    expect(choice.tuning.byCut.all.mae.total).toBe(89.44);
    const ensemble = choice.candidates.find((candidate) => candidate.role === "ensemble");
    const epa = choice.candidates.find((candidate) => candidate.role === "epa");
    expect(ensemble?.tuning.byCut.all.mae.total).toBe(89.57);
    expect(epa?.spec.epaPrior).toBe(2);
    expect(epa?.tuning.byCut.all.mae.total).toBe(91.75);
  }, 60_000);

  it("forecasts a later GRITS match from earlier matches in that event", () => {
    const gagr = matches.filter((match) => match.event === "2026gagr");
    const upcoming = gagr[12];
    expect(upcoming).toBeTruthy();
    const played = gagr.slice(0, 12).flatMap(samplesOf);
    const forecast = forecastMatch({ season: 2026, red: upcoming!.red, blue: upcoming!.blue, played });
    expect(isMatchForecastSkip(forecast)).toBe(false);
    if (isMatchForecastSkip(forecast)) return;
    expect(forecast.categoriesKnown).toBe(true);
    expect(forecast.modelId).toBe(SHIPPED_CATEGORY_MODEL.id);
    expect(forecast.red.auto).not.toBeNull();
    expect(forecast.red.total).toBeGreaterThan(0);
    expect(forecast.errorBand).not.toBeNull();
    expect(forecast.confidence).toMatch(/Typical miss/);
  });
});
