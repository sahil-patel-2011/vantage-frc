// Repeat-failure pattern detection domain types. Pure data shapes — no I/O, no framework imports.
// Clusters existing fmea_failures + incident_reports rows by subsystem to surface
// "this subsystem failed N times this season" without inventing any new failure data.

export type FailurePatternSourceKind = "fmea" | "incident";

export type FailurePatternEvent = {
  id: string;
  source: FailurePatternSourceKind;
  subsystemName: string;
  title: string;
  occurredOn: string;
  severity: number | null;
  status: string;
};

export type FailurePatternNoteStatus = "open" | "acknowledged" | "resolved";

export type FailurePatternNote = {
  id: string;
  subsystemName: string;
  status: FailurePatternNoteStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FailurePatternTier = "critical" | "watch" | "minor";

export type FailurePatternCluster = {
  subsystemName: string;
  totalCount: number;
  fmeaCount: number;
  incidentCount: number;
  maxSeverity: number | null;
  avgSeverity: number | null;
  firstOccurredOn: string;
  lastOccurredOn: string;
  tier: FailurePatternTier;
  events: FailurePatternEvent[];
  latestNote: FailurePatternNote | null;
};

export type FailurePatternSummary = {
  totalEvents: number;
  totalClusters: number;
  repeatClusters: number;
  criticalClusters: number;
};

/** A subsystem cluster is considered a "repeat failure pattern" at/above this event count. */
export const REPEAT_FAILURE_THRESHOLD = 3;
