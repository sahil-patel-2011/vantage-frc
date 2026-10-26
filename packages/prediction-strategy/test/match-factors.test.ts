import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARD_HIGH_CONFIDENCE_AT,
  CARD_RANGE_FITS,
} from "../src/range-display";
import {
  applyProbability,
  chooseProbability,
  confidenceTier,
  expectedAccuracy,
  fitRange,
  measureRange,
  rangeHeld,
  seasonPriorsForStudy,
  walkForwardCalibrate,
  type ProbabilityRow,
  type RangeCategory,
} from "../src/match-factors";
import {
  HOLDOUT_EVENT_KEYS,
  SHIPPED_CATEGORY_MODEL,
  metricsOf,
  replayHoldout,
  replaySplit,
  replayTuning,
  type ModelSpec,
  type ReplayMatch,
} from "../src/walk-forward";
import { load2026FixtureFile, replayMatchesFromFixture } from "./replay-fixtures";

const matches = replayMatchesFromFixture(load2026FixtureFile());
const categories: RangeCategory[] = ["auto", "teleop", "endgame", "foul", "total", "margin"];

function side(total: number) {
  return { total, auto: 0, teleop: total, endgame: 0, foul: 0 };
}

function row(partial: Pick<ProbabilityRow, "event" | "order" | "pRed" | "winner"> & { phase?: number }): ProbabilityRow {
  return {
    phase: partial.phase ?? 0,
    red: side(partial.pRed > 0.5 ? 20 : 10),
    blue: side(partial.pRed > 0.5 ? 10 : 20),
    historyMean: 100,
    ...partial,
  };
}

describe("season priors stay behind the matches they would leak", () => {
  const spec: ModelSpec = {
    ...SHIPPED_CATEGORY_MODEL,
    id: "season-probe",
    relativeError: null,
    seasonPriorK: 6,
    seasonDecay: 1,
  };
  const probe: ReplayMatch = {
    key: "2026arc_qm1",
    event: "2026arc",
    phase: 0,
    order: 1,
    level: "qm",
    qualIndex: 0,
    qualCount: 1,
    red: ["frc1", "frc2", "frc3"],
    blue: ["frc4", "frc5", "frc6"],
    redScore: { auto: 20, teleop: 80, endgame: 0, foul: 5, total: 105 },
    blueScore: { auto: 10, teleop: 70, endgame: 0, foul: 5, total: 85 },
  };
  const strengths = {
    events: [
      { key: "2026hop", year: 2026, start: "2026-04-01", end: "2026-04-01" },
      { key: "2026mike", year: 2026, start: "2026-03-01", end: "2026-03-01" },
    ],
    ratings: [
      { event: "2026hop", team: "frc1", matches: 10, opr: 80, qualOpr: 80, playoffOpr: null },
      { event: "2026mike", team: "frc1", matches: 10, opr: 40, qualOpr: 40, playoffOpr: null },
    ],
  };

  it("does not let a tuning replay use a holdout event's full rating", () => {
    const blocked = replayTuning([probe], spec, { strengths });
    const open = replaySplit([probe], spec, new Set(["2026arc"]), new Set(["2026arc"]), {
      strengths,
      blockedStrengthEvents: new Set(),
    });
    expect(blocked).toHaveLength(1);
    expect(open).toHaveLength(1);
    expect(open[0]!.red.total).not.toBeCloseTo(blocked[0]!.red.total, 0);
    expect(blocked[0]!.red.endgame).toBeNull();
    expect(blocked[0]!.red.total).toBeGreaterThan(0);
  });

  it("drops a prior that has not finished before the match", () => {
    const priors = seasonPriorsForStudy({
      events: [{ key: "2026later", year: 2026, start: "2026-05-01", end: "2026-05-02" }],
      ratings: [{ event: "2026later", team: "frc1", matches: 12, opr: 90, qualOpr: null, playoffOpr: null }],
      studyEvents: ["2026arc"],
      seasonDecay: 1,
    });
    expect(priors.get("2026arc")?.has("frc1")).toBeFalsy();
  });
});

describe("walk-forward calibration", () => {
  it("does not train a division on another division playing the same days", () => {
    const earlier = Array.from({ length: 40 }, (_, order) => row({ event: "2026arc", order, pRed: 0.2, winner: "red" }));
    const later = row({ event: "2026arc", order: 40, pRed: 0.2, winner: "blue" });
    const parallel = row({ event: "2026cur", order: 1, pRed: 0.2, winner: "blue" });
    const calibrated = walkForwardCalibrate([...earlier, later, parallel], "platt");
    const moved = calibrated.find((item) => item.event === "2026arc" && item.order === 40);
    const untouched = calibrated.find((item) => item.event === "2026cur");
    expect(moved?.pRed).toBeGreaterThan(0.2);
    expect(untouched?.pRed).toBeCloseTo(0.2, 5);
  });
});

