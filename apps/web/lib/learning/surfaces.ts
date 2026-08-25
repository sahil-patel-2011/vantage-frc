// Surface adapters: turn each calculator's EXISTING pure functions into a set of
// "Call Your Shot" prediction fields.
//
// No maths is reimplemented here. compoundReduction/outputRpm, summarizePower and
// interpolateShot stay the single source of truth; this module only decides which
// of their outputs a student calls first, what leverage each input term has, and
// which specific wrong methods would have produced which number.
//
// Pure module: no DB, no React, no I/O.

import { compoundReduction, outputRpm, type Stage } from "../gearbox";
import { summarizePower, type PowerLoad } from "../power-budget";
import { interpolateShot, type ShooterPoint } from "../shooter-table";
import type { MisconceptionCandidate, TermContribution } from "./predictions";

export type CallField = {
  key: string;
  /** Field label, e.g. "Compound reduction". */
  label: string;
  /** The same thing phrased to sit inside a sentence, e.g. "the compound reduction". */
  clause: string;
  unit: string;
  /** A nudge toward the method — never the answer. */
  hint: string;
  /** The truth, straight from the calculator's own pure function. */
  actual: number;
  tolerance: number;
  step: string;
  /** Set when the honest answer carries a caveat (clamped, extrapolated, …). */
  note?: string;
  /**
   * Terms are resolved after the call is committed, because some terms are only
   * knowable from what the student themselves assumed (e.g. the reduction they
   * called, which then feeds output speed).
   */
  terms: (committed: Record<string, number>) => TermContribution[];
  misconceptions: MisconceptionCandidate[];
};

export type CallFieldSet =
  | { status: "ready"; fields: CallField[] }
  | { status: "unavailable"; reason: string };

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** How much the result moves when one term moves 10% — a legible leverage figure. */
function leverage(compute: (value: number) => number, base: number, fraction = 0.1): number {
  if (!Number.isFinite(base) || base === 0) return 0;
  return Math.abs(compute(base) - compute(base * (1 + fraction)));
}

// ---- gearbox -------------------------------------------------------------

