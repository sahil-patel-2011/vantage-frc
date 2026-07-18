// Incident Heatmap domain types. Pure data shapes — no I/O, no framework imports.
// Distinct from the FMEA root-cause record and pit-repair-triage decision: this is the
// raw "what broke, where, when" log the heatmap aggregates by subsystem x time bucket.

export type IncidentContext = "match" | "pit" | "practice" | "inspection" | "other";

export type Incident = {
  id: string;
  seasonYear: number;
  subsystem: string;
  context: IncidentContext;
  eventKey: string | null;
  matchKey: string | null;
  title: string;
  notes: string | null;
  occurredAt: string;
};

export type HeatmapCell = {
  subsystem: string;
  /** ISO week bucket, e.g. "2026-W03". */
  bucket: string;
  count: number;
};

export type SubsystemTotal = {
  subsystem: string;
  count: number;
  shareOfTotal: number;
};

export type ContextTotal = {
  context: IncidentContext;
  count: number;
};

export type IncidentHeatmapSummary = {
  totalIncidents: number;
  buckets: string[];
  cells: HeatmapCell[];
  bySubsystem: SubsystemTotal[];
  byContext: ContextTotal[];
  hottestSubsystem: string | null;
};
