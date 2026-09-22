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
    if (direct) return { ok: true, ratings: ratingsFromScouting(direct), rows: direct, basis: "total" };
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

  return { ok: true, ratings: ratingsFromScouting(rows), rows, basis: hasPhases ? "phase" : "total" };
}

const DIRECT_TOTAL_KEYS = ["totalPoints", "total_points", "points", "score"] as const;
const DIRECT_AUTO_KEYS = ["autoPoints", "auto_points"] as const;

function directNumber(payload: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Rows from points the scouts recorded themselves. Null unless at least half
 * the entries carry a recorded total — a form that only sometimes has one is
 * not a basis for ranking. Auto is kept when recorded; the rest of the total
 * sits in teleop, because the form did not split it and inventing a split
 * would be making numbers up.
 */
export function directPointRows(entries: readonly ScoutEntryRow[]): ScoutedMatchRow[] | null {
  const withTotal = entries.filter((entry) => directNumber(entry.payload ?? {}, DIRECT_TOTAL_KEYS) != null);
  if (withTotal.length === 0 || withTotal.length * 2 < entries.length) return null;
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
      auto: totalPoints != null ? autoPoints : null,
      teleop: totalPoints != null ? totalPoints - (autoPoints ?? 0) : null,
    };
  });
}

export function isScoutedRatingsUnavailable(
  value: ScoutedRatingsResult,
): value is Extract<ScoutedRatingsResult, { ok: false }> {
  return value.ok === false;
}
