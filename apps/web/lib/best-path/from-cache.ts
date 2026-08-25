/**
 * Turns cached TBA rows (matches_ref / team_event_metrics) into the pure inputs
 * the Best Path simulator takes. Pure — the caller does the SQL.
 *
 * Everything here refuses to guess: a team with no record and no official
 * ranking points is excluded from the projection and reported by name, and a
 * match whose six robots do not all have a rating gets no prediction at all.
 */

import type { AllianceOutcome, RankingPointRules, RemainingMatch, StandingTeam } from "./types";
import { bankedRankingPoints } from "./simulate";

/** Alliance jsonb as written by the reference worker, plus TBA's raw shapes. */
export function allianceTeamKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["teamKeys", "team_keys"]) {
    const list = record[key];
    if (Array.isArray(list)) return list.filter((item): item is string => typeof item === "string");
  }
  return [];
}

const RP_ALIASES = ["rp", "rankingPoints", "ranking_points"] as const;

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function allianceRankingPoints(
  breakdown: Record<string, unknown> | null | undefined,
  side: "red" | "blue",
): number | null {
  if (!breakdown) return null;
  const alliance = breakdown[side];
  if (!alliance || typeof alliance !== "object") return null;
  for (const alias of RP_ALIASES) {
    const value = numeric((alliance as Record<string, unknown>)[alias]);
    if (value != null) return value;
  }
  return null;
}

export type PlayedMatchRow = {
  matchKey: string;
  redAlliance: unknown;
  blueAlliance: unknown;
  scoreBreakdown?: Record<string, unknown> | null;
};

/**
 * Sums the official per-alliance ranking points TBA published for played quals.
 * These already include this season's bonus RPs, so they beat any record-derived
 * estimate — but only when every ranked team is covered (see buildStandings).
 */
export function rankingPointsFromPlayedMatches(rows: PlayedMatchRow[]): {
  byTeam: Record<string, number>;
  matchesWithRankingPoints: number;
} {
  const byTeam: Record<string, number> = {};
  let matchesWithRankingPoints = 0;
  for (const row of rows) {
    const red = allianceRankingPoints(row?.scoreBreakdown, "red");
    const blue = allianceRankingPoints(row?.scoreBreakdown, "blue");
    if (red == null && blue == null) continue;
    matchesWithRankingPoints += 1;
    const sides: Array<[number | null, string[]]> = [
      [red, allianceTeamKeys(row.redAlliance)],
      [blue, allianceTeamKeys(row.blueAlliance)],
    ];
    for (const [points, teamKeys] of sides) {
      if (points == null) continue;
      for (const teamKey of teamKeys) byTeam[teamKey] = (byTeam[teamKey] ?? 0) + points;
    }
  }
  return { byTeam, matchesWithRankingPoints };
}

export type MetricRow = {
  teamKey: string;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
};

export type StandingsBuild = {
  standings: StandingTeam[];
  rankingPointSource: "official" | "record";
  /** Teams with a metrics row but nothing to project from — named, never zeroed. */
  excludedTeams: string[];
};

export function buildStandings(
  rows: MetricRow[],
  officialRankingPoints: Record<string, number> | null,
  rules: RankingPointRules,
): StandingsBuild {
  const usable = rows.filter((row) => row && typeof row.teamKey === "string" && row.teamKey);
  const officialCoversEveryone =
    !!officialRankingPoints &&
    usable.length > 0 &&
    usable.every((row) => officialRankingPoints[row.teamKey] != null);

  const standings: StandingTeam[] = [];
  const excludedTeams: string[] = [];
  for (const row of usable) {
    const banked = bankedRankingPoints({
      officialRankingPoints: officialCoversEveryone ? officialRankingPoints[row.teamKey] : null,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      rules,
    });
    if (!banked) {
      excludedTeams.push(row.teamKey);
      continue;
    }
    standings.push({
      teamKey: row.teamKey,
      rankingPoints: banked.rankingPoints,
      played: banked.played,
      currentRank: row.rank ?? null,
    });
  }
  return {
    standings,
    rankingPointSource: officialCoversEveryone ? "official" : "record",
    excludedTeams: excludedTeams.sort(),
  };
}

export type RatingMap = Record<string, number | null | undefined>;

/**
 * Predicts a winner only when every robot on both alliances has a cached rating.
 * An exact tie in modelled strength is NOT called a tie result — it is no call.
 */
export function predictedOutcomeFromRatings(
  red: string[],
  blue: string[],
  ratings: RatingMap,
): { predicted: AllianceOutcome | null; redRating: number | null; blueRating: number | null } {
  const total = (teamKeys: string[]): number | null => {
    if (!teamKeys.length) return null;
    let sum = 0;
    for (const teamKey of teamKeys) {
      const value = ratings[teamKey];
      if (value == null || !Number.isFinite(value)) return null;
      sum += Number(value);
    }
    return sum;
  };
  const redRating = total(red);
  const blueRating = total(blue);
  if (redRating == null || blueRating == null) {
    return { predicted: null, redRating, blueRating };
  }
  if (redRating === blueRating) return { predicted: null, redRating, blueRating };
  return { predicted: redRating > blueRating ? "red" : "blue", redRating, blueRating };
}

export type RemainingMatchRow = {
  matchKey: string;
  matchNumber: number;
  redAlliance: unknown;
  blueAlliance: unknown;
};

export type BuiltRemainingMatch = RemainingMatch & {
  redRating: number | null;
  blueRating: number | null;
};

export function buildRemainingMatches(
  rows: RemainingMatchRow[],
  ratings: RatingMap,
): BuiltRemainingMatch[] {
  return rows
    .filter((row) => row && typeof row.matchKey === "string" && row.matchKey)
    .map((row) => {
      const red = allianceTeamKeys(row.redAlliance);
      const blue = allianceTeamKeys(row.blueAlliance);
      const { predicted, redRating, blueRating } = predictedOutcomeFromRatings(red, blue, ratings);
      return {
        matchKey: row.matchKey,
        matchNumber: Number(row.matchNumber) || 0,
        red,
        blue,
        predicted,
        redRating,
        blueRating,
      };
    })
    .sort((a, b) =>
      a.matchNumber !== b.matchNumber ? a.matchNumber - b.matchNumber : a.matchKey < b.matchKey ? -1 : 1,
    );
}
