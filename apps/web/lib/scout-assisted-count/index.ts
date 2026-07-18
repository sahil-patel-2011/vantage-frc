export * from "./types";

import type { CountSession, CountSummary } from "./types";

export const METRIC_KEY_LABEL: Record<string, string> = {
  auto_pieces: "Auto game pieces",
  teleop_pieces: "Teleop game pieces",
  cycles: "Cycles",
  defense_events: "Defense events",
  fouls: "Fouls observed",
  other: "Other",
};

export function countMetricLabel(metricKey: string): string {
  return METRIC_KEY_LABEL[metricKey] ?? metricKey;
}

/** Sum of tap deltas — the value a numeric scouting field should auto-fill with. */
export function tallyFromTaps(taps: Array<{ delta: number }>): number {
  return taps.reduce((sum, tap) => sum + (Number.isFinite(tap.delta) ? tap.delta : 0), 0);
}

export function summarizeSessions(sessions: CountSession[]): CountSummary {
  const totalSessions = sessions.length;
  const openSessions = sessions.filter((s) => s.status === "open").length;
  const closedSessions = totalSessions - openSessions;
  const totalTaps = sessions.reduce((sum, s) => sum + s.tapCount, 0);
  const averageTapsPerSession = totalSessions > 0 ? Math.round((totalTaps / totalSessions) * 10) / 10 : 0;
  return { totalSessions, openSessions, closedSessions, totalTaps, averageTapsPerSession };
}
