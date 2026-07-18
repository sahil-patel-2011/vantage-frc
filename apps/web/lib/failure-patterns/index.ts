// Pure, framework-free clustering math for repeat-failure pattern detection. Everything here is
// deterministic and grounded only in the events the caller supplies — it never fabricates a value.
// compute-failure-patterns.ts wraps this with DB I/O; the API route and client render results.

import {
  REPEAT_FAILURE_THRESHOLD,
  type FailurePatternCluster,
  type FailurePatternEvent,
  type FailurePatternNote,
  type FailurePatternSummary,
  type FailurePatternTier,
} from "./types";

export { REPEAT_FAILURE_THRESHOLD };

export const FAILURE_PATTERN_NOTE_STATUSES = ["open", "acknowledged", "resolved"] as const;

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function tierFor(totalCount: number, maxSeverity: number | null): FailurePatternTier {
  if (totalCount >= REPEAT_FAILURE_THRESHOLD + 2 || (maxSeverity ?? 0) >= 8) return "critical";
  if (totalCount >= REPEAT_FAILURE_THRESHOLD) return "watch";
  return "minor";
}

/** Groups raw failure events by subsystem and computes cluster-level stats. Skips blank subsystem names. */
export function clusterFailureEvents(
  events: FailurePatternEvent[],
  notesBySubsystem: Map<string, FailurePatternNote>,
): FailurePatternCluster[] {
  const bySubsystem = new Map<string, FailurePatternEvent[]>();
  for (const event of events) {
    const subsystemName = event.subsystemName.trim();
    if (!subsystemName) continue;
    const list = bySubsystem.get(subsystemName) ?? [];
    list.push(event);
    bySubsystem.set(subsystemName, list);
  }

  const clusters: FailurePatternCluster[] = [];
  for (const [subsystemName, list] of bySubsystem.entries()) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));
    const severities = sorted.map((e) => e.severity).filter((s): s is number => typeof s === "number");
    const maxSeverity = severities.length ? Math.max(...severities) : null;
    const avgSeverity = severities.length ? round(severities.reduce((a, b) => a + b, 0) / severities.length) : null;
    const fmeaCount = sorted.filter((e) => e.source === "fmea").length;
    const incidentCount = sorted.filter((e) => e.source === "incident").length;
    clusters.push({
      subsystemName,
      totalCount: sorted.length,
      fmeaCount,
      incidentCount,
      maxSeverity,
      avgSeverity,
      firstOccurredOn: sorted[sorted.length - 1]!.occurredOn,
      lastOccurredOn: sorted[0]!.occurredOn,
      tier: tierFor(sorted.length, maxSeverity),
      events: sorted,
      latestNote: notesBySubsystem.get(subsystemName) ?? null,
    });
  }

  return clusters.sort((a, b) => b.totalCount - a.totalCount || (a.subsystemName < b.subsystemName ? -1 : 1));
}

export function summarizeClusters(clusters: FailurePatternCluster[]): FailurePatternSummary {
  return {
    totalEvents: clusters.reduce((sum, c) => sum + c.totalCount, 0),
    totalClusters: clusters.length,
    repeatClusters: clusters.filter((c) => c.totalCount >= REPEAT_FAILURE_THRESHOLD).length,
    criticalClusters: clusters.filter((c) => c.tier === "critical").length,
  };
}

export function failurePatternTierLabel(tier: FailurePatternTier): string {
  switch (tier) {
    case "critical":
      return "Critical";
    case "watch":
      return "Watch";
    default:
      return "Minor";
  }
}

export function failurePatternNoteStatusLabel(status: string): string {
  switch (status) {
    case "acknowledged":
      return "Acknowledged";
    case "resolved":
      return "Resolved";
    default:
      return "Open";
  }
}
