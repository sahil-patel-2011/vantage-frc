// "Call Your Shot" scoring and the deterministic answer key.
//
// The maths is the answer key: every sentence in here is derived from the
// calculator's own pure functions and the student's own numbers. No AI is
// required to explain a miss — an optional metered coach paragraph may add
// nuance on top, but the deterministic text always renders first, and nothing
// here ever invents a value the team did not enter.
//
// Pure module: no DB, no React, no I/O.

import { isLearningSurface, type LearningSurface } from "./learning-mode";

export type Closeness = "spot-on" | "close" | "off";

/** Within 5% is spot on by default; each surface tightens this where it should. */
export const DEFAULT_TOLERANCE = 0.05;
/** "close" is the spot-on band widened by this factor; beyond it is "off". */
export const CLOSE_BAND_MULTIPLIER = 3;

export type ScoreCallInput = {
  predicted: number;
  actual: number;
  /** Fractional tolerance for "spot-on" (0.02 = within 2%). */
  tolerance?: number;
  /** Used instead of percent error when `actual` is 0 — percent is undefined there. */
  absoluteTolerance?: number;
  /** Appended to the numbers in the verdict, e.g. ":1", " RPM", " A". */
  unit?: string;
};

export type CallScore = {
  closeness: Closeness;
  /** Signed percent error, null when `actual` is 0. */
  percentError: number | null;
  absoluteError: number;
  direction: "high" | "low" | "exact";
  verdict: string;
};

export function formatCallNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) >= 100 ? Math.round(value * 10) / 10 : Math.round(value * 1000) / 1000;
  return String(rounded);
}

