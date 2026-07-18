// Pure helper functions for the autonomous path library — no I/O, unit-testable.

import type {
  AutonPath,
  AutonPathLibrarySummary,
  AutonPathRun,
  AutonPathRunOutcome,
  AutonPathStartPosition,
  AutonPathStats,
  AutonPathWithStats,
} from "./types";

export const AUTON_PATH_START_POSITIONS: AutonPathStartPosition[] = ["left", "center", "right", "other"];
export const AUTON_PATH_RUN_OUTCOMES: AutonPathRunOutcome[] = ["success", "partial", "fail"];

export function autonPathStartPositionLabel(position: AutonPathStartPosition): string {
  switch (position) {
    case "left":
      return "Left";
    case "center":
      return "Center";
    case "right":
      return "Right";
    default:
      return "Other";
  }
}

export function autonPathRunOutcomeLabel(outcome: AutonPathRunOutcome): string {
  switch (outcome) {
    case "success":
      return "Success";
    case "partial":
      return "Partial";
    default:
      return "Fail";
  }
}

/** Computes per-path run stats from a flat run list scoped to one path. */
export function computePathStats(pathId: string, runs: AutonPathRun[]): AutonPathStats {
  const pathRuns = runs.filter((r) => r.pathId === pathId);
  const totalRuns = pathRuns.length;
  const successRuns = pathRuns.filter((r) => r.outcome === "success").length;
  const partialRuns = pathRuns.filter((r) => r.outcome === "partial").length;
  const failRuns = pathRuns.filter((r) => r.outcome === "fail").length;
  const successRate = totalRuns > 0 ? successRuns / totalRuns : null;
  const lastRunOn = pathRuns.reduce<string | null>((latest, r) => {
    if (!latest || r.occurredOn > latest) return r.occurredOn;
    return latest;
  }, null);
  return { pathId, totalRuns, successRuns, partialRuns, failRuns, successRate, lastRunOn };
}

/** Joins paths with their computed run stats. */
export function attachStats(paths: AutonPath[], runs: AutonPathRun[]): AutonPathWithStats[] {
  return paths.map((path) => ({ ...path, stats: computePathStats(path.id, runs) }));
}

/** Summarizes the full library: totals, blended success rate, and the best-performing path. */
export function summarizeLibrary(paths: AutonPathWithStats[]): AutonPathLibrarySummary {
  const totalPaths = paths.length;
  const activePaths = paths.filter((p) => p.active).length;
  const totalRuns = paths.reduce((sum, p) => sum + p.stats.totalRuns, 0);
  const totalSuccess = paths.reduce((sum, p) => sum + p.stats.successRuns, 0);
  const overallSuccessRate = totalRuns > 0 ? totalSuccess / totalRuns : null;

  let bestPathId: string | null = null;
  let bestRate = -1;
  for (const path of paths) {
    if (path.stats.totalRuns < 3) continue; // require a minimum sample before ranking
    if (path.stats.successRate != null && path.stats.successRate > bestRate) {
      bestRate = path.stats.successRate;
      bestPathId = path.id;
    }
  }

  return { totalPaths, activePaths, totalRuns, overallSuccessRate, bestPathId };
}

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}
