import { evaluateFormula, type FormulaExpression } from "@vantage/scouting";
import {
  ratingsFromScouting,
  type ScoutedMatchRow,
  type ScoutedTeamRating,
} from "@vantage/prediction-strategy";

/**
 * The bridge from "what our scouts wrote down" to "what the predictor can use".
 *
 * `packages/prediction-strategy` deliberately refuses to decide what a game
 * action is worth — the points for a fuel cell are in the manual and in the
 * team's own value formula, not in a model file. This module is where the
 * team's formula gets applied, and it is the only place that knows the shape
 * of a scouting payload.
 *
 * Without a formula there is no honest way to turn "4 fuel, climbed L2" into
 * points, so `scoutedRatingsForEvent` reports that instead of guessing. That
 * is a real product state, not a failure: defining the formula once is what
 * turns a weekend of tablets into score estimates at an event where no
 * official numbers exist.
 */

/** Formula names this looks for, in order, when grouping points by phase. */
const PHASE_FORMULA_NAMES = {
  auto: ["auto", "auto points", "autonomous", "auto_points"],
  teleop: ["teleop", "teleop points", "tele-op", "teleop_points"],
  endgame: ["endgame", "endgame points", "end game", "climb", "endgame_points"],
} as const;

/** A single formula covering the whole match, used when no phase split exists. */
const TOTAL_FORMULA_NAMES = ["total", "total points", "points", "match points", "value"];

export type OrgValueFormula = { name: string; expression: FormulaExpression };

export type ScoutEntryRow = {
  teamKey: string;
  matchKey: string;
  payload: Record<string, unknown>;
};

export type ScoutedRatingsResult =
  | { ok: true; ratings: ScoutedTeamRating[]; basis: "phase" | "total" }
  | { ok: false; reason: string; needsFormula: true };

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function pick(formulas: readonly OrgValueFormula[], names: readonly string[]): FormulaExpression | null {
  const byName = new Map(formulas.map((formula) => [normalise(formula.name), formula.expression]));
  for (const name of names) {
    const hit = byName.get(normalise(name));
    if (hit) return hit;
  }
  return null;
}

/**
 * True when the robot was recorded as not playing.
 *
 * Checked by key rather than by formula because "disabled" is a fact about the
 * match, not a quantity — and a disabled robot's formula output is zero
 * anyway, which on its own is indistinguishable from a robot that simply did
 * not score.
 */
function flag(payload: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (value === true) return true;
    if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  }
  return false;
}

const DISABLED_KEYS = ["disabled", "dead", "no_show", "broke_down"] as const;
const DEFENSE_KEYS = ["defense", "played_defense", "defence"] as const;
const CLIMB_KEYS = ["tower_level", "climb", "climb_level", "endgame_climb"] as const;

/** Did the robot climb? Null when nobody recorded anything either way. */
function climbed(payload: Record<string, unknown>): boolean | null {
  for (const key of CLIMB_KEYS) {
    const value = payload[key];
    if (value == null || value === "") continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "none" || text === "no" || text === "false" || text === "0") return false;
      return true;
    }
  }
  return null;
}

export function scoutedRowsFromEntries(
  entries: readonly ScoutEntryRow[],
  formulas: readonly OrgValueFormula[],
): ScoutedRatingsResult {
  const auto = pick(formulas, PHASE_FORMULA_NAMES.auto);
  const teleop = pick(formulas, PHASE_FORMULA_NAMES.teleop);
  const endgame = pick(formulas, PHASE_FORMULA_NAMES.endgame);
  const total = pick(formulas, TOTAL_FORMULA_NAMES);

  const hasPhases = auto != null || teleop != null || endgame != null;
  if (!hasPhases && total == null) {
    return {
      ok: false,
      needsFormula: true,
      reason:
        "Tell Vantage what your scouting fields are worth and it can estimate scores from them. Add a formula named Total points — or Auto, Teleop and Endgame — under Scouting formulas.",
    };
  }

  const rows: ScoutedMatchRow[] = entries.map((entry) => {
    const payload = entry.payload ?? {};
    const base: ScoutedMatchRow = {
      teamKey: entry.teamKey,
      matchKey: entry.matchKey,
      disabled: flag(payload, DISABLED_KEYS),
      defense: flag(payload, DEFENSE_KEYS),
      climbed: climbed(payload) ?? undefined,
    };
    if (hasPhases) {
      return {
        ...base,
        auto: auto ? evaluateFormula(auto, payload) : null,
        teleop: teleop ? evaluateFormula(teleop, payload) : null,
        endgame: endgame ? evaluateFormula(endgame, payload) : null,
      };
    }
    // One formula for the whole match: put it in teleop so the total is right.
    // The phase split is presentational, and claiming a split we were not
    // given would be inventing one.
    return { ...base, teleop: evaluateFormula(total!, payload) };
  });

  return { ok: true, ratings: ratingsFromScouting(rows), basis: hasPhases ? "phase" : "total" };
}

export function isScoutedRatingsUnavailable(
  value: ScoutedRatingsResult,
): value is Extract<ScoutedRatingsResult, { ok: false }> {
  return value.ok === false;
}
