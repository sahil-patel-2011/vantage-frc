/**
 * One-shot tuning print. Not part of the test suite.
 * The holdout is scored only after chooseCategoryModel returns.
 */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import {
  chooseCategoryModel,
  metricsOf,
  replayHoldout,
  replayTuning,
  type ForecastRow,
  type MetricsBundle,
  type ModelSpec,
} from "../src/walk-forward";
import { load2026FixtureFile, replayMatchesFromFixture } from "../test/replay-fixtures";

function blankSpec(partial: Pick<ModelSpec, "id" | "kind"> & Partial<ModelSpec>): ModelSpec {
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

function compact(bundle: MetricsBundle) {
  const cuts: Record<string, unknown> = {};
  for (const name of ["all", "early", "mid", "late"] as const) {
    const row = bundle.byCut[name];
    cuts[name] = {
      matches: row.matches,
      alliances: row.alliances,
      decided: row.decided,
      picks: row.picks,
      mae: row.mae,
      rmse: row.rmse,
      winnerAccuracy: row.winnerAccuracy,
      brier: row.brier,
      logLoss: row.logLoss,
    };
  }
  return { cuts, calibration: bundle.calibration };
}

function meanScoreboard(rows: readonly ForecastRow[]): number {
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    sum += row.actualRed.total + row.actualBlue.total;
    n += 2;
  }
  return n ? sum / n : 0;
}

const file = load2026FixtureFile();
const matches = replayMatchesFromFixture(file);
const counts: Record<string, number> = {};
for (const match of matches) counts[match.event] = (counts[match.event] ?? 0) + 1;

const baselines: ModelSpec[] = [
  blankSpec({ id: "mean", kind: "mean" }),
  blankSpec({ id: "vantage", kind: "vantage" }),
  blankSpec({ id: "plain-opr", kind: "plain-opr", ridge: 0.001 }),
  blankSpec({ id: "component-opr-default", kind: "component-opr" }),
  blankSpec({ id: "epa-default", kind: "epa", ensembleWeight: 0 }),
];

const report: Record<string, unknown> = {
  fetched: file.fetched,
  matchCount: matches.length,
  counts,
  baselines: {} as Record<string, unknown>,
};

const started = performance.now();
const choice = chooseCategoryModel(matches);
report.tuneMs = Math.round(performance.now() - started);
report.choice = {
  spec: choice.spec,
  tuning: compact(choice.tuning),
  candidates: choice.candidates.map((candidate) => ({
    role: candidate.role,
    spec: candidate.spec,
    tuning: compact(candidate.tuning),
  })),
};

for (const spec of baselines) {
  const tuningRows = replayTuning(matches, spec);
  const holdoutRows = replayHoldout(matches, spec);
  (report.baselines as Record<string, unknown>)[spec.id] = {
    tuning: compact(metricsOf(tuningRows)),
    holdout: compact(metricsOf(holdoutRows)),
    tuningMean: Math.round(meanScoreboard(tuningRows) * 100) / 100,
    holdoutMean: Math.round(meanScoreboard(holdoutRows) * 100) / 100,
  };
}

const holdoutRows = replayHoldout(matches, choice.spec);
const holdout = metricsOf(holdoutRows);
const mean = meanScoreboard(holdoutRows);
const mae = holdout.byCut.all.mae.total;
report.winnerHoldout = compact(holdout);
report.holdoutMeanScoreboard = Math.round(mean * 100) / 100;
report.relativeError = mae != null && mean > 0 ? Math.round((mae / mean) * 1000) / 1000 : null;

for (const candidate of choice.candidates) {
  if (candidate.role === "winner") continue;
  const rows = replayHoldout(matches, candidate.spec);
  report[`holdout-${candidate.role}`] = {
    spec: candidate.spec,
    metrics: compact(metricsOf(rows)),
  };
}

const out = "/tmp/backtest-report.json";
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(out);
console.log(
  JSON.stringify({
    tuneMs: report.tuneMs,
    spec: choice.spec,
    tuningMae: choice.tuning.byCut.all.mae,
    tuningWinner: choice.tuning.byCut.all.winnerAccuracy,
    tuningBrier: choice.tuning.byCut.all.brier,
    holdoutMae: holdout.byCut.all.mae,
    holdoutWinner: holdout.byCut.all.winnerAccuracy,
    holdoutBrier: holdout.byCut.all.brier,
    relativeError: report.relativeError,
  }),
);