export function buildGearboxCall(input: { stages: Stage[]; motorFreeRpm: number | null }): CallFieldSet {
  const stages = input.stages.filter((s) => s.driving > 0 && s.driven > 0);
  if (stages.length === 0) {
    return { status: "unavailable", reason: "Enter at least one gear stage — there is nothing to call yet." };
  }
  const reduction = compoundReduction(stages);
  const fields: CallField[] = [];

  const stageRatio = (s: Stage) => s.driven / s.driving;
  const reductionMisconceptions: MisconceptionCandidate[] = [
    {
      id: "inverse",
      value: round(1 / reduction, 4),
      explanation:
        "That is the inverse — driving ÷ driven. Compound reduction is driven ÷ driving, so a reduction comes out greater than 1 and an overdrive comes out less.",
    },
  ];
  if (stages.length > 1) {
    reductionMisconceptions.push({
      id: "sum",
      value: round(stages.reduce((sum, s) => sum + stageRatio(s), 0), 4),
      explanation: "Stage ratios multiply through the chain — they do not add.",
    });
    for (const stage of stages) {
      const ratio = stageRatio(stage);
      reductionMisconceptions.push({
        id: `dropped:${stage.driving}:${stage.driven}`,
        value: round(reduction / ratio, 4),
        explanation: `That is the chain without the ${stage.driving}:${stage.driven} stage — every stage multiplies in, including that one.`,
      });
      reductionMisconceptions.push({
        id: `flipped:${stage.driving}:${stage.driven}`,
        value: round((reduction / ratio) * (1 / ratio), 4),
        explanation: `That is the chain with the ${stage.driving}:${stage.driven} stage flipped — count the driven teeth on top for that stage too.`,
      });
    }
  }

  fields.push({
    key: "reduction",
    label: "Compound reduction",
    clause: "the compound reduction",
    unit: ":1",
    hint: "Each stage contributes driven ÷ driving. What do they do to each other down the chain?",
    actual: reduction,
    tolerance: 0.02,
    step: "0.001",
    terms: () =>
      stages.map((stage) => {
        const ratio = stageRatio(stage);
        return {
          term: `stage:${stage.driving}:${stage.driven}`,
          label: `the ${stage.driving}:${stage.driven} stage (×${round(ratio)})`,
          assumed: null,
          // Leverage in result units: how far the compound reduction moves if this
          // stage comes out of the chain. Overdrive stages swing it hardest.
          actual: round(ratio),
          influence: Math.abs(reduction - reduction / ratio),
          unit: "",
        } satisfies TermContribution;
      }),
    misconceptions: reductionMisconceptions,
  });

  const freeRpm = input.motorFreeRpm;
  if (freeRpm != null && Number.isFinite(freeRpm) && freeRpm > 0) {
    const truth = outputRpm(freeRpm, reduction);
    if (truth != null) {
      fields.push({
        key: "outputRpm",
        label: "Output speed",
        clause: "the output speed",
        unit: " RPM",
        hint: "The motor spins at its free speed. What does a reduction do to speed — and what does it do to torque?",
        actual: truth,
        tolerance: 0.03,
        step: "1",
        terms: (committed) => {
          const raw = committed.reduction;
          const assumedReduction = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
          return [
            {
              term: "reduction",
              label: "the compound reduction",
              assumed: assumedReduction == null ? null : round(assumedReduction),
              actual: reduction,
              influence:
                assumedReduction == null
                  ? leverage((r) => freeRpm / r, reduction)
                  : Math.abs(freeRpm / assumedReduction - freeRpm / reduction),
              unit: ":1",
            },
            {
              // The student typed this one in, so it is never the mis-assumed term —
              // it is still the other lever on the answer.
              term: "freeSpeed",
              label: "the motor free speed you entered",
              assumed: freeRpm,
              actual: freeRpm,
              influence: leverage((f) => f / reduction, freeRpm),
              unit: " RPM",
            },
          ];
        },
        misconceptions: [
          {
            id: "multiplied",
            value: round(freeRpm * reduction, 2),
            explanation:
              "That is motor RPM × reduction. A reduction divides speed and multiplies torque — you swapped which one gets the multiply.",
          },
          {
            id: "ungeared",
            value: round(freeRpm, 2),
            explanation: "That is the motor's free speed with no gearbox in the way at all.",
          },
        ],
      });
    }
  }

  return { status: "ready", fields };
}

// ---- power budget --------------------------------------------------------

