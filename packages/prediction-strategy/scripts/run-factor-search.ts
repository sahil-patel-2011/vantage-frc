/**
 * Tuning-only factor search. The holdout is scored only after the winner is frozen.
 * Not part of the test suite.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyProbability,
  chooseProbability,
  confidenceTier,
  expectedAccuracy,
  fitRange,
  measureRange,
  rangeHeld,
  yearScales,
  type RangeCategory,
  type StrengthEvent,
  type StrengthRating,
} from "../src/match-factors";
import {
  HOLDOUT_EVENT_KEYS,
  SHIPPED_CATEGORY_MODEL,
  isBetterTuning,
  metricsOf,
  replayHoldout,
  replayTuning,
  type ForecastRow,
  type MetricsBundle,
  type ModelSpec,
} from "../src/walk-forward";
import { load2026FixtureFile, replayMatchesFromFixture } from "../test/replay-fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const strengthFile = JSON.parse(readFileSync(join(here, "../test/fixtures/season-strength.json"), "utf8")) as {
  fetched: string;
  eventCount: number;
  teamEventCount: number;
  emptyEvents: string[];
  failures: { event: string; error: string }[];
  events: StrengthEvent[];
  ratings: StrengthRating[];
};

const strengths = { events: strengthFile.events, ratings: strengthFile.ratings };
const matches = replayMatchesFromFixture(load2026FixtureFile());
const categories: RangeCategory[] = ["auto", "teleop", "endgame", "foul", "total", "margin"];

function shippedBase(partial: Partial<ModelSpec> & { id: string }): ModelSpec {
  return { ...SHIPPED_CATEGORY_MODEL, relativeError: null, ...partial };
}

function compact(bundle: MetricsBundle) {
  const all = bundle.byCut.all;
  return {
    matches: all.matches,
    decided: all.decided,
    picks: all.picks,
    mae: all.mae,
    rmse: all.rmse,
    winnerAccuracy: all.winnerAccuracy,
    brier: all.brier,
    logLoss: all.logLoss,
    early: {
      matches: bundle.byCut.early.matches,
      mae: bundle.byCut.early.mae.total,
      winnerAccuracy: bundle.byCut.early.winnerAccuracy,
      brier: bundle.byCut.early.brier,
    },
    mid: { mae: bundle.byCut.mid.mae.total, winnerAccuracy: bundle.byCut.mid.winnerAccuracy },
    late: { mae: bundle.byCut.late.mae.total, winnerAccuracy: bundle.byCut.late.winnerAccuracy },
    calibration: bundle.calibration,
  };
}

function round3(value: number | null): number | null {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

const tuningOnly: { id: string; spec: ModelSpec; family: string }[] = [
  { id: "shipped", spec: SHIPPED_CATEGORY_MODEL, family: "base" },
  { id: "decay-0.93", spec: shippedBase({ id: "decay-0.93", decay: 0.93 }), family: "recency" },
  { id: "decay-0.85", spec: shippedBase({ id: "decay-0.85", decay: 0.85 }), family: "recency" },
  { id: "rookie-6", spec: shippedBase({ id: "rookie-6", rookieShrink: 6 }), family: "rookie" },
  { id: "zero-0", spec: shippedBase({ id: "zero-0", zeroWeight: 0 }), family: "zero" },
  { id: "defense-0.05", spec: shippedBase({ id: "defense-0.05", defense: 0.05 }), family: "defense" },
  { id: "defense-0.1", spec: shippedBase({ id: "defense-0.1", defense: 0.1 }), family: "defense" },
  { id: "synergy-0.5", spec: shippedBase({ id: "synergy-0.5", synergy: 0.5 }), family: "synergy" },
  { id: "synergy-1", spec: shippedBase({ id: "synergy-1", synergy: 1 }), family: "synergy" },
  { id: "schedule", spec: shippedBase({ id: "schedule", scheduleStrength: true }), family: "schedule" },
  { id: "playoff-1", spec: shippedBase({ id: "playoff-1", playoffShift: 1 }), family: "playoff" },
];

for (const seasonDecay of [0.45, 0.7, 1]) {
  for (const seasonPriorK of [2, 6, 12, 24]) {
    const id = `season-d${seasonDecay}-k${seasonPriorK}`;
    tuningOnly.push({
      id,
      family: "season",
      spec: shippedBase({ id, seasonDecay, seasonPriorK }),
    });
  }
}

const fairSpec: ModelSpec = {
  id: "vantage-plus-foul",
  kind: "vantage",
  decay: 1,
  ridge: 0.5,
  priorK: 0,
  epaPrior: 4,
  foul: "mean",
  epaPriorK: 0,
  epaFoul: "component",
  winShare: 0.3,
  ensembleWeight: 1,
  relativeError: null,
};

const started = performance.now();
const tuningReport: { id: string; family: string; tuning: ReturnType<typeof compact> }[] = [];
const tuningRows = new Map<string, ForecastRow[]>();
let best = { id: "shipped", spec: SHIPPED_CATEGORY_MODEL, metrics: metricsOf(replayTuning(matches, SHIPPED_CATEGORY_MODEL)) };
tuningRows.set("shipped", replayTuning(matches, SHIPPED_CATEGORY_MODEL));
tuningReport.push({ id: "shipped", family: "base", tuning: compact(best.metrics) });

for (const row of tuningOnly) {
  if (row.id === "shipped") continue;
  const rows = replayTuning(matches, row.spec, row.family === "season" || row.family === "playoff" ? { strengths } : undefined);
  const metrics = metricsOf(rows);
  tuningRows.set(row.id, rows);
  tuningReport.push({ id: row.id, family: row.family, tuning: compact(metrics) });
  if (isBetterTuning(metrics, best.metrics)) best = { id: row.id, spec: row.spec, metrics };
}

// Greedy stack: add one family at a time, and only when it beats the current spec on the tuning rule.
const families = ["recency", "rookie", "zero", "defense", "synergy", "schedule", "playoff", "season"];
let stacked: ModelSpec = { ...best.spec };
let stackedMetrics = best.metrics;
const stackNotes: string[] = [`start ${best.id}`];
const used = new Set<string>([best.id === "shipped" ? "base" : tuningOnly.find((row) => row.id === best.id)?.family ?? "base"]);
for (let guard = 0; guard < families.length; guard += 1) {
  let step: { id: string; family: string; spec: ModelSpec; metrics: MetricsBundle } | null = null;
  for (const family of families) {
    if (used.has(family)) continue;
    for (const candidate of tuningOnly.filter((row) => row.family === family)) {
      const spec: ModelSpec = {
        ...stacked,
        ...factorPatch(family, candidate.spec),
        id: `${stacked.id}+${candidate.id}`,
      };
      const metrics = metricsOf(replayTuning(matches, spec, needsStrength(spec) ? { strengths } : undefined));
      if (!isBetterTuning(metrics, step?.metrics ?? stackedMetrics)) continue;
      step = { id: candidate.id, family, spec, metrics };
    }
  }
  if (!step || !isBetterTuning(step.metrics, stackedMetrics)) break;
  stacked = step.spec;
  stackedMetrics = step.metrics;
  used.add(step.family);
  stackNotes.push(`add ${step.id} mae ${step.metrics.byCut.all.mae.total}`);
  best = { id: stacked.id, spec: stacked, metrics: step.metrics };
}

const frozen = { id: best.id, spec: best.spec, tuning: compact(best.metrics), stackNotes };
console.log("FROZEN", frozen.id, frozen.tuning.mae.total, frozen.tuning.winnerAccuracy, frozen.tuning.brier);
console.log(stackNotes.join(" | "));

// Holdout begins only after the freeze above.
const holdoutReport: { id: string; holdout: ReturnType<typeof compact> }[] = [];
function hold(spec: ModelSpec, id: string) {
  const rows = replayHoldout(matches, spec, needsStrength(spec) ? { strengths } : undefined);
  holdoutReport.push({ id, holdout: compact(metricsOf(rows)) });
  return rows;
}

const fairTuning = metricsOf(replayTuning(matches, fairSpec));
const fairHoldoutRows = hold(fairSpec, "vantage-plus-foul");
hold(SHIPPED_CATEGORY_MODEL, "shipped");
for (const row of tuningOnly) {
  if (row.id === "shipped") continue;
  hold(row.spec, row.id);
}
const frozenTuningRows = replayTuning(matches, frozen.spec, needsStrength(frozen.spec) ? { strengths } : undefined);
const frozenHoldoutRows = hold(frozen.spec, `frozen:${frozen.id}`);

const probability = chooseProbability(frozenTuningRows);
const probabilityTuning = metricsOf(probability.rows as ForecastRow[]);
const combined = [...frozenTuningRows, ...frozenHoldoutRows];
const applied = applyProbability(combined, probability);
const appliedHoldout = applied.filter((row) => (HOLDOUT_EVENT_KEYS as readonly string[]).includes(row.event));
const probabilityHoldout = metricsOf(appliedHoldout as ForecastRow[]);

function rangeBlock(tuning: ForecastRow[], holdout: ForecastRow[]) {
  return categories.map((category) => {
    const fit = fitRange(tuning, category);
    const measured = measureRange(holdout, fit);
    return {
      ...fit,
      tuningCoverage: round3(fit.tuningCoverage),
      tuningMeanWidth: round3(fit.tuningMeanWidth),
      holdoutN: measured.n,
      holdoutCoverage: round3(measured.coverage),
      holdoutMeanWidth: round3(measured.meanWidth),
      holds: rangeHeld(measured.coverage),
    };
  });
}

const shippedTuningRows = tuningRows.get("shipped") ?? replayTuning(matches, SHIPPED_CATEGORY_MODEL);
const shippedHoldoutRows = replayHoldout(matches, SHIPPED_CATEGORY_MODEL);
const shippedProbability = chooseProbability(shippedTuningRows);
const shippedApplied = applyProbability([...shippedTuningRows, ...shippedHoldoutRows], shippedProbability).filter((row) =>
  (HOLDOUT_EVENT_KEYS as readonly string[]).includes(row.event),
);

const scales = yearScales(strengthFile.events, strengthFile.ratings);
const report = {
  fetched: strengthFile.fetched,
  strengthEvents: strengthFile.eventCount,
  strengthRatings: strengthFile.teamEventCount,
  emptyEvents: strengthFile.emptyEvents.length,
  failures: strengthFile.failures,
  yearScale: Object.fromEntries([...scales.entries()].map(([year, scale]) => [year, {
    mean: Math.round(scale.mean * 1000) / 1000,
    sd: Math.round(scale.sd * 1000) / 1000,
    weight: scale.weight,
  }])),
  fairTuning: compact(fairTuning),
  fairHoldout: compact(metricsOf(fairHoldoutRows)),
  tuning: tuningReport,
  frozen,
  holdout: holdoutReport,
  probability: {
    choice: { share: probability.share, method: probability.method, brier: round3(probability.brier) },
    tuning: compact(probabilityTuning),
    holdout: compact(probabilityHoldout),
    ceiling: expectedAccuracy(appliedHoldout),
    tiers: {
      "0.80": confidenceTier(appliedHoldout, 0.8),
      "0.90": confidenceTier(appliedHoldout, 0.9),
    },
  },
  shippedCard: {
    ranges: rangeBlock(shippedTuningRows, shippedHoldoutRows),
    ceiling: expectedAccuracy(shippedHoldoutRows),
    tiers: {
      "0.80": confidenceTier(shippedHoldoutRows, 0.8),
      "0.90": confidenceTier(shippedHoldoutRows, 0.9),
    },
    probability: {
      choice: { share: shippedProbability.share, method: shippedProbability.method, brier: round3(shippedProbability.brier) },
      holdoutCeiling: expectedAccuracy(shippedApplied),
      holdoutTiers: {
        "0.80": confidenceTier(shippedApplied, 0.8),
        "0.90": confidenceTier(shippedApplied, 0.9),
      },
    },
  },
  frozenRanges: rangeBlock(frozenTuningRows, frozenHoldoutRows),
  elapsedMs: Math.round(performance.now() - started),
};

writeFileSync("/tmp/factor-report.json", JSON.stringify(report, null, 2));
console.log("wrote /tmp/factor-report.json", report.elapsedMs, "ms");

function factorPatch(family: string, spec: ModelSpec): Partial<ModelSpec> {
  if (family === "recency") return { decay: spec.decay };
  if (family === "rookie") return { rookieShrink: spec.rookieShrink };
  if (family === "zero") return { zeroWeight: spec.zeroWeight };
  if (family === "defense") return { defense: spec.defense };
  if (family === "synergy") return { synergy: spec.synergy };
  if (family === "schedule") return { scheduleStrength: spec.scheduleStrength };
  if (family === "playoff") return { playoffShift: spec.playoffShift };
  if (family === "season") return { seasonPriorK: spec.seasonPriorK, seasonDecay: spec.seasonDecay };
  return {};
}

function needsStrength(spec: ModelSpec): boolean {
  return (spec.seasonPriorK ?? 0) > 0 || (spec.playoffShift ?? 0) !== 0;
}
