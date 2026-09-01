/**
 * Honest win-% display for Strategy / Briefing (UI imports later).
 *
 * Missing, DEMO, ungrounded, or non-finite predictions stay blank — never invent a %.
 * Probabilities are 0–1 (same as MatchPrediction / BriefingPrediction).
 */

const DEMO_RE = /\bdemo\b/i;
const UNGROUNDED_RE = /\bungrounded\b/i;

export type PredictionDisplayAlliance = "red" | "blue";

export type PredictionDisplayInput = {
  /** Alliance win probability in 0–1. */
  winProbability?: number | null;
  pRed?: number | null;
  pBlue?: number | null;
  alliance?: PredictionDisplayAlliance | null;
  modelVersion?: string | null;
  source?: string | null;
  /** Explicit false refuses the % even when numbers are present. */
  grounded?: boolean | null;
  caveats?: readonly string[] | null;
  status?: string | null;
};

export type PredictionWinDisplay = {
  /** 0–1 probability that passed the gates. */
  probability: number;
  /** Rounded 0–100 integer. */
  percent: number;
  /** e.g. "62%" */
  label: string;
};

function markTexts(input: PredictionDisplayInput): string[] {
  const marks = [input.modelVersion, input.source, input.status, ...(input.caveats ?? [])];
  return marks.filter((mark): mark is string => typeof mark === "string" && mark.trim() !== "");
}

/** DEMO in modelVersion / source / status / caveats — refuse even if numbers exist. */
export function isDemoPrediction(input: PredictionDisplayInput | null | undefined): boolean {
  if (!input) return false;
  return markTexts(input).some((mark) => DEMO_RE.test(mark));
}

/**
 * Ungrounded when `grounded === false` or a mark names itself ungrounded.
 * Omitted `grounded` is not a refusal by itself (compute-strategy has no such flag).
 */
export function isUngroundedPrediction(input: PredictionDisplayInput | null | undefined): boolean {
  if (!input) return true;
  if (input.grounded === false) return true;
  return markTexts(input).some((mark) => UNGROUNDED_RE.test(mark));
}

function resolveProbability(input: PredictionDisplayInput): number | null {
  if (input.winProbability != null) return Number(input.winProbability);
  if (input.alliance === "red" && input.pRed != null) return Number(input.pRed);
  if (input.alliance === "blue" && input.pBlue != null) return Number(input.pBlue);
  return null;
}

function finiteUnitProbability(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

/** 0–1 win probability, or null when the % must not be shown. */
export function predictionWinProbability(
  input: PredictionDisplayInput | null | undefined,
): number | null {
  if (!input) return null;
  if (isDemoPrediction(input) || isUngroundedPrediction(input)) return null;
  return finiteUnitProbability(resolveProbability(input));
}

/**
 * Win-% display object, or null.
 * DEMO / null / NaN / ungrounded → null (callers render an empty / "—" state).
 */
export function predictionWinDisplay(
  input: PredictionDisplayInput | null | undefined,
): PredictionWinDisplay | null {
  const probability = predictionWinProbability(input);
  if (probability == null) return null;
  const percent = Math.round(probability * 100);
  return { probability, percent, label: `${percent}%` };
}

/** `"62%"` or null — drop-in for Briefing / Strategy tiles. */
export function formatPredictionWinDisplay(
  input: PredictionDisplayInput | null | undefined,
): string | null {
  return predictionWinDisplay(input)?.label ?? null;
}
