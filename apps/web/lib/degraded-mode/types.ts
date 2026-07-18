// Degraded-mode domain types. Pure data shapes — no I/O, no framework imports.
// Health signals reuse the existing shared `DataSourceHealthView` / `ReferenceSourceHealth`
// shapes from apps/web/lib/reference-health.ts; this module adds the team-facing
// acknowledgment + read-only-fallback layer on top of that health signal.

export type DegradedModeSource = "tba" | "statbotics" | "db" | "all";

export type DegradedModeReason = "degraded" | "unavailable" | "stale";

export type DegradedModeAcknowledgment = {
  id: string;
  source: DegradedModeSource;
  mode: DegradedModeReason;
  note: string | null;
  acknowledgedBy: string;
  acknowledgedAt: string;
  resolvedAt: string | null;
};

/** A product surface that falls back to read-only / last-known-good data while degraded. */
export type DegradedModeFallback = {
  id: string;
  label: string;
  detail: string;
  href: string;
};
