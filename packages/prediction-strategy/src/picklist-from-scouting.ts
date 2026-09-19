/**
 * The pick list, built from what your team watched.
 *
 * `zscore-picklist.ts` ranks robots by comparing each one to the field and
 * weighting those comparisons — sliders a team moves to say what it is looking
 * for. Good machinery. It was fed four numbers, all of them EPA: total, auto,
 * teleop and endgame.
 *
 * So a weekend of tablets changed nothing about the order. Every dimension
 * scouting exists to capture — whether the robot climbs, whether it plays
 * defense, whether it does the same thing every match, whether it survives the
 * match — was collected, stored, and then ignored at the one meeting it was
 * collected for. And at an off-season event or the first morning of week one,
 * where no EPA exists at all, the pick list had nothing to rank with.
 *
 * This is the bridge. It turns the profiles the Robots screen already shows
 * into the rows that ranking takes.
 *
 * ## Making "lower is better" work with sliders
 *
 * The ranking multiplies a z-score by a weight, so a positive weight always
 * means "more of this is better". Two of the things scouting measures are the
 * other way round — a robot that swings wildly and a robot that keeps dying
 * are both worse — and asking a student to type a negative weight to say "I
 * want a steady robot" is a trap. So they are inverted here into quantities
 * that read as goods:
 *
 *   consistency = 1 / (1 + dispersion)   1.0 is a metronome, ~0 is chaos
 *   reliability = 1 - disabledRate       the share of matches it finished
 *
 * Nothing is filled with a zero. A robot with no spread on record has no
 * consistency value and simply skips that term, the same way a robot with no
 * EPA skips the EPA terms — because "we have not measured this" and "this is
 * bad" are different facts and a pick list that confuses them is worse than
 * one with a gap in it.
 */

import { MIN_MATCHES_TO_STAND_ALONE } from "./scouting-rating";
import type { ScoutedTeamProfile } from "./scouting-profile";
import type { TeamMetricRow } from "./zscore-picklist";

/** Below this, a robot is listed but has no numbers worth ranking on. */
export const MIN_MATCHES_FOR_PICKLIST = MIN_MATCHES_TO_STAND_ALONE;

/** 1.0 for a robot that does the same thing every match. */
export function consistencyScore(dispersion: number | null | undefined): number | null {
  if (dispersion == null || !Number.isFinite(dispersion) || dispersion < 0) return null;
  return 1 / (1 + dispersion);
}

/** The share of watched matches the robot was not dead for. */
export function reliabilityScore(disabledRate: number | null | undefined): number | null {
  if (disabledRate == null || !Number.isFinite(disabledRate)) return null;
  return 1 - Math.min(1, Math.max(0, disabledRate));
}

/**
 * One robot's scouting, as ranking metrics.
 *
 * Returns null for a robot watched too few times to say anything about. It is
 * still on the list — `pickListRowsFromScouting` keeps it, scoreless — because
 * "nobody has watched 4414 yet" is a thing a pick-list meeting needs to see,
 * and dropping the row hides it.
 */
export function metricRowFromProfile(profile: ScoutedTeamProfile): TeamMetricRow {
  const thin = profile.matches < MIN_MATCHES_FOR_PICKLIST;
  if (thin) return { teamKey: profile.teamKey, values: {} };

  return {
    teamKey: profile.teamKey,
    values: {
      // The shrunk total, not the raw mean: three good matches should not
      // outrank a season of solid ones, which is what `shrinkage.ts` exists
      // to prevent and what ranking a raw average would undo.
      totalPoints: profile.shrunkTotal,
      autoPoints: profile.meanAuto,
      teleopPoints: profile.meanTeleop,
      endgameClimb: profile.climbRate,
      defenseEffectiveness: profile.defenseRate > 0 ? profile.defenseRate : null,
      consistency: consistencyScore(profile.consistency?.dispersion),
      reliability: reliabilityScore(profile.disabledRate),
    },
  };
}

export function pickListRowsFromScouting(
  profiles: readonly ScoutedTeamProfile[],
): TeamMetricRow[] {
  return profiles.map(metricRowFromProfile);
}

/**
 * Sensible opening weights for a list built from scouting.
 *
 * Not all-ones. A slider set that weights "total defensive time" as heavily as
 * "total points" produces an order nobody recognises, and a first impression
 * of a ranking that looks wrong is hard to recover from — the team turns the
 * feature off rather than tuning it.
 *
 * These say: scoring matters most, then whether the robot is the same robot
 * every match, then whether it survives, then the endgame. Defense is off by
 * default because wanting a defender is a specific decision, not a default,
 * and a team that wants one will reach for that slider first.
 */
export function scoutingPicklistWeights(): { id: keyof TeamMetricRow["values"]; weight: number }[] {
  return [
    { id: "totalPoints", weight: 1 },
    { id: "consistency", weight: 0.6 },
    { id: "reliability", weight: 0.6 },
    { id: "endgameClimb", weight: 0.4 },
    { id: "autoPoints", weight: 0.3 },
    { id: "teleopPoints", weight: 0 },
    { id: "defenseEffectiveness", weight: 0 },
  ];
}