function withUnit(value: number, unit: string | undefined): string {
  return `${formatCallNumber(value)}${unit ?? ""}`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Grade one committed call against the number the calculator actually produced.
 * Throws on non-numeric input rather than inventing a score — callers validate
 * the student's entry before committing it.
 */
export function scoreCallYourShot(input: ScoreCallInput): CallScore {
  const { predicted, actual, unit } = input;
  if (!Number.isFinite(predicted)) throw new Error("A prediction has to be a real number");
  if (!Number.isFinite(actual)) throw new Error("There is no computed result to score against yet");

  const tolerance = Number.isFinite(input.tolerance) && (input.tolerance as number) > 0
    ? (input.tolerance as number)
    : DEFAULT_TOLERANCE;
  const absoluteError = round(Math.abs(predicted - actual), 4);
  const direction: CallScore["direction"] = predicted > actual ? "high" : predicted < actual ? "low" : "exact";
  const percentError = actual === 0 ? null : round(((predicted - actual) / Math.abs(actual)) * 100, 1);

  let closeness: Closeness;
  if (percentError == null) {
    // A zero truth has no percentage. Grade on the absolute band the surface
    // supplied; with no band, only an exact call counts.
    const absTolerance = Number.isFinite(input.absoluteTolerance) && (input.absoluteTolerance as number) >= 0
      ? (input.absoluteTolerance as number)
      : 0;
    closeness =
      absoluteError <= absTolerance
        ? "spot-on"
        : absoluteError <= absTolerance * CLOSE_BAND_MULTIPLIER
          ? "close"
          : "off";
  } else {
    const magnitude = Math.abs(percentError) / 100;
    closeness =
      magnitude <= tolerance ? "spot-on" : magnitude <= tolerance * CLOSE_BAND_MULTIPLIER ? "close" : "off";
  }

  const gap =
    percentError == null
      ? `${formatCallNumber(absoluteError)}${unit ?? ""} off`
      : `${Math.abs(percentError)}% ${direction === "exact" ? "off" : direction}`;
  const head = closeness === "spot-on" ? "Spot on" : closeness === "close" ? "Close" : "Off";
  const verdict =
    direction === "exact"
      ? `Spot on — you called ${withUnit(predicted, unit)} and that is exactly what the math says.`
      : `${head} — you called ${withUnit(predicted, unit)}, the math says ${withUnit(actual, unit)} (${gap}).`;

  return { closeness, percentError, absoluteError, direction, verdict };
}

// ---- the deterministic delta explanation --------------------------------

export type TermContribution = {
  /** Stable key, e.g. "reduction", "stage:2", "load:Drivetrain". */
  term: string;
  /** Human clause that reads inside a sentence, e.g. "the compound reduction". */
  label: string;
  /** What the student's own call implies for this term, when that is knowable. */
  assumed: number | null;
  /** What the real numbers say. */
  actual: number;
  /** How far this term moves the result, in result units. Bigger = more leverage. */
  influence: number;
  unit?: string;
};

export type DeltaExplanation = {
  sentence: string;
  dominantTerm: string | null;
  direction: "high" | "low" | "exact";
};

function relativeDiff(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return Math.abs((a - b) / b);
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function capitalize(text: string): string {
  return text.length ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function strongest(terms: TermContribution[]): TermContribution | null {
  let best: TermContribution | null = null;
  for (const term of terms) {
    if (!Number.isFinite(term.influence)) continue;
    if (!best || Math.abs(term.influence) > Math.abs(best.influence)) best = term;
  }
  return best;
}

/**
 * Name the term that carries the miss, in one deterministic sentence.
 *
 * Two modes, both answer-key-driven:
 *  1. When the surface can reconstruct what the student assumed for a term
 *     (e.g. they also called the reduction that feeds output speed), the
 *     mis-weighted term is named with its direction and size.
 *  2. When nothing about the individual terms is knowable, the sentence names
 *     the term with the most leverage on the answer, so the student knows where
 *     to look next. It never guesses at a mistake it cannot see.
 *
 * `inputs` is the calculator's input snapshot; `label` and `unit` on it are used
 * to phrase the sentence in the surface's own words.
 */
export function explainDelta(
  inputs: Record<string, unknown>,
  predicted: number,
  actual: number,
  termContributions: TermContribution[],
): DeltaExplanation {
  const label = typeof inputs.label === "string" && inputs.label.trim() ? inputs.label.trim() : "the result";
  const unit = typeof inputs.unit === "string" ? inputs.unit : "";
  const direction: DeltaExplanation["direction"] = predicted > actual ? "high" : predicted < actual ? "low" : "exact";

  if (!Number.isFinite(predicted) || !Number.isFinite(actual)) {
    return { sentence: `There is no computed ${label} to compare your call against yet.`, dominantTerm: null, direction: "exact" };
  }
  if (direction === "exact") {
    return {
      sentence: capitalize(`your ${label} matched the math exactly — ${withUnit(actual, unit)}.`),
      dominantTerm: null,
      direction,
    };
  }

  const known = termContributions.filter((t) => t.assumed != null && Number.isFinite(t.assumed));
  const misweighted = known.filter((t) => relativeDiff(t.assumed as number, t.actual) > 0.01);
  const rightOnes = known.filter((t) => relativeDiff(t.assumed as number, t.actual) <= 0.01);

  if (misweighted.length) {
    const dominant = strongest(misweighted)!;
    const assumed = dominant.assumed as number;
    const signedPct = dominant.actual === 0 ? null : round(((assumed - dominant.actual) / Math.abs(dominant.actual)) * 100, 0);
    const offBy =
      signedPct == null
        ? `${formatCallNumber(Math.abs(assumed - dominant.actual))}${dominant.unit ?? ""} away from`
        : `${Math.abs(signedPct)}% ${signedPct > 0 ? "high" : "low"} against`;
    const rightClause = rightOnes.length
      ? `${joinLabels(rightOnes.map((t) => t.label))} ${rightOnes.length === 1 ? "was" : "were"} right; `
      : "";
    const sentence =
      `${rightClause}${dominant.label} you assumed (${withUnit(assumed, dominant.unit)}) is ${offBy} ` +
      `${withUnit(dominant.actual, dominant.unit)} — that gap alone moves ${label} by about ` +
      `${withUnit(Math.abs(dominant.influence), unit)}.`;
    return { sentence: capitalize(sentence), dominantTerm: dominant.term, direction };
  }

  const percentError = actual === 0 ? null : Math.abs(round(((predicted - actual) / Math.abs(actual)) * 100, 1));
  const gap = percentError == null ? `${formatCallNumber(Math.abs(predicted - actual))}${unit}` : `${percentError}%`;
  const lever = strongest(termContributions);
  if (lever && Math.abs(lever.influence) > 0) {
    return {
      sentence: capitalize(
        `your ${label} came in ${gap} ${direction} (${withUnit(predicted, unit)} against ${withUnit(actual, unit)}). ` +
          `The term with the most leverage here is ${lever.label} — change that one alone and ${label} moves ` +
          `by about ${withUnit(Math.abs(lever.influence), unit)}, so check it first.`,
      ),
      dominantTerm: lever.term,
      direction,
    };
  }

  return {
    sentence: capitalize(
      `you called ${withUnit(predicted, unit)}; the math says ${withUnit(actual, unit)} — ${gap} ${direction}.`,
    ),
    dominantTerm: null,
    direction,
  };
}

// ---- misconception detection --------------------------------------------

export type MisconceptionCandidate = {
  id: string;
  /** The number this specific wrong method would have produced, from real inputs. */
  value: number;
  /** Plain explanation of the method the student used instead. */
  explanation: string;
};

/**
 * When a student's call lands on the number a *specific* wrong method produces
 * (the inverse ratio, the peak total instead of the typical one, the nearest
 * calibrated point instead of an interpolation), say so. Candidates are computed
 * from the team's own inputs, so a match is evidence, not a guess. Candidates
 * indistinguishable from the correct answer are ignored.
 */
export function detectMisconception(
  candidates: MisconceptionCandidate[],
  predicted: number,
  actual: number,
  tolerance = 0.02,
): MisconceptionCandidate | null {
  if (!Number.isFinite(predicted) || !Number.isFinite(actual)) return null;
  let best: { candidate: MisconceptionCandidate; distance: number } | null = null;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.value)) continue;
    // Cannot attribute a method that produces the right answer anyway.
    if (relativeDiff(candidate.value, actual) <= tolerance) continue;
    const distance = relativeDiff(predicted, candidate.value);
    if (distance > tolerance) continue;
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  return best?.candidate ?? null;
}

// ---- accuracy trend ------------------------------------------------------

export type PastCall = {
  closeness: Closeness | null;
  skipped: boolean;
  createdAt: string;
};

export type AccuracyTrend = {
  total: number;
  scored: number;
  skipped: number;
  spotOn: number;
  close: number;
  off: number;
  /** Mean score over scored calls, 0–1, null when nothing has been scored. */
  accuracy: number | null;
  direction: "improving" | "steady" | "slipping" | "unknown";
  headline: string;
};

const CLOSENESS_POINTS: Record<Closeness, number> = { "spot-on": 1, close: 0.5, off: 0 };

/**
 * Summarise a student's last N calls on one surface. Honest empty state: with
 * no calls there is no trend and we say so rather than showing a zeroed chart.
 * Calls arrive newest-first (the API orders by created_at DESC).
 */
export function summarizeAccuracyTrend(calls: PastCall[], limit = 5): AccuracyTrend {
  const recent = calls.slice(0, Math.max(0, limit));
  const scoredCalls = recent.filter((c) => !c.skipped && c.closeness != null);
  const spotOn = scoredCalls.filter((c) => c.closeness === "spot-on").length;
  const close = scoredCalls.filter((c) => c.closeness === "close").length;
  const off = scoredCalls.filter((c) => c.closeness === "off").length;
  const skipped = recent.filter((c) => c.skipped).length;
  const accuracy = scoredCalls.length
    ? Math.round((scoredCalls.reduce((sum, c) => sum + CLOSENESS_POINTS[c.closeness as Closeness], 0) / scoredCalls.length) * 100) / 100
    : null;

  let direction: AccuracyTrend["direction"] = "unknown";
  if (scoredCalls.length >= 4) {
    // Newest-first, so the first half is the *recent* half.
    const half = Math.floor(scoredCalls.length / 2);
    const newer = scoredCalls.slice(0, half);
    const older = scoredCalls.slice(scoredCalls.length - half);
    const mean = (rows: PastCall[]) => rows.reduce((s, c) => s + CLOSENESS_POINTS[c.closeness as Closeness], 0) / rows.length;
    const delta = mean(newer) - mean(older);
    direction = delta > 0.1 ? "improving" : delta < -0.1 ? "slipping" : "steady";
  }

  let headline: string;
  if (recent.length === 0) {
    headline = "No calls yet — your first prediction starts the trend.";
  } else if (scoredCalls.length === 0) {
    headline = `${skipped} skipped call${skipped === 1 ? "" : "s"} and nothing scored yet — call one to start the trend.`;
  } else {
    const parts = [`${spotOn} spot on`, `${close} close`, `${off} off`];
    const trailer =
      direction === "improving"
        ? " Trending better."
        : direction === "slipping"
          ? " Trending worse — worth a mentor look."
          : direction === "steady"
            ? " Holding steady."
            : "";
    headline = `Last ${scoredCalls.length} call${scoredCalls.length === 1 ? "" : "s"}: ${parts.join(", ")}.${trailer}`;
  }

  return { total: recent.length, scored: scoredCalls.length, skipped, spotOn, close, off, accuracy, direction, headline };
}

// ---- request validation --------------------------------------------------

export type LearningPredictionRecord = {
  surface: LearningSurface;
  inputs: Record<string, unknown>;
  predicted: Record<string, unknown>;
  actual: Record<string, unknown>;
  closeness: Closeness | null;
  skipped: boolean;
};

export type LearningPredictionAction = { orgId: string; record: LearningPredictionRecord };

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

export function isCloseness(value: unknown): value is Closeness {
  return value === "spot-on" || value === "close" || value === "off";
}

export function parseLearningPrediction(raw: unknown): LearningPredictionAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) throw new Error("orgId is required");
  if (!isLearningSurface(body.surface)) throw new Error("Unsupported learning surface");

  const skipped = body.skipped === true;
  const closeness = body.closeness === null || body.closeness === undefined ? null : body.closeness;
  if (!skipped && !isCloseness(closeness)) {
    throw new Error("A committed call needs a closeness of spot-on, close or off");
  }

  return {
    orgId,
    record: {
      surface: body.surface,
      inputs: asObject(body.inputs, "inputs"),
      predicted: asObject(body.predicted, "predicted"),
      actual: asObject(body.actual, "actual"),
      closeness: isCloseness(closeness) ? closeness : null,
      skipped,
    },
  };
}
