// Pure, framework-free PID/feedforward tuning math. Everything here is deterministic and grounded
// only in the gain sets + test results the caller supplies for a session — it never invents a gain
// value or a result the team didn't log. compute-tuning-autopilot.ts wraps this with DB I/O; the
// API route and client render results.

import type {
  ScoredIteration,
  TuningControllerType,
  TuningGains,
  TuningIteration,
  TuningIterationResult,
  TuningSessionStatus,
  TuningSuggestion,
} from "./types";

export const TUNING_CONTROLLER_TYPES: TuningControllerType[] = ["pid", "pidf", "feedforward"];
export const TUNING_SESSION_STATUSES: TuningSessionStatus[] = ["active", "converged", "abandoned"];

export function tuningControllerTypeLabel(type: TuningControllerType): string {
  switch (type) {
    case "pid":
      return "PID";
    case "pidf":
      return "PID + Feedforward";
    default:
      return "Feedforward";
  }
}

export function tuningSessionStatusLabel(status: TuningSessionStatus): string {
  switch (status) {
    case "converged":
      return "Converged";
    case "abandoned":
      return "Abandoned";
    default:
      return "Active";
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 5) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Thresholds separating "good" from "needs work" for each result metric. */
export const TUNING_THRESHOLDS = {
  overshootPctGood: 5,
  overshootPctBad: 15,
  settlingTimeSecGood: 0.5,
  settlingTimeSecBad: 2.5,
  steadyStateErrorGood: 0.01,
  steadyStateErrorBad: 0.08,
};

/**
 * Score an iteration's observed result on 0..1 (1 = ideal). Oscillation is penalized heaviest
 * since it indicates instability rather than merely slow convergence.
 */
export function scoreIterationResult(result: TuningIterationResult): number {
  const overshootScore = clamp01(
    1 -
      (result.overshootPct - TUNING_THRESHOLDS.overshootPctGood) /
        (TUNING_THRESHOLDS.overshootPctBad - TUNING_THRESHOLDS.overshootPctGood),
  );
  const settlingScore = clamp01(
    1 -
      (result.settlingTimeSec - TUNING_THRESHOLDS.settlingTimeSecGood) /
        (TUNING_THRESHOLDS.settlingTimeSecBad - TUNING_THRESHOLDS.settlingTimeSecGood),
  );
  const errorScore = clamp01(
    1 -
      (result.steadyStateError - TUNING_THRESHOLDS.steadyStateErrorGood) /
        (TUNING_THRESHOLDS.steadyStateErrorBad - TUNING_THRESHOLDS.steadyStateErrorGood),
  );
  const weighted = overshootScore * 0.35 + settlingScore * 0.3 + errorScore * 0.25 + (result.oscillating ? 0 : 1) * 0.1;
  return round(clamp01(weighted), 4);
}

/** Attach a deterministic 0..1 quality score to each iteration, grounded only in its own result. */
export function scoreIterations(iterations: TuningIteration[]): ScoredIteration[] {
  return iterations.map((iteration) => ({ ...iteration, score: scoreIterationResult(iteration.result) }));
}

/** The best-scoring iteration so far, or null if none logged. */
export function bestIteration(iterations: ScoredIteration[]): ScoredIteration | null {
  if (iterations.length === 0) return null;
  return iterations.reduce((best, current) => (current.score > best.score ? current : best));
}

/** The most recently logged iteration (highest iterationIndex, tie-break by createdAt). */
export function latestIteration(iterations: ScoredIteration[]): ScoredIteration | null {
  if (iterations.length === 0) return null;
  return iterations.reduce((latest, current) => {
    if (current.iterationIndex !== latest.iterationIndex) {
      return current.iterationIndex > latest.iterationIndex ? current : latest;
    }
    return current.createdAt > latest.createdAt ? current : latest;
  });
}

const GAIN_STEP = {
  down: 0.85,
  slightDown: 0.92,
  up: 1.15,
  slightUp: 1.08,
};

/**
 * Suggest the next gain set to try, derived only from this session's own logged iteration trend.
 * Rule-based classic PID heuristics (reduce kP on oscillation/overshoot, add kD to damp overshoot,
 * raise kI to kill steady-state error, raise kP when settling is slow with no overshoot) applied to
 * the best-scoring iteration logged so far. Returns null when there's nothing logged yet.
 */
export function suggestNextGains(iterations: TuningIteration[]): TuningSuggestion | null {
  if (iterations.length === 0) return null;
  const scored = scoreIterations(iterations);
  const best = bestIteration(scored);
  const latest = latestIteration(scored);
  if (!best || !latest) return null;

  const rationale: string[] = [];
  const gains: TuningGains = { ...best.gains };

  if (latest.id === best.id && latest.score >= 0.9) {
    return {
      gains,
      rationale: [
        `Iteration ${latest.iterationIndex} is your best-scoring run (${Math.round(latest.score * 100)}%) with no oscillation and low overshoot/error — hold these gains.`,
      ],
      basedOnIterationIds: [best.id],
      confidence: clamp01(scored.length / 5),
      converged: true,
    };
  }

  const ref = latest;
  if (ref.result.oscillating) {
    gains.kP = round(gains.kP * GAIN_STEP.down);
    rationale.push(
      `Iteration ${ref.iterationIndex} oscillated — reduce kP by 15% (${best.gains.kP} → ${gains.kP}) to regain stability.`,
    );
  } else if (ref.result.overshootPct > TUNING_THRESHOLDS.overshootPctGood) {
    gains.kP = round(gains.kP * GAIN_STEP.slightDown);
    gains.kD = round(Math.max(gains.kD, 0.001) * GAIN_STEP.up);
    rationale.push(
      `Overshoot was ${ref.result.overshootPct}% (target <${TUNING_THRESHOLDS.overshootPctGood}%) — trim kP slightly and raise kD to damp the response.`,
    );
  }

  if (ref.result.steadyStateError > TUNING_THRESHOLDS.steadyStateErrorGood) {
    gains.kI = round(Math.max(gains.kI, 0.0005) * GAIN_STEP.up);
    rationale.push(
      `Steady-state error was ${ref.result.steadyStateError} (target <${TUNING_THRESHOLDS.steadyStateErrorGood}) — raise kI to close the gap.`,
    );
  }

  if (
    !ref.result.oscillating &&
    ref.result.overshootPct <= TUNING_THRESHOLDS.overshootPctGood &&
    ref.result.settlingTimeSec > TUNING_THRESHOLDS.settlingTimeSecGood
  ) {
    gains.kP = round(gains.kP * GAIN_STEP.slightUp);
    rationale.push(
      `Settling time was ${ref.result.settlingTimeSec}s (target <${TUNING_THRESHOLDS.settlingTimeSecGood}s) with no overshoot — raise kP slightly to speed convergence.`,
    );
  }

  if (rationale.length === 0) {
    rationale.push(
      `Iteration ${ref.iterationIndex} is close to target on all metrics — hold the best-logged gain set (iteration ${best.iterationIndex}) and re-test.`,
    );
  }

  return {
    gains,
    rationale,
    basedOnIterationIds: Array.from(new Set([best.id, latest.id])),
    confidence: clamp01(scored.length / 5),
    converged: false,
  };
}
