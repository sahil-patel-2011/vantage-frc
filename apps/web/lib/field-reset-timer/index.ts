// Field-reset-timer rollups. Pure aggregation over logged cycles — deterministic given
// its input, no clock, no I/O.

import type {
  FieldResetTimerCycle,
  FieldResetTimerReadiness,
  FieldResetTimerSessionSummary,
  FieldResetTimerTier,
} from "./types";

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export type FieldResetTimerTargets = {
  /** Reset time (seconds) that reads as "fast" for this game's reset (default 20). */
  fastResetSeconds: number;
  /** Distinct sessions logged that reads as sustained drilling (default 5). */
  sustainedSessions: number;
};

export const DEFAULT_TARGETS: FieldResetTimerTargets = {
  fastResetSeconds: 20,
  sustainedSessions: 5,
};

/** Summarize the reset cycles recorded within a single practice session. */
export function summarizeSessionCycles(
  sessionId: string,
  cycles: FieldResetTimerCycle[],
): FieldResetTimerSessionSummary | null {
  const inSession = cycles.filter((c) => c.sessionId === sessionId);
  if (inSession.length === 0) return null;

  const resets = inSession.map((c) => c.resetSeconds).filter((v) => Number.isFinite(v) && v >= 0);
  const cycleTimes = inSession
    .map((c) => c.cycleSeconds)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);

  const avgResetSeconds = round1(resets.reduce((sum, v) => sum + v, 0) / resets.length);
  const bestResetSeconds = round1(Math.min(...resets));
  const worstResetSeconds = round1(Math.max(...resets));
  const avgCycleSeconds =
    cycleTimes.length > 0 ? round1(cycleTimes.reduce((sum, v) => sum + v, 0) / cycleTimes.length) : null;

  const variance = resets.reduce((sum, v) => sum + (v - avgResetSeconds) ** 2, 0) / resets.length;
  const stdDev = Math.sqrt(variance);
  // Consistency: tight spread relative to the average reads as repeatable (1.0); a spread
  // as wide as the average itself reads as inconsistent (0.0).
  const consistency = avgResetSeconds > 0 ? round1(clamp01(1 - stdDev / avgResetSeconds)) : 0;

  return {
    sessionId,
    cycleCount: inSession.length,
    avgResetSeconds,
    bestResetSeconds,
    worstResetSeconds,
    avgCycleSeconds,
    consistency,
  };
}

function tierFromScore(score: number): FieldResetTimerTier {
  if (score >= 0.7) return "tight";
  if (score >= 0.4) return "developing";
  return "emerging";
}

/**
 * Aggregate reset-timer cycles across every session into an overall readiness read: how
 * fast, and how consistently, the drive team resets the field between practice runs.
 */
export function computeFieldResetTimerReadiness(
  cycles: FieldResetTimerCycle[],
  sessionCount: number,
  targets: Partial<FieldResetTimerTargets> = {},
): FieldResetTimerReadiness {
  const t = { ...DEFAULT_TARGETS, ...targets };

  if (cycles.length === 0) {
    return {
      score: 0,
      tier: "emerging",
      sessionsLogged: sessionCount,
      totalCycles: 0,
      bestResetSeconds: null,
      avgResetSeconds: null,
      consistency: 0,
      recommendations: ["Log a practice session and start timing field resets to build a baseline."],
    };
  }

  const resets = cycles.map((c) => c.resetSeconds).filter((v) => Number.isFinite(v) && v >= 0);
  const avgResetSeconds = round1(resets.reduce((sum, v) => sum + v, 0) / resets.length);
  const bestResetSeconds = round1(Math.min(...resets));
  const variance = resets.reduce((sum, v) => sum + (v - avgResetSeconds) ** 2, 0) / resets.length;
  const stdDev = Math.sqrt(variance);
  const consistency = avgResetSeconds > 0 ? round1(clamp01(1 - stdDev / avgResetSeconds)) : 0;

  const speed = clamp01(t.fastResetSeconds / Math.max(avgResetSeconds, 0.1));
  const cadence = clamp01(sessionCount / t.sustainedSessions);
  const score = round1(clamp01(0.5 * speed + 0.3 * consistency + 0.2 * cadence));

  const recommendations: string[] = [];
  if (consistency < 0.6) recommendations.push("Reset times vary widely — drill a fixed reset routine to tighten the spread.");
  if (avgResetSeconds > t.fastResetSeconds) recommendations.push(`Average reset (${avgResetSeconds}s) is above the ${t.fastResetSeconds}s target — practice the reset sequence in isolation.`);
  if (sessionCount < t.sustainedSessions) recommendations.push("Log more practice sessions to confirm the trend holds up over time.");

  return {
    score,
    tier: tierFromScore(score),
    sessionsLogged: sessionCount,
    totalCycles: cycles.length,
    bestResetSeconds,
    avgResetSeconds,
    consistency,
    recommendations,
  };
}