export function buildPowerBudgetCall(input: { loads: PowerLoad[] }): CallFieldSet {
  const loads = input.loads;
  if (loads.length === 0) {
    return { status: "unavailable", reason: "Log at least one load — there is no budget to call yet." };
  }
  const summary = summarizePower(loads);
  const typicalLoads = loads.filter((l) => l.typicalAmps != null);
  const peakLoads = loads.filter((l) => l.peakAmps != null);
  const fields: CallField[] = [];

  if (typicalLoads.length > 0) {
    const biggest = Math.max(...typicalLoads.map((l) => l.typicalAmps as number));
    const misconceptions: MisconceptionCandidate[] = [
      {
        id: "biggest_branch",
        value: round(biggest, 2),
        explanation: "That is the single biggest branch, not the sum. Every branch draws from the same battery at the same time.",
      },
    ];
    if (peakLoads.length > 0) {
      misconceptions.push({
        id: "peak_column",
        value: summary.totalPeakAmps,
        explanation:
          "That is the peak column. Typical draw is the running average that decides brownouts; peak is per-branch and decides breaker trips.",
      });
    }
    fields.push({
      key: "totalTypicalAmps",
      label: "Total typical draw",
      clause: "the total typical draw",
      unit: " A",
      hint: `Every branch pulls from one battery at once. ${typicalLoads.length} branch${typicalLoads.length === 1 ? "" : "es"} have a typical figure logged.`,
      actual: summary.totalTypicalAmps,
      tolerance: 0.05,
      step: "0.1",
      terms: () =>
        typicalLoads.map((load) => ({
          term: `load:${load.name}`,
          label: `the ${load.name} branch (${load.typicalAmps} A typical)`,
          assumed: null,
          actual: load.typicalAmps as number,
          influence: load.typicalAmps as number,
          unit: " A",
        })),
      misconceptions,
    });
  }

  if (peakLoads.length > 0) {
    const misconceptions: MisconceptionCandidate[] = [
      {
        id: "biggest_peak",
        value: round(Math.max(...peakLoads.map((l) => l.peakAmps as number)), 2),
        explanation: "That is the worst single branch, not the sum of every branch's worst case.",
      },
    ];
    if (typicalLoads.length > 0) {
      misconceptions.push({
        id: "typical_column",
        value: summary.totalTypicalAmps,
        explanation: "That is the typical column — the running average, not the worst case each branch can pull.",
      });
    }
    fields.push({
      key: "totalPeakAmps",
      label: "Total peak draw",
      clause: "the total peak draw",
      unit: " A",
      hint: "Worst case on every branch, added up. Compare it against the 120 A main breaker afterwards.",
      actual: summary.totalPeakAmps,
      tolerance: 0.05,
      step: "0.1",
      terms: () =>
        peakLoads.map((load) => ({
          term: `load:${load.name}`,
          label: `the ${load.name} branch (${load.peakAmps} A peak)`,
          assumed: null,
          actual: load.peakAmps as number,
          influence: load.peakAmps as number,
          unit: " A",
        })),
      misconceptions,
    });
  }

  if (fields.length === 0) {
    return {
      status: "unavailable",
      reason: "No load has a typical or peak current logged yet — measure one branch and the call opens up.",
    };
  }
  return { status: "ready", fields };
}

// ---- shooter table -------------------------------------------------------

type Bracket = { low: { distanceFt: number; value: number }; high: { distanceFt: number; value: number } } | null;

function bracketFor(points: { distanceFt: number; value: number }[], distanceFt: number): Bracket {
  const sorted = [...points].sort((a, b) => a.distanceFt - b.distanceFt);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const low = sorted[i]!;
    const high = sorted[i + 1]!;
    if (distanceFt >= low.distanceFt && distanceFt <= high.distanceFt) return { low, high };
  }
  return null;
}

