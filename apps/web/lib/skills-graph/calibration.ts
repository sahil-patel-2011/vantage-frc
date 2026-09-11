// Calibration signals: "Call Your Shot" prediction accuracy feeding the skills graph.
//
// Per docs/archive/AI_MENTOR_CONCEPT.md, per-concept prediction-error rows
// (learning_predictions, 0452) feed compute-skills-graph.ts — as EVIDENCE.
// A calibration signal never changes anyone's proficiency by itself: under
// "every mastery claim is a draft until a human countersigns", a strong signal
// may PROPOSE a skills_graph_entries row for a mentor to accept, and it must
// never write one. Weak or thin signals say "not enough graded calls yet"
// instead of scoring anybody.
//
// Pure module: no DB, no React, no I/O. compute-skills-graph.ts supplies the
// aggregated rows (fetched under RLS, so a student only ever sees their own).

import type { LearningSurface } from "../learning/learning-mode";
import { isLearningSurface, learningSurfaceLabel } from "../learning/learning-mode";
import type { ProficiencyLevel, SkillCategory } from "./types";

/**
 * Which skill category each learning surface is evidence FOR. Deliberately
 * conservative: the gearbox calculator exercises reduction/ratio reasoning
 * (mechanical design), the power budget exercises electrical loads, and the
 * shooter table exercises shooter tuning.
 */
export const CALIBRATION_SURFACE_CATEGORY: Record<LearningSurface, SkillCategory> = {
  gearbox: "mechanical_design",
  power_budget: "electrical",
  shooter_table: "shooter",
};

/** Minimum graded calls on one surface before a proposal may exist at all. */
export const CALIBRATION_PROPOSAL_MIN_SCORED = 6;
/** Mean call score (spot-on = 1, close = 0.5, off = 0) required to propose. */
export const CALIBRATION_PROPOSAL_MIN_ACCURACY = 0.8;

export type CalibrationRow = {
  userId: string;
  userName: string | null;
  surface: string;
  scored: number;
  spotOn: number;
  close: number;
  off: number;
  skipped: number;
  lastCallAt: string | null;
};

export type CalibrationProposal = {
  skillCategory: SkillCategory;
  proficiency: ProficiencyLevel;
  /** Deterministic evidence sentence a mentor can countersign verbatim. */
  evidenceNote: string;
};

export type CalibrationSignal = {
  userId: string;
  userName: string;
  surface: LearningSurface;
  surfaceLabel: string;
  skillCategory: SkillCategory;
  scored: number;
  spotOn: number;
  close: number;
  off: number;
  skipped: number;
  /** Mean call score over graded calls, 0–1; null when nothing is graded. */
  accuracy: number | null;
  lastCallAt: string | null;
  /** Present ONLY above both thresholds. Accepting it is a human's decision. */
  proposal: CalibrationProposal | null;
  /** Honest one-liner: what this signal is, or why it is not scored yet. */
  note: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Fold per-user-per-surface aggregates into calibration signals. Rows with an
 * unknown surface are dropped (they cannot exist under the 0452 CHECK, but a
 * fold never guesses). Sorted: strongest evidence first, thin samples last.
 */
export function buildCalibrationSignals(rows: CalibrationRow[]): CalibrationSignal[] {
  const signals: CalibrationSignal[] = [];
  for (const row of rows) {
    if (!isLearningSurface(row.surface)) continue;
    const surface = row.surface;
    const scored = Math.max(0, Math.floor(row.scored));
    const accuracy = scored > 0 ? round2((row.spotOn + 0.5 * row.close) / scored) : null;
    const skillCategory = CALIBRATION_SURFACE_CATEGORY[surface];
    const surfaceLabel = learningSurfaceLabel(surface);
    const userName = row.userName?.trim() || "Unnamed member";

    let proposal: CalibrationProposal | null = null;
    let note: string;
    if (scored < CALIBRATION_PROPOSAL_MIN_SCORED) {
      note = `Not enough graded calls yet — ${scored} of ${CALIBRATION_PROPOSAL_MIN_SCORED} needed on ${surfaceLabel.toLowerCase()} before calibration proposes anything.`;
    } else if (accuracy != null && accuracy >= CALIBRATION_PROPOSAL_MIN_ACCURACY) {
      proposal = {
        skillCategory,
        proficiency: "proficient",
        evidenceNote:
          `Call Your Shot calibration: ${scored} graded calls on ${surfaceLabel.toLowerCase()} ` +
          `(${row.spotOn} spot on, ${row.close} close, ${row.off} off; mean score ${accuracy}). ` +
          `Proposed by the calibration signal; countersigned by a mentor.`,
      };
      note = `${scored} graded calls at mean score ${accuracy} — strong enough to propose a ${surfaceLabel.toLowerCase()} skill entry for a mentor to countersign.`;
    } else {
      note = `${scored} graded calls at mean score ${accuracy ?? 0} on ${surfaceLabel.toLowerCase()} — evidence only, below the ${CALIBRATION_PROPOSAL_MIN_ACCURACY} proposal bar.`;
    }

    signals.push({
      userId: row.userId,
      userName,
      surface,
      surfaceLabel,
      skillCategory,
      scored,
      spotOn: row.spotOn,
      close: row.close,
      off: row.off,
      skipped: row.skipped,
      accuracy,
      lastCallAt: row.lastCallAt,
      proposal,
      note,
    });
  }

  return signals.sort((a, b) => {
    if ((a.proposal != null) !== (b.proposal != null)) return a.proposal ? -1 : 1;
    if (a.scored !== b.scored) return b.scored - a.scored;
    return (b.lastCallAt ?? "").localeCompare(a.lastCallAt ?? "");
  });
}