describe("card ranges and the fair foul re-score", () => {
  it("keeps 90% widths that the holdout actually covered", () => {
    const tuning = replayTuning(matches, SHIPPED_CATEGORY_MODEL);
    const holdout = replayHoldout(matches, SHIPPED_CATEGORY_MODEL);
    for (const category of categories) {
      const fit = fitRange(tuning, category);
      expect(CARD_RANGE_FITS[category]).toEqual({ k: fit.k, nRef: fit.nRef, z90: fit.z90 });
      const measured = measureRange(holdout, fit);
      expect(rangeHeld(measured.coverage)).toBe(true);
    }
    const high = confidenceTier(holdout, 0.9);
    const mid = confidenceTier(holdout, 0.8);
    expect(high).toEqual({ n: 66, accuracy: 63 / 66 });
    expect(mid.n).toBe(150);
    expect(mid.accuracy).toBeCloseTo(0.88, 2);
    expect(CARD_HIGH_CONFIDENCE_AT).toBe(0.9);
    expect(HOLDOUT_EVENT_KEYS).toContain("2026hop");
  });

  it("adds the same foul average to both alliances and leaves the pick's curve alone", () => {
    const fair: ModelSpec = {
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
    const tuned = metricsOf(replayTuning(matches, fair)).byCut.all;
    const held = metricsOf(replayHoldout(matches, fair)).byCut.all;
    expect(tuned.matches).toBe(629);
    expect(tuned.mae.total).toBe(92.45);
    expect(tuned.winnerAccuracy).toBe(0.752);
    expect(tuned.brier).toBe(0.178);
    expect(held.matches).toBe(570);
    expect(held.mae.total).toBe(98.37);
    expect(held.winnerAccuracy).toBe(0.707);
    expect(held.brier).toBe(0.19);
  });
});

describe("frozen factor model", () => {
  const spec: ModelSpec = {
    ...SHIPPED_CATEGORY_MODEL,
    id: "season-d0.45-k6+defense-0.1+schedule",
    relativeError: null,
    seasonDecay: 0.45,
    seasonPriorK: 6,
    defense: 0.1,
    scheduleStrength: true,
  };

  function loadStrengths() {
    const file = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/season-strength.json"), "utf8"),
    ) as { events: { key: string; year: number; start: string; end: string }[]; ratings: { event: string; team: string; matches: number; opr: number; qualOpr: number | null; playoffOpr: number | null; qualMatches?: number; playoffMatches?: number }[] };
    return { events: file.events, ratings: file.ratings };
  }

  it("keeps the tuning choice and the one holdout score", () => {
    const strengths = loadStrengths();
    const tuning = metricsOf(replayTuning(matches, spec, { strengths })).byCut.all;
    const holdout = metricsOf(replayHoldout(matches, spec, { strengths })).byCut.all;
    expect(tuning.matches).toBe(634);
    expect(tuning.picks).toBe(632);
    expect(tuning.mae).toEqual({ auto: 21.77, teleop: 72.12, endgame: 0.89, foul: 8.73, total: 80.99 });
    expect(tuning.winnerAccuracy).toBe(0.769);
    expect(tuning.brier).toBe(0.158);
    expect(holdout.matches).toBe(575);
    expect(holdout.picks).toBe(575);
    expect(holdout.mae).toEqual({ auto: 23.35, teleop: 77.9, endgame: 1.13, foul: 8.27, total: 86.54 });
    expect(holdout.rmse.total).toBe(107.31);
    expect(holdout.winnerAccuracy).toBe(0.732);
    expect(holdout.brier).toBe(0.165);
    expect(holdout.logLoss).toBe(0.5);

    const tuningRows = replayTuning(matches, spec, { strengths });
    const holdoutRows = replayHoldout(matches, spec, { strengths });
    const holdoutCuts = metricsOf(holdoutRows).byCut;
    expect(holdoutCuts.early.matches).toBe(168);
    expect(holdoutCuts.mid.matches).toBe(166);
    expect(holdoutCuts.late.matches).toBe(241);
    const choice = chooseProbability(tuningRows);
    expect(choice.method).toBe("normal");
    expect(choice.share).toBe(0.3);
    const applied = applyProbability([...tuningRows, ...holdoutRows], choice).filter((row) =>
      (["2026hop", "2026joh", "2026mil", "2026new", "2026cmptx"] as readonly string[]).includes(row.event),
    );
    const probability = metricsOf(applied);
    expect(probability.byCut.all.brier).toBe(0.163);
    expect(probability.byCut.all.winnerAccuracy).toBe(0.732);
    const ceiling = expectedAccuracy(applied);
    expect(ceiling.n).toBe(575);
    expect(ceiling.ceiling).toBeCloseTo(0.733, 3);
    expect(ceiling.accuracy).toBeCloseTo(0.732, 3);
    expect(confidenceTier(applied, 0.8)).toEqual({ n: 192, accuracy: 178 / 192 });
    expect(confidenceTier(applied, 0.9)).toEqual({ n: 94, accuracy: 91 / 94 });
  }, 60_000);
});

describe("strength file", () => {
  it("records the public fetch and does not rate the ten replayed events", () => {
    const file = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/season-strength.json"), "utf8"),
    ) as { fetched: string; eventCount: number; failures: unknown[]; emptyEvents: string[]; events: { key: string; end: string; start: string }[] };
    expect(file.fetched).toBe("2026-10-26");
    expect(file.failures).toEqual([]);
    expect(file.eventCount).toBe(876);
    expect(file.emptyEvents).toHaveLength(102);
    expect(file.events.some((event) => event.end < event.start)).toBe(false);
    for (const key of ["2026gagr", "2026arc", "2026cur", "2026dal", "2026gal", "2026hop", "2026joh", "2026mil", "2026new", "2026cmptx"]) {
      expect(file.events.some((event) => event.key === key)).toBe(false);
    }
  });
});
