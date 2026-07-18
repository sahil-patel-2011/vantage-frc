// Pure helper functions for the match-delta watcher — unit-testable, no I/O.

import type {
  MatchDeltaAlert,
  MatchDeltaAlertType,
  MatchDeltaClassification,
  MatchDeltaClassificationInput,
  MatchDeltaSeverity,
  MatchDeltaSummary,
} from "./types";

export * from "./types";

const TOP_PICK_CRITICAL_RANK = 4;
const TOP_PICK_WATCH_RANK = 8;

export function matchDeltaAlertTypeLabel(type: MatchDeltaAlertType): string {
  switch (type) {
    case "winner_mismatch":
      return "Predicted winner missed";
    case "pick_list_upset":
      return "Pick-list team lost";
    case "margin_surprise":
      return "Margin surprise";
    default:
      return type;
  }
}

export function matchDeltaSeverityLabel(severity: MatchDeltaSeverity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "watch":
      return "Watch";
    case "info":
      return "Info";
    default:
      return severity;
  }
}

/**
 * Classify one completed, predicted match into zero or more delta alerts by comparing the
 * prediction (and, if available, the org's pick-list priorities) against the actual result.
 */
export function classifyMatchDelta(input: MatchDeltaClassificationInput): MatchDeltaClassification[] {
  const results: MatchDeltaClassification[] = [];
  const confidence = Math.max(input.pRed, input.pBlue);

  if (input.predictedWinner !== "tie" && input.predictedWinner !== input.actualWinner) {
    const severity: MatchDeltaSeverity = confidence >= input.upsetThreshold ? "critical" : "watch";
    results.push({
      alertType: "winner_mismatch",
      severity,
      summary: `Predicted ${input.predictedWinner} alliance to win (${Math.round(confidence * 100)}% confidence) — ${
        input.actualWinner === "tie" ? "match tied" : `${input.actualWinner} alliance actually won`
      }.`,
      teamsInvolved: [...input.redTeams, ...input.blueTeams].filter((t, i, arr) => arr.indexOf(t) === i),
    });
  }

  if (input.pickListRanks && input.actualWinner !== "tie") {
    const losingAlliance = input.actualWinner === "red" ? "blue" : "red";
    const losingTeams = losingAlliance === "red" ? input.redTeams : input.blueTeams;
    let bestRank: number | null = null;
    let bestTeam: string | null = null;
    for (const team of losingTeams) {
      const rank = input.pickListRanks[team];
      if (rank != null && (bestRank == null || rank < bestRank)) {
        bestRank = rank;
        bestTeam = team;
      }
    }
    if (bestRank != null && bestTeam != null && bestRank <= TOP_PICK_WATCH_RANK) {
      const severity: MatchDeltaSeverity = bestRank <= TOP_PICK_CRITICAL_RANK ? "critical" : "watch";
      results.push({
        alertType: "pick_list_upset",
        severity,
        summary: `Pick-list #${bestRank} (${bestTeam}) was on the losing ${losingAlliance} alliance.`,
        teamsInvolved: [...input.redTeams, ...input.blueTeams].filter((t, i, arr) => arr.indexOf(t) === i),
      });
    }
  }

  return results;
}

export function summarizeAlerts(
  alerts: MatchDeltaAlert[],
  totalScoredPredictions: number,
  correctPredictions: number,
): MatchDeltaSummary {
  return {
    totalWatchedMatches: totalScoredPredictions,
    totalAlerts: alerts.length,
    criticalAlerts: alerts.filter((a) => a.severity === "critical").length,
    unacknowledgedAlerts: alerts.filter((a) => !a.acknowledged).length,
    accuracyRate: totalScoredPredictions > 0 ? correctPredictions / totalScoredPredictions : 0,
  };
}

/** Most severe / most recent first. */
export function sortAlerts(alerts: MatchDeltaAlert[]): MatchDeltaAlert[] {
  const rank: Record<MatchDeltaSeverity, number> = { critical: 0, watch: 1, info: 2 };
  return [...alerts].sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
