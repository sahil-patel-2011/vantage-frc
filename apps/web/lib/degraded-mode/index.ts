// Pure, unit-testable helpers for degraded-mode: no I/O, no framework imports.
// These take the already-computed health `mode` (from the shared reference-health evaluator)
// and derive the banner copy, the read-only fallback list, and acknowledgment freshness.

export * from "./types";

import type { DegradedModeFallback, DegradedModeReason } from "./types";

export type DegradedModeBannerMode = "ok" | DegradedModeReason;

export const DEGRADED_MODE_SOURCES = ["tba", "statbotics", "db", "all"] as const;
export const DEGRADED_MODE_REASONS: DegradedModeReason[] = ["degraded", "unavailable", "stale"];

export function degradedModeSourceLabel(source: string): string {
  switch (source) {
    case "tba":
      return "The Blue Alliance";
    case "statbotics":
      return "Statbotics";
    case "db":
      return "Reference database";
    case "all":
      return "All data sources";
    default:
      return source;
  }
}

export function degradedModeReasonLabel(mode: DegradedModeBannerMode): string {
  switch (mode) {
    case "unavailable":
      return "Unavailable";
    case "degraded":
      return "Degraded";
    case "stale":
      return "Stale";
    default:
      return "Healthy";
  }
}

/** Whether the app-wide banner should render for the given health mode. */
export function shouldShowDegradedBanner(mode: DegradedModeBannerMode): boolean {
  return mode !== "ok";
}

/**
 * Read-only fallback surfaces to point teams at while a mode is degraded.
 * Skips fallbacks that don't apply for a healthy mode (empty list).
 */
export function computeDegradedFallbacks(
  mode: DegradedModeBannerMode,
  orgId: string | null,
): DegradedModeFallback[] {
  if (mode === "ok") return [];
  const org = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const fallbacks: DegradedModeFallback[] = [
    {
      id: "team-data",
      label: "Team → Data",
      detail: "Review the last saved rankings and schedule, then sync again when The Blue Alliance is back.",
      href: `/team/data${org}`,
    },
  ];
  if (mode === "unavailable" || mode === "degraded") {
    fallbacks.push({
      id: "strategy-cache",
      label: "Strategy (cached)",
      detail: "Match prediction & strategy keeps serving the last-good cached reference data.",
      href: `/strategy${org}`,
    });
  }
  return fallbacks;
}

/** True while an acknowledgment for `mode` is still unresolved (has not been cleared). */
export function isAcknowledgmentActive(
  ack: { mode: DegradedModeReason; resolvedAt: string | null } | null,
  mode: DegradedModeBannerMode,
): boolean {
  if (!ack || ack.resolvedAt) return false;
  return ack.mode === mode;
}

/** Age of an acknowledgment in whole minutes, for "acknowledged N min ago" copy. */
export function acknowledgmentAgeMinutes(acknowledgedAt: string, now: Date = new Date()): number {
  const then = Date.parse(acknowledgedAt);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 60000));
}
