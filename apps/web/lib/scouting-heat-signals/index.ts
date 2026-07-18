// Pure helper functions for Scouting Heat Signals — no I/O, unit-testable in isolation.

import type { HeatDirection, HeatSignalEntry, HeatSignalSummary, TeamHeatSignal } from "./types";

export * from "./types";

export const HEAT_DIRECTIONS: HeatDirection[] = ["up", "down", "steady"];

/** Heat score above which a team's aggregate is classified as trending up (below negated = down). */
export const HEAT_SCORE_THRESHOLD = 0.15;

export function directionValue(direction: HeatDirection): number {
  if (direction === "up") return 1;
  if (direction === "down") return -1;
  return 0;
}

export function classifyHeatScore(score: number): HeatDirection {
  if (score > HEAT_SCORE_THRESHOLD) return "up";
  if (score < -HEAT_SCORE_THRESHOLD) return "down";
  return "steady";
}

export function directionLabel(direction: HeatDirection): string {
  if (direction === "up") return "Trending up";
  if (direction === "down") return "Trending down";
  return "Steady";
}

/**
 * Aggregates one team's chronologically-unsorted observation entries into a heat signal.
 * More recent entries carry more weight in the heat score. Returns null for an empty list —
 * there is nothing to render without at least one real observation.
 */
export function computeTeamHeatSignal(input: {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  entries: HeatSignalEntry[];
}): TeamHeatSignal | null {
  if (input.entries.length === 0) return null;

  const sorted = input.entries
    .slice()
    .sort((a, b) => Date.parse(a.observedOn) - Date.parse(b.observedOn) || a.createdAt.localeCompare(b.createdAt));

  let weightedSum = 0;
  let weightTotal = 0;
  let risingCount = 0;
  let fallingCount = 0;
  let steadyCount = 0;

  sorted.forEach((entry, index) => {
    const weight = index + 1; // later (more recent) entries weigh more
    weightedSum += directionValue(entry.direction) * weight;
    weightTotal += weight;
    if (entry.direction === "up") risingCount += 1;
    else if (entry.direction === "down") fallingCount += 1;
    else steadyCount += 1;
  });

  const heatScore = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 1000) / 1000 : 0;

  const metricPoints = sorted.filter((entry) => entry.metricValue != null) as Array<
    HeatSignalEntry & { metricValue: number }
  >;
  const metricDelta =
    metricPoints.length >= 2
      ? Math.round((metricPoints[metricPoints.length - 1]!.metricValue - metricPoints[0]!.metricValue) * 100) / 100
      : null;

  const latest = sorted[sorted.length - 1]!;

  return {
    teamKey: input.teamKey,
    teamNumber: input.teamNumber,
    nickname: input.nickname,
    heatScore,
    direction: classifyHeatScore(heatScore),
    entryCount: sorted.length,
    risingCount,
    fallingCount,
    steadyCount,
    lastObservedOn: latest.observedOn,
    metricDelta,
    recentEntries: sorted.slice(-10).reverse(),
  };
}

export function summarizeHeatSignals(teams: TeamHeatSignal[], totalEntries: number): HeatSignalSummary {
  return {
    totalTeams: teams.length,
    totalEntries,
    risingTeams: teams.filter((team) => team.direction === "up").length,
    fallingTeams: teams.filter((team) => team.direction === "down").length,
    steadyTeams: teams.filter((team) => team.direction === "steady").length,
  };
}
