// Pure, unit-testable helpers for scout accuracy scoring. No I/O, no framework imports.

import type {
  ScoutAccuracyAlliance,
  ScoutAccuracyEntry,
  ScoutAccuracyScoutStat,
  ScoutAccuracySummary,
  ScoutAccuracyTier,
} from "./types";

/** Aliases a scout payload (or a TBA score_breakdown alliance) may use for total points scored. */
const TOTAL_POINTS_ALIASES = ["totalPoints", "total_points", "totalScore", "points"];

/** A total-points estimate agrees within this fraction (or this many absolute points) of official. */
const AGREEMENT_TOLERANCE_PCT = 0.15;
const AGREEMENT_TOLERANCE_ABS = 6;

/** Minimum verifiable entries and accuracy score to be suggested for pick-desk rotation. */
export const PROMOTE_MIN_ENTRIES = 3;
export const PROMOTE_MIN_ACCURACY_SCORE = 75;

type AllianceValue = { team_keys?: string[] } | string[] | null | undefined;

export function teamKeysFromAlliance(value: AllianceValue): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (value && Array.isArray(value.team_keys)) {
    return value.team_keys.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export function resolveAllianceColor(
  teamKey: string,
  redAlliance: AllianceValue,
  blueAlliance: AllianceValue,
): ScoutAccuracyAlliance | null {
  if (teamKeysFromAlliance(redAlliance).includes(teamKey)) return "red";
  if (teamKeysFromAlliance(blueAlliance).includes(teamKey)) return "blue";
  return null;
}

function numberFromRecord(record: Record<string, unknown> | null | undefined, aliases: string[]): number | null {
  if (!record) return null;
  for (const key of aliases) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}

/**
 * Computes one entry's accuracy: the scout's reported totalPoints estimate checked against the
 * official alliance total from the cached TBA score_breakdown. Pure — takes already-fetched data.
 */
export function computeEntryAccuracy(input: {
  matchScoutEntryId: string;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  teamNumber: number | null;
  scoutUserId: string;
  scoutName: string;
  payload: Record<string, unknown> | null | undefined;
  scoreBreakdown: Record<string, unknown> | null | undefined;
  redAlliance: AllianceValue;
  blueAlliance: AllianceValue;
}): ScoutAccuracyEntry {
  const allianceColor = resolveAllianceColor(input.teamKey, input.redAlliance, input.blueAlliance);
  const scoutValue = numberFromRecord(input.payload, TOTAL_POINTS_ALIASES);
  const allianceBreakdown =
    input.scoreBreakdown && allianceColor && typeof input.scoreBreakdown[allianceColor] === "object"
      ? (input.scoreBreakdown[allianceColor] as Record<string, unknown>)
      : null;
  const officialValue = numberFromRecord(allianceBreakdown, TOTAL_POINTS_ALIASES);

  const verifiable = scoutValue != null && officialValue != null;
  let absErrorPct: number | null = null;
  let accurate = false;
  if (verifiable && scoutValue != null && officialValue != null) {
    const deltaAbs = Math.abs(scoutValue - officialValue);
    absErrorPct = officialValue !== 0 ? deltaAbs / Math.abs(officialValue) : deltaAbs > 0 ? 1 : 0;
    accurate = deltaAbs <= AGREEMENT_TOLERANCE_ABS || absErrorPct <= AGREEMENT_TOLERANCE_PCT;
  }

  return {
    matchScoutEntryId: input.matchScoutEntryId,
    eventKey: input.eventKey,
    matchKey: input.matchKey,
    teamKey: input.teamKey,
    teamNumber: input.teamNumber,
    scoutUserId: input.scoutUserId,
    scoutName: input.scoutName,
    allianceColor,
    scoutValue,
    officialValue,
    absErrorPct,
    accurate,
    verifiable,
  };
}

function tierFromScore(entriesScored: number, verifiableEntries: number, accuracyScore: number): ScoutAccuracyTier {
  if (verifiableEntries === 0) return "unverified";
  if (entriesScored >= PROMOTE_MIN_ENTRIES && accuracyScore >= PROMOTE_MIN_ACCURACY_SCORE) return "lead";
  if (accuracyScore >= 55) return "core";
  return "developing";
}

/**
 * Aggregates per-entry accuracy into a ranked per-scout leaderboard. `promotedIds` carries any
 * coach-confirmed rotation overrides so `promoted` reflects persisted state, not just the suggestion.
 */
export function aggregateScoutStats(
  entries: ScoutAccuracyEntry[],
  promotedIds: Set<string> = new Set(),
): ScoutAccuracyScoutStat[] {
  const byScout = new Map<string, { name: string; entries: ScoutAccuracyEntry[] }>();
  for (const entry of entries) {
    const existing = byScout.get(entry.scoutUserId);
    if (existing) {
      existing.entries.push(entry);
    } else {
      byScout.set(entry.scoutUserId, { name: entry.scoutName, entries: [entry] });
    }
  }

  const stats: ScoutAccuracyScoutStat[] = Array.from(byScout.entries()).map(([scoutUserId, { name, entries: scoutEntries }]) => {
    const entriesScored = scoutEntries.length;
    const verifiable = scoutEntries.filter((e) => e.verifiable);
    const verifiableEntries = verifiable.length;
    const accurateEntries = verifiable.filter((e) => e.accurate).length;
    const accuracyRate = verifiableEntries > 0 ? accurateEntries / verifiableEntries : 0;
    const avgAbsErrorPct =
      verifiableEntries > 0
        ? verifiable.reduce((sum, e) => sum + (e.absErrorPct ?? 0), 0) / verifiableEntries
        : null;
    const accuracyScore =
      verifiableEntries > 0 ? Math.max(0, Math.min(100, Math.round((1 - Math.min(1, avgAbsErrorPct ?? 1)) * 100))) : 0;
    const suggestedPromote = entriesScored >= PROMOTE_MIN_ENTRIES && accuracyScore >= PROMOTE_MIN_ACCURACY_SCORE;
    const tier = tierFromScore(entriesScored, verifiableEntries, accuracyScore);

    return {
      scoutUserId,
      scoutName: name,
      entriesScored,
      verifiableEntries,
      accurateEntries,
      accuracyRate,
      avgAbsErrorPct,
      accuracyScore,
      rank: 0,
      tier,
      suggestedPromote,
      promoted: promotedIds.has(scoutUserId),
    };
  });

  stats.sort((a, b) => b.accuracyScore - a.accuracyScore || b.entriesScored - a.entriesScored);
  stats.forEach((stat, index) => {
    stat.rank = index + 1;
  });
  return stats;
}

export function summarizeScoutAccuracy(entries: ScoutAccuracyEntry[], stats: ScoutAccuracyScoutStat[]): ScoutAccuracySummary {
  const totalEntries = entries.length;
  const verifiableEntries = entries.filter((e) => e.verifiable).length;
  const totalScouts = stats.length;
  const scoredStats = stats.filter((s) => s.verifiableEntries > 0);
  const avgAccuracyScore =
    scoredStats.length > 0
      ? Math.round(scoredStats.reduce((sum, s) => sum + s.accuracyScore, 0) / scoredStats.length)
      : 0;
  const suggestedPromotions = stats.filter((s) => s.suggestedPromote).length;
  return { totalEntries, verifiableEntries, totalScouts, avgAccuracyScore, suggestedPromotions };
}

export function scoutAccuracyTierLabel(tier: ScoutAccuracyTier): string {
  if (tier === "lead") return "Pick-desk ready";
  if (tier === "core") return "Reliable";
  if (tier === "developing") return "Developing";
  return "Unverified";
}
