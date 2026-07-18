// Cross-domain awareness domain types. Pure data shapes — no I/O, no framework imports.
// Flags when a CAD/subsystem change lands on a subsystem with an open design review, and
// firmware/software-version mismatches (installed vs. target).

export type SubsystemEventDomain = "cad" | "firmware" | "software" | "mechanical" | "electrical" | "other";
export type SubsystemEventSource = "manual" | "cad_job";

export type SubsystemEvent = {
  id: string;
  subsystem: string;
  domain: SubsystemEventDomain;
  title: string;
  description: string | null;
  source: SubsystemEventSource;
  sourceRef: string | null;
  occurredAt: string;
  seasonYear: number;
};

export type OpenDesignReview = {
  id: string;
  title: string;
  subsystem: string;
  stage: string;
  status: string;
  scheduledOn: string | null;
};

export type VersionComponent = {
  id: string;
  component: string;
  category: string;
  installedVersion: string;
  targetVersion: string | null;
};

export type CrossDomainAlertSeverity = "info" | "warning" | "critical";

export type CrossDomainAlertKind = "cad_review_conflict" | "version_mismatch";

export type CrossDomainAlert = {
  /** Stable key across recomputes — used to persist acknowledgements. */
  key: string;
  kind: CrossDomainAlertKind;
  severity: CrossDomainAlertSeverity;
  subsystem: string;
  title: string;
  detail: string;
  relatedEventId: string | null;
  relatedReviewId: string | null;
  relatedVersionId: string | null;
  occurredAt: string;
};

export type CrossDomainAlertSummary = {
  totalAlerts: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  reviewConflictCount: number;
  versionMismatchCount: number;
  subsystemsAffected: number;
};
