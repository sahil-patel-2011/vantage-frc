// Pure helpers for the Opponent Watchlist feature. No I/O — safe to unit test directly.

export * from "./types";
import type { WatchlistAlert, WatchlistAlertType, WatchlistEntry, WatchlistSummary } from "./types";

/** Minimum absolute EPA change (points) worth surfacing as an alert — avoids noise from float jitter. */
export const EPA_ALERT_THRESHOLD = 2;

export function teamLabel(teamNumber: number | null, nickname: string | null): string {
  const number = teamNumber != null ? `#${teamNumber}` : "Team";
  return nickname ? `${number} ${nickname}` : number;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Compares a previously captured EPA snapshot to the current value and returns an alert when the
 * swing crosses the noise threshold. Returns null when there is nothing meaningful to report
 * (no prior snapshot, no current value, or the change is too small).
 */
export function classifyEpaChange(input: {
  previousEpa: number | null;
  currentEpa: number | null;
  threshold?: number;
}): { type: WatchlistAlertType; delta: number } | null {
  const { previousEpa, currentEpa } = input;
  const threshold = input.threshold ?? EPA_ALERT_THRESHOLD;
  if (previousEpa == null || currentEpa == null) return null;
  const delta = currentEpa - previousEpa;
  if (Math.abs(delta) < threshold) return null;
  return { type: delta > 0 ? "epa_up" : "epa_down", delta };
}

/**
 * Compares the previously captured "next match" to the current one and classifies whether this is
 * a brand-new scheduled match or a reschedule of a previously known one. Returns null when there is
 * no change worth surfacing.
 */
export function classifyScheduleChange(input: {
  previousMatchKey: string | null;
  previousScheduledTime: string | null;
  currentMatchKey: string | null;
  currentScheduledTime: string | null;
}): { type: WatchlistAlertType } | null {
  const { previousMatchKey, previousScheduledTime, currentMatchKey, currentScheduledTime } = input;
  if (!currentMatchKey) return null;
  if (!previousMatchKey) return { type: "schedule_new" };
  if (previousMatchKey !== currentMatchKey) return { type: "schedule_new" };
  if (previousScheduledTime !== currentScheduledTime) return { type: "schedule_changed" };
  return null;
}

export function summarizeWatchlist(entries: WatchlistEntry[], alerts: WatchlistAlert[]): WatchlistSummary {
  return {
    totalWatched: entries.length,
    epaAlerts: alerts.filter((a) => a.type === "epa_up" || a.type === "epa_down").length,
    scheduleAlerts: alerts.filter((a) => a.type === "schedule_new" || a.type === "schedule_changed").length,
    upcomingMatches: entries.filter((e) => e.nextMatch != null).length,
  };
}

export function alertMessage(
  type: WatchlistAlertType,
  label: string,
  input: { previous: string | null; current: string | null },
): string {
  switch (type) {
    case "epa_up":
      return `${label} rating rose from ${input.previous ?? "—"} to ${input.current ?? "—"}.`;
    case "epa_down":
      return `${label} rating dropped from ${input.previous ?? "—"} to ${input.current ?? "—"}.`;
    case "schedule_new":
      return `${label} has a new scheduled match: ${input.current ?? "—"}.`;
    case "schedule_changed":
      return `${label}'s match time changed to ${input.current ?? "—"}.`;
    default:
      return `${label} changed.`;
  }
}
