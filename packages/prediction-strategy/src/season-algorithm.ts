/**
 * Which maths runs for which game.
 *
 * FRC changes the game every January, and the arithmetic that predicted last
 * year's well can be wrong for this year's in ways no amount of retuning fixes.
 * A game with one big endgame scoring moment produces lopsided margins that a
 * game of steady cycling never does, and the win curve that fits one is the
 * wrong shape for the other.
 *
 * Until now the engine was chosen by what the team had paid for, which has
 * nothing to do with which game is being played, and every constant in it was
 * written once for a game that is now several years old.
 *
 * So: algorithms are registered against the season they take effect from, and a
 * season with no entry of its own inherits the most recent one before it. When
 * a new game lands, adding one row here is the whole change — no caller moves,
 * and last season's predictions keep reproducing exactly as they did, because
 * their row never changed.
 *
 * The fitted scale on each row is a measurement, not a preference. It comes
 * from `fitLogisticScale` over that season's finished matches, and a row whose
 * `logisticScale` is null has not been measured yet and says so.
 */

import { DEFAULT_LOGISTIC_SCALE } from "./calibration";
import { DEFAULT_SHRINKAGE_MATCHES } from "./shrinkage";

export type SeasonAlgorithm = {
  /** Takes effect from this season, and holds until a later row supersedes it. */
  fromSeason: number;
  id: string;
  label: string;
  /**
   * Win-curve scale measured over this game's matches, or null when nobody has
   * measured it yet. Null means fall back, and means saying so out loud.
   */
  logisticScale: number | null;
  /** How many matches the measurement rests on. Zero when unmeasured. */
  fittedFrom: number;
  /** Pull small samples toward the field. Off only for a game where it misfires. */
  shrinkage: boolean;
  /** Stated prior for the pull when the field cannot support a measurement. */
  shrinkageFallbackMatches: number;
  /** What is different about this game, for anyone reading the numbers later. */
  notes: string;
};

/**
 * Registered algorithms, oldest first.
 *
 * Deliberately a plain table. A registry with runtime mutation would let two
 * parts of the product disagree about which maths ran for a match, and a stored
 * prediction that cannot be reproduced is worse than no stored prediction.
 */
export const SEASON_ALGORITHMS: readonly SeasonAlgorithm[] = [
  {
    fromSeason: 2000,
    id: "legacy-fixed-v1",
    label: "Legacy fixed curve",
    // The number that was hardcoded in the engine for years. Preserved exactly
    // so predictions stored before any of this reproduce to the digit.
    logisticScale: DEFAULT_LOGISTIC_SCALE,
    fittedFrom: 0,
    shrinkage: false,
    shrinkageFallbackMatches: DEFAULT_SHRINKAGE_MATCHES,
    notes:
      "The original curve. Its scale was a guess, never measured, and small samples were trusted as much as large ones.",
  },
  {
    fromSeason: 2026,
    id: "measured-v1",
    label: "Measured curve with small-sample correction",
    // Not yet measured for this game. It will be, from this season's own
    // results; until then the fallback is used and the product says so rather
    // than presenting an unmeasured number as a measured one.
    logisticScale: null,
    fittedFrom: 0,
    shrinkage: true,
    shrinkageFallbackMatches: DEFAULT_SHRINKAGE_MATCHES,
    notes:
      "Fits the win curve to this season's finished matches instead of assuming it, and pulls thin records toward the field so a two-match leader cannot top a pick list.",
  },
];

export type ResolvedAlgorithm = SeasonAlgorithm & {
  /** The scale actually used, after falling back if unmeasured. */
  effectiveScale: number;
  /** True when `effectiveScale` is a measurement rather than a fallback. */
  scaleMeasured: boolean;
  /** The season asked for, which may be later than `fromSeason`. */
  requestedSeason: number;
  /** True when this row is being used for a season it was not written for. */
  inherited: boolean;
};

/**
 * The algorithm for a season.
 *
 * Inherits forward, never backward: a 2028 season with no row of its own runs
 * the newest registered maths, which is the right default for a game nobody has
 * tuned for yet. Asking for a season before the first row returns the first row
 * rather than throwing — a team with 1997 data deserves a prediction, flagged.
 */
export function algorithmForSeason(season: number): ResolvedAlgorithm {
  const year = Number.isFinite(season) ? Math.trunc(season) : new Date().getUTCFullYear();
  let chosen = SEASON_ALGORITHMS[0]!;
  for (const candidate of SEASON_ALGORITHMS) {
    if (candidate.fromSeason <= year) chosen = candidate;
  }
  return {
    ...chosen,
    requestedSeason: year,
    inherited: chosen.fromSeason !== year,
    effectiveScale: chosen.logisticScale ?? DEFAULT_LOGISTIC_SCALE,
    scaleMeasured: chosen.logisticScale != null && chosen.fittedFrom > 0,
  };
}

/** The newest registered algorithm, for "what would a new season get". */
export function newestAlgorithm(): SeasonAlgorithm {
  return SEASON_ALGORITHMS[SEASON_ALGORITHMS.length - 1]!;
}

/**
 * A sentence for the panel, so nobody has to take the number on faith.
 *
 * Says plainly when a scale is a fallback. A measured curve and an assumed one
 * deserve different amounts of trust, and only one of them has earned any.
 */
export function algorithmProvenance(resolved: ResolvedAlgorithm): string {
  const base = resolved.scaleMeasured
    ? `Win curve measured from ${resolved.fittedFrom} finished matches of this game.`
    : "Win curve not measured for this game yet — using the long-standing default.";
  const inherited = resolved.inherited
    ? ` Running the ${resolved.fromSeason} maths, which is the newest written for a game like this one.`
    : "";
  const shrink = resolved.shrinkage
    ? " Thin records are pulled toward the field."
    : " Every record is taken at face value, however few matches it rests on.";
  return `${base}${inherited}${shrink}`;
}
