// Incident heatmap aggregation. Pure aggregation over logged incidents — deterministic
// given its input (bucketing uses an explicit ISO-week derivation, no clock).

export * from "./types";
import type { ContextTotal, HeatmapCell, Incident, IncidentContext, IncidentHeatmapSummary, SubsystemTotal } from "./types";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** ISO week bucket (YYYY-Www) for a given ISO timestamp/date string. Deterministic, no clock reads. */
export function isoWeekBucket(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO week: Thursday of the current week determines the week-year.
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function incidentContextLabel(context: IncidentContext): string {
  const labels: Record<IncidentContext, string> = {
    match: "Match",
    pit: "Pit",
    practice: "Practice",
    inspection: "Inspection",
    other: "Other",
  };
  return labels[context];
}

/**
 * Aggregate incidents into a subsystem x time-bucket heatmap plus subsystem/context
 * rollups. Buckets are sorted chronologically; subsystems within cells are only those
 * that actually logged an incident (no zero-fill fabrication).
 */
export function summarizeIncidentHeatmap(incidents: Incident[]): IncidentHeatmapSummary {
  const cellMap = new Map<string, number>();
  const subsystemMap = new Map<string, number>();
  const contextMap = new Map<IncidentContext, number>();
  const bucketSet = new Set<string>();

  for (const incident of incidents) {
    const bucket = isoWeekBucket(incident.occurredAt);
    if (!bucket) continue;
    bucketSet.add(bucket);

    const key = `${incident.subsystem}::${bucket}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + 1);

    subsystemMap.set(incident.subsystem, (subsystemMap.get(incident.subsystem) ?? 0) + 1);
    contextMap.set(incident.context, (contextMap.get(incident.context) ?? 0) + 1);
  }

  const cells: HeatmapCell[] = [...cellMap.entries()].map(([key, count]) => {
    const separatorIndex = key.indexOf("::");
    const subsystem = key.slice(0, separatorIndex);
    const bucket = key.slice(separatorIndex + 2);
    return { subsystem, bucket, count };
  });

  const totalIncidents = incidents.length;

  const bySubsystem: SubsystemTotal[] = [...subsystemMap.entries()]
    .map(([subsystem, count]) => ({
      subsystem,
      count,
      shareOfTotal: totalIncidents > 0 ? round2(count / totalIncidents) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.subsystem.localeCompare(b.subsystem));

  const byContext: ContextTotal[] = [...contextMap.entries()]
    .map(([context, count]) => ({ context, count }))
    .sort((a, b) => b.count - a.count);

  const buckets = [...bucketSet].sort();
  const hottestSubsystem = bySubsystem[0]?.subsystem ?? null;

  return {
    totalIncidents,
    buckets,
    cells,
    bySubsystem,
    byContext,
    hottestSubsystem,
  };
}
