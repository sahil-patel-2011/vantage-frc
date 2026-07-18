// Pure, unit-testable helpers for cross-domain awareness. No I/O, no framework imports.

import type {
  CrossDomainAlert,
  CrossDomainAlertSummary,
  OpenDesignReview,
  SubsystemEvent,
  SubsystemEventDomain,
  VersionComponent,
} from "./types";

export const SUBSYSTEM_EVENT_DOMAINS: SubsystemEventDomain[] = [
  "cad",
  "firmware",
  "software",
  "mechanical",
  "electrical",
  "other",
];

const OPEN_REVIEW_STATUSES = new Set(["scheduled", "in_review"]);

export function subsystemEventDomainLabel(domain: SubsystemEventDomain): string {
  switch (domain) {
    case "cad":
      return "CAD";
    case "firmware":
      return "Firmware";
    case "software":
      return "Software";
    case "mechanical":
      return "Mechanical";
    case "electrical":
      return "Electrical";
    default:
      return "Other";
  }
}

/** Normalizes a subsystem label for cross-referencing (case/whitespace insensitive). */
export function normalizeSubsystem(value: string): string {
  return value.trim().toLowerCase();
}

export function isOpenDesignReview(status: string): boolean {
  return OPEN_REVIEW_STATUSES.has(status);
}

/**
 * A version pair is a mismatch when both an installed and a non-empty target are recorded
 * and they differ. Rows without a target are not actionable and are skipped.
 */
export function isVersionMismatch(installedVersion: string, targetVersion: string | null): boolean {
  if (!targetVersion) return false;
  return installedVersion.trim() !== targetVersion.trim();
}

/** Deterministic key so acknowledgements survive recomputation. */
export function reviewConflictKey(eventId: string, reviewId: string): string {
  return `cad_review_conflict:${eventId}:${reviewId}`;
}

export function versionMismatchKey(versionId: string): string {
  return `version_mismatch:${versionId}`;
}

export function buildCrossDomainAlerts(input: {
  events: SubsystemEvent[];
  openReviews: OpenDesignReview[];
  versions: VersionComponent[];
  acknowledgedKeys: Set<string>;
}): CrossDomainAlert[] {
  const { events, openReviews, versions, acknowledgedKeys } = input;
  const alerts: CrossDomainAlert[] = [];

  const reviewsBySubsystem = new Map<string, OpenDesignReview[]>();
  for (const review of openReviews) {
    const key = normalizeSubsystem(review.subsystem);
    const bucket = reviewsBySubsystem.get(key);
    if (bucket) bucket.push(review);
    else reviewsBySubsystem.set(key, [review]);
  }

  for (const event of events) {
    const matches = reviewsBySubsystem.get(normalizeSubsystem(event.subsystem)) ?? [];
    for (const review of matches) {
      const key = reviewConflictKey(event.id, review.id);
      if (acknowledgedKeys.has(key)) continue;
      alerts.push({
        key,
        kind: "cad_review_conflict",
        severity: "warning",
        subsystem: event.subsystem,
        title: `${subsystemEventDomainLabel(event.domain)} change on "${event.subsystem}" overlaps an open design review`,
        detail: `"${event.title}" was logged while "${review.title}" (${review.stage} review) is still ${review.status.replace("_", " ")}. Confirm the review covers this change before it's locked in.`,
        relatedEventId: event.id,
        relatedReviewId: review.id,
        relatedVersionId: null,
        occurredAt: event.occurredAt,
      });
    }
  }

  for (const version of versions) {
    if (!isVersionMismatch(version.installedVersion, version.targetVersion)) continue;
    const key = versionMismatchKey(version.id);
    if (acknowledgedKeys.has(key)) continue;
    alerts.push({
      key,
      kind: "version_mismatch",
      severity: version.category === "firmware" ? "critical" : "info",
      subsystem: version.component,
      title: `${version.component} is running ${version.installedVersion}, target is ${version.targetVersion}`,
      detail: `Installed ${version.category} version does not match the recorded target. Update or confirm the target is intentional.`,
      relatedEventId: null,
      relatedReviewId: null,
      relatedVersionId: version.id,
      occurredAt: new Date(0).toISOString(),
    });
  }

  return alerts.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}

export function summarizeCrossDomainAlerts(alerts: CrossDomainAlert[]): CrossDomainAlertSummary {
  const subsystems = new Set(alerts.map((a) => normalizeSubsystem(a.subsystem)));
  return {
    totalAlerts: alerts.length,
    criticalCount: alerts.filter((a) => a.severity === "critical").length,
    warningCount: alerts.filter((a) => a.severity === "warning").length,
    infoCount: alerts.filter((a) => a.severity === "info").length,
    reviewConflictCount: alerts.filter((a) => a.kind === "cad_review_conflict").length,
    versionMismatchCount: alerts.filter((a) => a.kind === "version_mismatch").length,
    subsystemsAffected: subsystems.size,
  };
}
