import { evaluateFormula, type FormulaExpression } from "@vantage/scouting";
import {
  ratingsFromScouting,
  combineScoutedMatchRows,
  scoutedMatchTotal,
  type ScoutedMatchRow,
  type ScoutedTeamRating,
} from "@vantage/prediction-strategy";
import { matchOrderKey } from "./next-assignment";

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
  | {
      ok: true;
      ratings: ScoutedTeamRating[];
      /**
       * The per-match rows the ratings were built from.
       *
       * Carried alongside because `profilesFromScouting` needs the rows, not
       * the summary — a sparkline and a trend line cannot be recovered from an
       * average. Converting twice would mean two places that decide what a
       * scouting payload is worth.
       */
      rows: ScoutedMatchRow[];
      basis: "phase" | "total";
      /**
       * "formula": points from the team's own value formula. "recorded": the
       * points the scouts typed in themselves (no formula yet).
       */
      source?: "formula" | "recorded";
    }
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
    if (typeof value === "number" && value > 0) return true;
    // Forms answer yes/no as often as true/false; "yes" was read as "no".
    if (typeof value === "string" && /^(true|yes|y|1)$/i.test(value.trim())) return true;
  }
  return false;
}

/** Both spellings: forms built in the editor save camelCase keys. */
const DISABLED_KEYS = [
  "disabled",
  "dead",
  "no_show",
  "noShow",
  "broke_down",
  "brokeDown",
  "breakdown",
  "died",
  "tipped",
] as const;
const DEFENSE_KEYS = ["defense", "played_defense", "defence"] as const;
const CLIMB_KEYS = ["tower_level", "climb", "climb_level", "endgame_climb", "endgameClimb", "endgame"] as const;

/** Did the robot climb? Null when nobody recorded anything either way. */
function climbed(payload: Record<string, unknown>): boolean | null {
  for (const key of CLIMB_KEYS) {
    const value = payload[key];
    if (value == null || value === "") continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      // Parking is an endgame result, not a climb.
      if (["none", "no", "false", "0", "park", "parked", "fell", "failed"].includes(text)) return false;
      return true;
    }
  }
  return null;
}

/** Ranking never turns a missing answer, malformed formula or division by zero into points. */
export function observedFormulaValue(expression: FormulaExpression | null, payload: Record<string, unknown>): number | null {
  if (!expression || typeof expression !== "object") return null;
  if (expression.op === "constant") return Number.isFinite(expression.value) ? expression.value : null;
  if (expression.op === "field") {
    const value = payload[expression.field];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (!["add", "subtract", "multiply", "divide", "min", "max"].includes(expression.op) || !Array.isArray(expression.args) || !expression.args.length) return null;
  const values = expression.args.map(arg => observedFormulaValue(arg, payload));
  if (values.some(value => value == null) || (expression.op === "divide" && values.slice(1).some(value => value === 0))) return null;
  const value = evaluateFormula(expression, payload);
  return Number.isFinite(value) ? value : null;
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
    // No formula — but many forms have the scout record points directly
    // ("totalPoints: 59"). Those are not a guess about what an action is
    // worth; they are the number the scout wrote down, so use them as written.
    const direct = directPointRows(entries);
    if (direct) {
      return { ok: true, ratings: ratingsFromScouting(direct), rows: direct, basis: "total", source: "recorded" };
    }
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
      const phases = {
        auto: observedFormulaValue(auto, payload),
        teleop: observedFormulaValue(teleop, payload),
        endgame: observedFormulaValue(endgame, payload),
      };
      const missing = (auto && phases.auto == null) || (teleop && phases.teleop == null) || (endgame && phases.endgame == null);
      return {
        ...base,
        ...phases,
        total: total ? observedFormulaValue(total, payload) : missing ? null : (phases.auto ?? 0) + (phases.teleop ?? 0) + (phases.endgame ?? 0),
      };
    }
    return { ...base, total: observedFormulaValue(total, payload) };
  });

  return {
    ok: true,
    ratings: ratingsFromScouting(rows),
    rows,
    basis: hasPhases ? "phase" : "total",
    source: "formula",
  };
}

export const DIRECT_TOTAL_KEYS = ["totalPoints", "total_points", "totalScore", "points", "score"] as const;
const DIRECT_AUTO_KEYS = ["autoPoints", "auto_points"] as const;
const DIRECT_TELEOP_KEYS = ["teleopPoints", "teleop_points"] as const;
const DIRECT_ENDGAME_KEYS = ["endgamePoints", "endgame_points"] as const;

function directNumber(payload: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Rows from points the scouts recorded themselves. A missing total stays null.
 * Recorded phase points remain independent; a total never becomes a teleop estimate.
 */
export function directPointRows(entries: readonly ScoutEntryRow[]): ScoutedMatchRow[] | null {
  const withTotal = entries.filter((entry) => directNumber(entry.payload ?? {}, DIRECT_TOTAL_KEYS) != null);
  if (withTotal.length === 0) return null;
  return entries.map((entry) => {
    const payload = entry.payload ?? {};
    const totalPoints = directNumber(payload, DIRECT_TOTAL_KEYS);
    const autoPoints = directNumber(payload, DIRECT_AUTO_KEYS);
    return {
      teamKey: entry.teamKey,
      matchKey: entry.matchKey,
      disabled: flag(payload, DISABLED_KEYS),
      defense: flag(payload, DEFENSE_KEYS),
      climbed: climbed(payload) ?? undefined,
      total: totalPoints,
      auto: autoPoints,
      teleop: directNumber(payload, DIRECT_TELEOP_KEYS),
      endgame: directNumber(payload, DIRECT_ENDGAME_KEYS),
    };
  });
}

export function isScoutedRatingsUnavailable(
  value: ScoutedRatingsResult,
): value is Extract<ScoutedRatingsResult, { ok: false }> {
  return value.ok === false;
}

/** Match order: Qual 2 before Qual 10, quals before playoffs; unknown keys last, by text. */
export function compareMatchOrder(a: string, b: string): number {
  const left = matchOrderKey(a);
  const right = matchOrderKey(b);
  if (left && right) return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  if (left) return -1;
  if (right) return 1;
  return a.localeCompare(b);
}

/**
 * One row per robot per match, in match order.
 *
 * Every screen that shows "our scouting" for a robot starts here, so two
 * scouts on one robot count once and the same way everywhere: each phase is
 * the average of what they recorded; the robot counts as disabled when at
 * least half of them said so; observed points remain recorded; defense or a climb counts
 * when anyone saw it. Rows come back sorted by match (Qual 2 before Qual 10),
 * which is what a trend or a sparkline needs; sorting by the key's text put
 * Qual 10-19 before Qual 2.
 */
export function onePerMatch(rows: readonly ScoutedMatchRow[]): ScoutedMatchRow[] {
  const merged = combineScoutedMatchRows(rows);
  return merged.sort(
    (a, b) => compareMatchOrder(a.matchKey, b.matchKey) || a.teamKey.localeCompare(b.teamKey),
  );
}

/** Keep observed points when a robot broke down partway through the match. */
export function matchRowTotal(row: ScoutedMatchRow): number | null {
  return scoutedMatchTotal(row);
}