function shooterField(args: {
  key: string;
  label: string;
  clause: string;
  unit: string;
  tolerance: number;
  step: string;
  actual: number;
  distanceFt: number;
  points: { distanceFt: number; value: number }[];
  extrapolated: boolean;
}): CallField {
  const { points, distanceFt, actual, extrapolated } = args;
  const bracket = bracketFor(points, distanceFt);
  const misconceptions: MisconceptionCandidate[] = [];
  if (!extrapolated && points.length > 1) {
    const nearest = [...points].sort(
      (a, b) => Math.abs(a.distanceFt - distanceFt) - Math.abs(b.distanceFt - distanceFt),
    )[0]!;
    misconceptions.push({
      id: "nearest_point",
      value: round(nearest.value, 2),
      explanation: `That is the ${nearest.distanceFt} ft point read straight off the table. The lookup interpolates between the two points that bracket ${distanceFt} ft.`,
    });
    misconceptions.push({
      id: "table_mean",
      value: round(points.reduce((sum, p) => sum + p.value, 0) / points.length, 2),
      explanation: "That is the average of every calibrated point — the lookup weights by distance, not by count.",
    });
  }

  return {
    key: args.key,
    label: args.label,
    clause: args.clause,
    unit: args.unit,
    hint: extrapolated
      ? `${distanceFt} ft is outside the calibrated range, so the table clamps to the nearest end. Which end, and what does it read?`
      : `Two calibrated points bracket ${distanceFt} ft. How far between them does ${distanceFt} ft sit?`,
    actual,
    tolerance: args.tolerance,
    step: args.step,
    note: extrapolated ? "Outside the calibrated range — the table clamps to the nearest point rather than extrapolating." : undefined,
    terms: () => {
      if (!bracket) {
        return points.map((point) => ({
          term: `point:${point.distanceFt}`,
          label: `the ${point.distanceFt} ft point (${round(point.value, 2)}${args.unit})`,
          assumed: null,
          actual: round(point.value, 2),
          influence: 0,
          unit: args.unit,
        }));
      }
      const span = bracket.high.distanceFt - bracket.low.distanceFt;
      const highWeight = span === 0 ? 1 : (distanceFt - bracket.low.distanceFt) / span;
      const lowWeight = 1 - highWeight;
      return [
        {
          term: `point:${bracket.low.distanceFt}`,
          label: `the ${bracket.low.distanceFt} ft point (${round(bracket.low.value, 2)}${args.unit}, ${Math.round(lowWeight * 100)}% of the read)`,
          assumed: null,
          actual: round(bracket.low.value, 2),
          // Leverage in result units: how far the read moves if this point moves 10%.
          influence: Math.abs(lowWeight * bracket.low.value * 0.1),
          unit: args.unit,
        },
        {
          term: `point:${bracket.high.distanceFt}`,
          label: `the ${bracket.high.distanceFt} ft point (${round(bracket.high.value, 2)}${args.unit}, ${Math.round(highWeight * 100)}% of the read)`,
          assumed: null,
          actual: round(bracket.high.value, 2),
          influence: Math.abs(highWeight * bracket.high.value * 0.1),
          unit: args.unit,
        },
      ];
    },
    misconceptions,
  };
}

export function buildShooterCall(input: { points: ShooterPoint[]; distanceFt: number }): CallFieldSet {
  const { points, distanceFt } = input;
  if (!Number.isFinite(distanceFt) || distanceFt <= 0) {
    return { status: "unavailable", reason: "Enter the distance you are shooting from first." };
  }
  const rpmPoints = points.filter((p) => p.rpm != null).map((p) => ({ distanceFt: p.distanceFt, value: p.rpm as number }));
  const anglePoints = points
    .filter((p) => p.hoodAngle != null)
    .map((p) => ({ distanceFt: p.distanceFt, value: p.hoodAngle as number }));
  if (rpmPoints.length < 2 && anglePoints.length < 2) {
    return {
      status: "unavailable",
      reason: "Log at least two calibrated points for the same field — with one point there is nothing to interpolate between.",
    };
  }

  const shot = interpolateShot(points, distanceFt);
  const fields: CallField[] = [];
  if (shot.rpm != null && rpmPoints.length >= 2) {
    fields.push(
      shooterField({
        key: "rpm",
        label: "Flywheel RPM",
        clause: "the flywheel RPM",
        unit: " RPM",
        tolerance: 0.03,
        step: "1",
        actual: shot.rpm,
        distanceFt,
        points: rpmPoints,
        extrapolated: shot.extrapolated,
      }),
    );
  }
  if (shot.hoodAngle != null && anglePoints.length >= 2) {
    fields.push(
      shooterField({
        key: "hoodAngle",
        label: "Hood angle",
        clause: "the hood angle",
        unit: "°",
        tolerance: 0.05,
        step: "0.1",
        actual: shot.hoodAngle,
        distanceFt,
        points: anglePoints,
        extrapolated: shot.extrapolated,
      }),
    );
  }

  if (fields.length === 0) {
    return { status: "unavailable", reason: "No calibrated field covers this distance yet." };
  }
  return { status: "ready", fields };
}
