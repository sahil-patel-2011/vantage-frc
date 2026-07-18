// Pure helpers for the Robot Weigh-In log: labels + summary/trend computation. No I/O.

import type { RobotWeighInEntry, RobotWeighInStation, RobotWeighInSummary, RobotWeighInTrendPoint } from "./types";

export * from "./types";

export function robotWeighInStationLabel(station: RobotWeighInStation): string {
  switch (station) {
    case "shop":
      return "Shop scale";
    case "event_inspection":
      return "Event inspection";
    case "practice_field":
      return "Practice field";
    default:
      return "Other";
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Summarize weigh-in entries into a trend vs. the weight limit. Entries must already be
 * sorted newest-first (as returned by the compute layer's query). Returns zeroed fields
 * when there is no data — never fabricates a reading.
 */
export function summarizeRobotWeighIn(entries: RobotWeighInEntry[]): RobotWeighInSummary {
  if (entries.length === 0) {
    return {
      totalEntries: 0,
      latestWeightLbs: null,
      latestWeightLimitLbs: null,
      latestMarginLbs: null,
      minWeightLbs: null,
      maxWeightLbs: null,
      overLimitCount: 0,
      trend: [],
    };
  }

  const chronological = [...entries].sort((a, b) => a.weighedOn.localeCompare(b.weighedOn));
  const trend: RobotWeighInTrendPoint[] = chronological.map((entry) => ({
    weighedOn: entry.weighedOn,
    weightLbs: entry.weightLbs,
    marginLbs: round2(entry.weightLimitLbs - entry.weightLbs),
  }));

  const weights = entries.map((e) => e.weightLbs);
  const latest = entries[0]!;
  const overLimitCount = entries.filter((e) => e.weightLbs > e.weightLimitLbs).length;

  return {
    totalEntries: entries.length,
    latestWeightLbs: latest.weightLbs,
    latestWeightLimitLbs: latest.weightLimitLbs,
    latestMarginLbs: round2(latest.weightLimitLbs - latest.weightLbs),
    minWeightLbs: Math.min(...weights),
    maxWeightLbs: Math.max(...weights),
    overLimitCount,
    trend,
  };
}
