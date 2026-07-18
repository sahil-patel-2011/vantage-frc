// Pure helper functions for EPA trend alerts — no I/O, unit-testable in isolation.

import type {
  EpaTrendAlert,
  EpaTrendDirection,
  EpaTrendPoint,
  EpaTrendSeverity,
  EpaTrendSummary,
} from "./types";

export * from "./types";

/** Minimum absolute EPA-point swing between a team's two most recent events to alert on. */
export const TREND_ABS_THRESHOLD = 4;
/** Minimum fractional swing (relative to the prior EPA) to alert on. */
export const TREND_PCT_THRESHOLD = 0.12;
/** Swing size (in either unit) at which an alert is escalated to "high" severity. */
export const TREND_HIGH_ABS_THRESHOLD = 9;
export const TREND_HIGH_PCT_THRESHOLD = 0.28;

type TrendClassification = {
  direction: EpaTrendDirection;
  magnitude: number;
  percentChange: number;
  severity: EpaTrendSeverity;
};

/**
 * Compares two consecutive-event EPA readings and classifies the swing, or returns null when
 * the move doesn't clear the alert threshold. Direction "flat" is intentionally not modeled —
 * sub-threshold moves simply produce no alert.
 */
export function classifyTrend(previousEpa: number, latestEpa: number): TrendClassification | null {
  if (!Number.isFinite(previousEpa) || !Number.isFinite(latestEpa)) return null;
  const rawDelta = latestEpa - previousEpa;
  const percentChange = previousEpa !== 0 ? rawDelta / Math.abs(previousEpa) : rawDelta !== 0 ? 1 : 0;
  const meetsThreshold = Math.abs(rawDelta) >= TREND_ABS_THRESHOLD || Math.abs(percentChange) >= TREND_PCT_THRESHOLD;
  if (!meetsThreshold) return null;

  const direction: EpaTrendDirection = rawDelta > 0 ? "up" : "down";
  const isHigh = Math.abs(rawDelta) >= TREND_HIGH_ABS_THRESHOLD || Math.abs(percentChange) >= TREND_HIGH_PCT_THRESHOLD;

  return {
    direction,
    magnitude: Math.round(Math.abs(rawDelta) * 100) / 100,
    percentChange: Math.round(percentChange * 1000) / 1000,
    severity: isHigh ? "high" : "medium",
  };
}

/** Stable id for a specific team+latest-event trend alert, used for dismiss/ack persistence. */
export function fingerprintAlert(teamKey: string, latestEventKey: string): string {
  return `${teamKey}::${latestEventKey}`;
}

/**
 * Builds a trend alert for one team from its chronologically-sorted EPA history, or returns
 * null when there isn't enough data, the swing doesn't clear threshold, or it was dismissed.
 */
export function buildTeamTrendAlert(input: {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  points: EpaTrendPoint[];
  dismissedFingerprints: ReadonlySet<string>;
}): EpaTrendAlert | null {
  const points = input.points
    .filter((point) => Number.isFinite(point.epaTotal))
    .slice()
    .sort((a, b) => {
      const aTime = a.startDate ? Date.parse(a.startDate) : 0;
      const bTime = b.startDate ? Date.parse(b.startDate) : 0;
      return aTime - bTime;
    });
  if (points.length < 2) return null;

  const latest = points[points.length - 1]!;
  const previous = points[points.length - 2]!;
  const trend = classifyTrend(previous.epaTotal, latest.epaTotal);
  if (!trend) return null;

  const fingerprint = fingerprintAlert(input.teamKey, latest.eventKey);
  if (input.dismissedFingerprints.has(fingerprint)) return null;

  return {
    teamKey: input.teamKey,
    teamNumber: input.teamNumber,
    nickname: input.nickname,
    direction: trend.direction,
    magnitude: trend.magnitude,
    percentChange: trend.percentChange,
    previousEpa: previous.epaTotal,
    latestEpa: latest.epaTotal,
    previousEventKey: previous.eventKey,
    latestEventKey: latest.eventKey,
    previousEventName: previous.eventName,
    latestEventName: latest.eventName,
    fingerprint,
    severity: trend.severity,
  };
}

export function summarizeAlerts(alerts: EpaTrendAlert[], watchlistCount: number): EpaTrendSummary {
  return {
    watchlistCount,
    alertCount: alerts.length,
    risingCount: alerts.filter((alert) => alert.direction === "up").length,
    fallingCount: alerts.filter((alert) => alert.direction === "down").length,
    highSeverityCount: alerts.filter((alert) => alert.severity === "high").length,
  };
}

export function directionLabel(direction: EpaTrendDirection): string {
  return direction === "up" ? "Rising" : "Falling";
}

export function severityLabel(severity: EpaTrendSeverity): string {
  return severity === "high" ? "High" : "Medium";
}
