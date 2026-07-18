// Pure, unit-testable helpers for the robot code deploy log. No I/O.

import type { CodeDeployLogEntry, CodeDeployLogSummary, DeployStatus, DeployType } from "./types";

export const DEPLOY_TYPES: DeployType[] = ["practice", "qualification", "elimination", "pit_test", "other"];
export const DEPLOY_STATUSES: DeployStatus[] = ["deployed", "rolled_back", "failed"];

export function deployTypeLabel(deployType: DeployType): string {
  switch (deployType) {
    case "practice":
      return "Practice";
    case "qualification":
      return "Qualification match";
    case "elimination":
      return "Elimination match";
    case "pit_test":
      return "Pit test";
    default:
      return "Other";
  }
}

export function deployStatusLabel(status: DeployStatus): string {
  switch (status) {
    case "deployed":
      return "Deployed";
    case "rolled_back":
      return "Rolled back";
    default:
      return "Failed";
  }
}

/** Summarizes a set of deploy log entries. Skips nothing — every logged entry counts. */
export function summarizeDeployLog(entries: CodeDeployLogEntry[]): CodeDeployLogSummary {
  if (entries.length === 0) {
    return {
      totalDeploys: 0,
      matchLinkedDeploys: 0,
      byStatus: [],
      byType: [],
      lastDeployedOn: null,
      rollbackRate: 0,
    };
  }

  const statusCounts = new Map<DeployStatus, number>();
  const typeCounts = new Map<DeployType, number>();
  let matchLinkedDeploys = 0;
  let lastDeployedOn: string | null = null;

  for (const entry of entries) {
    statusCounts.set(entry.status, (statusCounts.get(entry.status) ?? 0) + 1);
    typeCounts.set(entry.deployType, (typeCounts.get(entry.deployType) ?? 0) + 1);
    if (entry.matchKey) matchLinkedDeploys += 1;
    if (!lastDeployedOn || entry.deployedOn > lastDeployedOn) lastDeployedOn = entry.deployedOn;
  }

  const byStatus = DEPLOY_STATUSES.filter((status) => statusCounts.has(status)).map((status) => ({
    status,
    count: statusCounts.get(status) ?? 0,
  }));
  const byType = DEPLOY_TYPES.filter((deployType) => typeCounts.has(deployType)).map((deployType) => ({
    deployType,
    count: typeCounts.get(deployType) ?? 0,
  }));

  const rolledBack = statusCounts.get("rolled_back") ?? 0;
  const failed = statusCounts.get("failed") ?? 0;
  const rollbackRate = entries.length > 0 ? (rolledBack + failed) / entries.length : 0;

  return {
    totalDeploys: entries.length,
    matchLinkedDeploys,
    byStatus,
    byType,
    lastDeployedOn,
    rollbackRate,
  };
}
