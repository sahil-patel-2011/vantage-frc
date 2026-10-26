/**
 * A bounded nudge on top of a statistical match prediction.
 *
 * An LLM may only move the statistical forecast by a small, checked amount.
 * It never supplies the score. A missing, slow, or nonsense reply leaves the
 * statistical forecast untouched. The product keeps this path off unless a
 * held-out measurement says it helps — see `PREDICTION_AI_ENABLED`.
 */

import type { CategoryScores } from "./walk-forward";

/** Off unless a measured held-out run turns it on. Nothing in this repo has. */
export const PREDICTION_AI_ENABLED = false;

/**
 * Largest share of a category the adjustment may move, and a hard point cap.
 * Both are stated limits, not a fit. The tighter one wins.
 */
export const MAX_CATEGORY_DELTA_SHARE = 0.08;
export const MAX_CATEGORY_DELTA_POINTS = 6;
/** Win chance may move by at most this much after the totals change. */
export const MAX_WIN_PROBABILITY_SHIFT = 0.03;

export type CategoryDeltas = {
  auto?: unknown;
  teleop?: unknown;
  endgame?: unknown;
  foul?: unknown;
  /** Free text. Never parsed as a score. */
  note?: unknown;
};

export type AdjustmentResult = {
  red: CategoryScores;
  blue: CategoryScores;
  redWinProbability: number;
  applied: boolean;
  /** Why a field was ignored. Empty when the reply was used as sent. */
  rejected: string[];
  note: string | null;
};

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function clampDelta(statistical: number, requested: number): number {
  const shareCap = Math.abs(statistical) * MAX_CATEGORY_DELTA_SHARE;
  const cap = Math.min(MAX_CATEGORY_DELTA_POINTS, Math.max(shareCap, 0));
  if (requested > cap) return cap;
  if (requested < -cap) return -cap;
  return requested;
}

function shiftCategory(value: number | null, requested: unknown, label: string, rejected: string[]): number | null {
  if (value == null) return null;
  if (requested == null || requested === "") return value;
  const delta = finite(requested);
  if (delta == null) {
    rejected.push(`${label} was not a number`);
    return value;
  }
  // A model that echoes the whole score (far outside the cap) is ignored, not trusted.
  if (Math.abs(delta) > MAX_CATEGORY_DELTA_POINTS * 4) {
    rejected.push(`${label} looked like a full score, not a small adjustment`);
    return value;
  }
  const next = value + clampDelta(value, delta);
  return Math.max(0, Math.round(next * 10) / 10);
}

function retotal(side: CategoryScores): CategoryScores {
  if (side.auto == null || side.teleop == null || side.endgame == null || side.foul == null) return side;
  const total = Math.round((side.auto + side.teleop + side.endgame + side.foul) * 10) / 10;
  return { ...side, total };
}

/**
 * Apply a model's requested point deltas to both alliances.
 *
 * Totals are recomputed from the clamped pieces. The win chance moves only as
 * far as `MAX_WIN_PROBABILITY_SHIFT`, and only if the caller passes the
 * statistical probability plus the probability the new totals would imply.
 */
export function applyBoundedAdjustment(input: {
  red: CategoryScores;
  blue: CategoryScores;
  redWinProbability: number;
  /** Win chance implied by the adjusted totals. Ignored when the reply is rejected. */
  adjustedWinProbability?: number | null;
  redDeltas?: CategoryDeltas | null;
  blueDeltas?: CategoryDeltas | null;
}): AdjustmentResult {
  const rejected: string[] = [];
  const noteParts: string[] = [];
  for (const deltas of [input.redDeltas, input.blueDeltas]) {
    if (deltas && typeof deltas.note === "string" && deltas.note.trim()) noteParts.push(deltas.note.trim());
  }

  const applySide = (side: CategoryScores, deltas: CategoryDeltas | null | undefined, name: string): CategoryScores => {
    if (!deltas) return side;
    return retotal({
      auto: shiftCategory(side.auto, deltas.auto, `${name} auto`, rejected),
      teleop: shiftCategory(side.teleop, deltas.teleop, `${name} teleop`, rejected),
      endgame: shiftCategory(side.endgame, deltas.endgame, `${name} endgame`, rejected),
      foul: shiftCategory(side.foul, deltas.foul, `${name} foul`, rejected),
      total: side.total,
    });
  };

  const red = applySide(input.red, input.redDeltas, "red");
  const blue = applySide(input.blue, input.blueDeltas, "blue");
  const changed =
    red.total !== input.red.total ||
    blue.total !== input.blue.total ||
    red.auto !== input.red.auto ||
    blue.auto !== input.blue.auto ||
    red.teleop !== input.red.teleop ||
    blue.teleop !== input.blue.teleop ||
    red.endgame !== input.red.endgame ||
    blue.endgame !== input.blue.endgame;

  let redWinProbability = input.redWinProbability;
  if (changed && input.adjustedWinProbability != null && Number.isFinite(input.adjustedWinProbability)) {
    const shift = Math.min(
      MAX_WIN_PROBABILITY_SHIFT,
      Math.max(-MAX_WIN_PROBABILITY_SHIFT, input.adjustedWinProbability - input.redWinProbability),
    );
    redWinProbability = Math.min(0.98, Math.max(0.02, input.redWinProbability + shift));
  }

  return {
    red,
    blue,
    redWinProbability: Math.round(redWinProbability * 1000) / 1000,
    applied: changed,
    rejected,
    note: noteParts.length ? noteParts.join(" ").slice(0, 280) : null,
  };
}
