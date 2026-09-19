/**
 * What a strategy lead is actually asking when they open a scouting table.
 *
 * Not "what does this robot average" — that number alone has lost alliances.
 * Two robots averaging 30 are different robots if one scores 28-32 every match
 * and the other scores 5 or 55 depending on the day, and the second one is the
 * reason you lose a semifinal. The questions that decide a pick are:
 *
 *   - How much does it score?            → the mean, shrunk toward the field
 *   - Can I rely on that?                → spread, and how often it dies
 *   - Is it better than the alternatives? → a percentile, not a raw number
 *   - Is it getting better or worse?     → early matches against late ones
 *   - How much of this do I believe?     → how many matches it rests on
 *
 * This turns `ScoutedTeamRating` into the answers, and every one of them is
 * computed from rows a person on the team actually watched. Nothing is
 * modelled, estimated from elsewhere, or filled in when the data is thin — a
 * team with three matches gets `trend: null`, not a trend line drawn through
 * three points.
 */

import { summariseDistribution, type Distribution } from "./distribution";
import {
  MIN_MATCHES_TO_STAND_ALONE,
  type ScoutedMatchRow,
  type ScoutedTeamRating,
  ratingsFromScouting,
} from "./scouting-rating";

export type TrendDirection = "up" | "down" | "flat";

export type ScoutedTeamProfile = ScoutedTeamRating & {
  /**
   * Match-to-match spread, from `summariseDistribution`.
   *
   * This deliberately reuses the existing model rather than adding a second
   * one. That model measures spread as the interquartile range over the
   * median, which is the right choice here: a six-to-twelve match sample with
   * a breakdown in it has outliers by construction, and a standard deviation
   * over a mean lets one towed-off match rewrite the robot's character. It
   * also already knows to say "unknown" rather than guess from three matches.
   */
  consistency: Distribution | null;
  /** Where the shrunk total sits in this field, 0–100. Null with no field. */
  percentile: number | null;
  /** Later matches against earlier ones. Null until there are enough to split. */
  trend: { delta: number; direction: TrendDirection; note: string } | null;
  /** Per-match totals in match order, for a sparkline. */
  series: number[];
  /** One line naming the thing a pick-list reader should know first. */
  headline: string;
};

/** Below this, splitting the matches in half compares noise with noise. */
export const MIN_MATCHES_FOR_TREND = 6;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Later half against earlier half.
 *
 * An odd number of matches drops the middle one rather than putting it in both
 * halves, so a six-match and a seven-match team are compared the same way.
 */
function trendFor(series: readonly number[]): ScoutedTeamProfile["trend"] {
  if (series.length < MIN_MATCHES_FOR_TREND) return null;
  const half = Math.floor(series.length / 2);
  const early = series.slice(0, half);
  const late = series.slice(series.length - half);
  const delta = round(mean(late) - mean(early));
  // Below a point either way is not a trend, it is rounding.
  const direction: TrendDirection = delta > 1 ? "up" : delta < -1 ? "down" : "flat";
  const note =
    direction === "up"
      ? `Scoring ${Math.abs(delta)} more per match than they were early on`
      : direction === "down"
        ? `Scoring ${Math.abs(delta)} less per match than they were early on`
        : "Scoring about the same as they were early on";
  return { delta, direction, note };
}

/**
 * Percentile by rank within this field, not by a normal curve nobody checked.
 *
 * A field of one has no percentile: being the only robot scouted says nothing
 * about how good you are, and 100 would be a lie.
 */
function percentiles(totals: readonly number[]): (value: number) => number | null {
  if (totals.length < 2) return () => null;
  const sorted = [...totals].sort((a, b) => a - b);
  return (value: number) => {
    const below = sorted.filter((entry) => entry < value).length;
    const equal = sorted.filter((entry) => entry === value).length;
    // Midpoint of the tie block, so identical teams share a percentile rather
    // than one of them arbitrarily outranking the other.
    return Math.round(((below + equal / 2) / sorted.length) * 100);
  };
}

