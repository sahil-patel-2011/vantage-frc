// Pure helpers for the Robot Weigh-In log: labels + summary/trend computation. No I/O.

import type { RobotWeighInEntry, RobotWeighInStation, RobotWeighInSummary, RobotWeighInTrendPoint } from "./types";

export * from "./types";

export function robotWeighInStationLabel(station: RobotWeighInStation | null): string {
  switch (station) {
    case "shop":
      return "Shop scale";
    case "event_inspection":
      return "Event inspection";
    case "practice_field":
      return "Practice field";
    case "other":
      return "Other";
    default:
      // Mirrored from the inspection scale log, which records no station.
      return "Inspection scale log";
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** CD 2026: traditional playoff re-weigh is now codified. Shown only when TBA has unplayed elims. */
export const PLAYOFF_REWEIGH_CUE =
  "Playoffs are on the schedule. Log an Event inspection weigh-in after alliance selection — weight stays blank until you step on the scale.";

/** 2026 R103: robot excluding bumpers and battery. */
export const R103_WEIGHT_LIMIT_LBS = 115;
/** 2026 R408: robot + bumpers. */
export const R408_BUMPER_ON_LIMIT_LBS = 135;
/** 2026 I103: all swap mechanisms presented at inspection. */
export const I103_INSPECTED_MECHANISMS_LIMIT_LBS = 150;

export const WEIGH_IN_R103_CUE =
  "This reading excludes bumpers and battery — 2026 R103 is 115 lb, not last year's 125 lb.";
export const WEIGH_IN_R408_CUE =
  "Bumpers are on this reading — 2026 R408 is 135 lb for robot + bumpers (I103 is 150 lb with all swap mechanisms).";

export function suggestedWeightLimitLbs(input: { bumpersOn: boolean; batteryOn: boolean }): number {
  if (input.bumpersOn) return R408_BUMPER_ON_LIMIT_LBS;
  if (!input.batteryOn) return R103_WEIGHT_LIMIT_LBS;
  return R103_WEIGHT_LIMIT_LBS;
}

/**
 * Cue a 2026 inspection limit from the logged bumper/battery config vs the limit they typed.
 * Never invents a scale reading.
 */
export function weighIn2026LimitCue(input: {
  bumpersOn: boolean;
  batteryOn: boolean;
  weightLimitLbs: number;
}): string | null {
  if (!Number.isFinite(input.weightLimitLbs) || input.weightLimitLbs <= 0) return null;
  if (input.bumpersOn) {
    if (input.weightLimitLbs >= R408_BUMPER_ON_LIMIT_LBS) return null;
    return WEIGH_IN_R408_CUE;
  }
  if (!input.batteryOn && input.weightLimitLbs !== R103_WEIGHT_LIMIT_LBS) return WEIGH_IN_R103_CUE;
  return null;
}

function calendarDayUtc(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

/**
 * Cue a playoff-day Event inspection weigh-in from TBA elims + real logs only.
 * Never invents playoffs or a scale reading. Uses existing `event_inspection` station
 * (no new CHECK value) so Thursday shop/inspection logs do not clear Saturday elims.
 */
export function playoffReweighCue(input: {
  nextUnplayedPlayoffAt: string | null;
  latestEventInspectionAt: string | null;
  hasAnyEntry: boolean;
}): string | null {
  if (!input.hasAnyEntry || !input.nextUnplayedPlayoffAt) return null;
  const playoffDay = calendarDayUtc(input.nextUnplayedPlayoffAt);
  if (!playoffDay) return null;
  const inspectDay = input.latestEventInspectionAt ? calendarDayUtc(input.latestEventInspectionAt) : null;
  if (inspectDay && inspectDay >= playoffDay) return null;
  return PLAYOFF_REWEIGH_CUE;
}

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
