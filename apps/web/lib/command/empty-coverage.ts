import type { CommandSnapshot } from "./types";

export function emptyCommandCoverage(
  partial: Partial<CommandSnapshot["coverage"]> = {},
): CommandSnapshot["coverage"] {
  return {
    matchReports: 0,
    pitReports: 0,
    openDisagreements: 0,
    upcomingUnscouted: 0,
    missingRows: 0,
    assignedWaiting: 0,
    coveredRows: 0,
    doubleCovered: 0,
    liveBoard: [],
    coordinatorNudge: null,
    ...partial,
  };
}