function headlineFor(profile: Omit<ScoutedTeamProfile, "headline">): string {
  const number = profile.teamKey.replace(/^frc/, "");
  if (profile.matches < MIN_MATCHES_TO_STAND_ALONE) {
    const need = MIN_MATCHES_TO_STAND_ALONE - profile.matches;
    return `${number} — only ${profile.matches} match${profile.matches === 1 ? "" : "es"} scouted; ${need} more before this is worth ranking on`;
  }
  if (profile.disabledRate >= 0.25) {
    const pct = Math.round(profile.disabledRate * 100);
    return `${number} — dead on the field in ${pct}% of the matches we watched`;
  }
  // Trend is checked before spread on purpose. A robot that started at 10 and
  // finished at 31 has a wide spread by construction, and calling that
  // "swings a long way match to match" is the wrong story about a team that
  // fixed something on Friday night — which is exactly the team you want to
  // pick. Explained spread is not unpredictability.
  if (profile.trend && profile.trend.direction !== "flat") {
    return `${number} — ${profile.trend.note.toLowerCase()}`;
  }
  if (profile.consistency?.consistency === "boom-or-bust") {
    return `${number} — averages ${Math.round(profile.meanTotal)}, but swings a long way match to match`;
  }
  if (
    (profile.consistency?.consistency === "metronome" || profile.consistency?.consistency === "steady") &&
    profile.matches >= MIN_MATCHES_FOR_TREND
  ) {
    return `${number} — ${Math.round(profile.meanTotal)} a match, and does it every match`;
  }
  return `${number} — ${Math.round(profile.meanTotal)} a match across ${profile.matches} scouted`;
}

/**
 * Per-team profiles, strongest first.
 *
 * Takes the same rows as `ratingsFromScouting` so a caller does not have to
 * hold both, and reuses its shrinkage and deduplication rather than repeating
 * either.
 */
export function profilesFromScouting(rows: readonly ScoutedMatchRow[]): ScoutedTeamProfile[] {
  const ratings = ratingsFromScouting(rows);
  if (ratings.length === 0) return [];

  // Rebuild each team's ordered per-match totals. `ratingsFromScouting` already
  // decided which rows count and which are duplicates; match that exactly by
  // keeping the first row per (team, match) in input order.
  const seriesByTeam = new Map<string, number[]>();
  const seenMatch = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.teamKey) continue;
    const hasSignal = row.disabled || row.auto != null || row.teleop != null || row.endgame != null;
    if (!hasSignal) continue;
    const seen = seenMatch.get(row.teamKey) ?? new Set<string>();
    const key = row.matchKey || `${row.teamKey}:${seen.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seenMatch.set(row.teamKey, seen);
    const total = row.disabled ? 0 : (row.auto ?? 0) + (row.teleop ?? 0) + (row.endgame ?? 0);
    const list = seriesByTeam.get(row.teamKey) ?? [];
    list.push(total);
    seriesByTeam.set(row.teamKey, list);
  }

  const percentileOf = percentiles(ratings.map((rating) => rating.shrunkTotal));

  return ratings.map((rating) => {
    const series = seriesByTeam.get(rating.teamKey) ?? [];
    const base = {
      ...rating,
      consistency: summariseDistribution(series),
      percentile: percentileOf(rating.shrunkTotal),
      trend: trendFor(series),
      series,
    };
    return { ...base, headline: headlineFor(base) };
  });
}

/**
 * The teams worth a second look, in the order a pick-list meeting should take
 * them: strong and steady first, then strong and swingy, and never a robot
 * nobody has watched enough to rank.
 */
export function pickListOrder(profiles: readonly ScoutedTeamProfile[]): ScoutedTeamProfile[] {
  const rankable = profiles.filter((profile) => profile.matches >= MIN_MATCHES_TO_STAND_ALONE);
  const penalty = (profile: ScoutedTeamProfile): number => {
    // Both are expressed as a share of the robot's own output, so the sort
    // stays in one unit rather than trading points against percentages.
    const unreliability = Math.min(0.3, profile.disabledRate);
    // Only the widest band is penalised. "streaky" is most good robots.
    const swing = profile.consistency?.consistency === "boom-or-bust" ? 0.12 : 0;
    return profile.shrunkTotal * (unreliability + swing);
  };
  return [...rankable].sort(
    (a, b) =>
      b.shrunkTotal - penalty(b) - (a.shrunkTotal - penalty(a)) || a.teamKey.localeCompare(b.teamKey),
  );
}
