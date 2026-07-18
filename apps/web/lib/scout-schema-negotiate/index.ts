// Pure aggregation/diff helpers for scout schema-version negotiation. Deterministic given
// their input — no I/O, no clock, no framework imports.

export * from "./types";
import type {
  ScoutSchemaNegotiateSummary,
  ScoutSchemaSubmission,
  ScoutSchemaVersion,
  SubmissionStatus,
} from "./types";

export const SUBMISSION_STATUSES: SubmissionStatus[] = ["pending", "reconciled", "rejected"];

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Compare a submission's payload field keys against the active schema's registered field
 * keys. `missing` = fields the active schema expects but the submission doesn't have
 * (likely captured on an older schema). `extra` = fields present in the submission that the
 * active schema no longer defines.
 */
export function diffSchemaFields(
  activeFieldKeys: string[],
  submissionFieldKeys: string[],
): { missing: string[]; extra: string[] } {
  const activeSet = new Set(activeFieldKeys);
  const submittedSet = new Set(submissionFieldKeys);
  const missing = activeFieldKeys.filter((key) => !submittedSet.has(key));
  const extra = submissionFieldKeys.filter((key) => !activeSet.has(key));
  return { missing, extra };
}

export function submissionStatusLabel(status: SubmissionStatus): string {
  const labels: Record<SubmissionStatus, string> = {
    pending: "Needs reconciliation",
    reconciled: "Reconciled",
    rejected: "Rejected",
  };
  return labels[status];
}

/**
 * Roll up staged submissions + registered versions into summary counters, including a
 * field-drift rate (share of pending submissions whose payload doesn't match the active
 * schema's field set exactly).
 */
export function summarizeScoutSchemaNegotiate(
  submissions: ScoutSchemaSubmission[],
  versions: ScoutSchemaVersion[],
): ScoutSchemaNegotiateSummary {
  const active = versions.find((v) => v.isActive) ?? null;
  const pendingSubmissions = submissions.filter((s) => s.status === "pending");
  const driftCount = pendingSubmissions.filter(
    (s) => s.missingFields.length > 0 || s.extraFields.length > 0,
  ).length;
  const staleDeviceCount = new Set(
    pendingSubmissions
      .filter((s) => s.missingFields.length > 0 || s.extraFields.length > 0)
      .map((s) => s.deviceId),
  ).size;

  return {
    totalSubmissions: submissions.length,
    pending: pendingSubmissions.length,
    reconciled: submissions.filter((s) => s.status === "reconciled").length,
    rejected: submissions.filter((s) => s.status === "rejected").length,
    activeVersionTag: active?.versionTag ?? null,
    knownVersionCount: versions.length,
    staleDeviceCount,
    fieldDriftRate:
      pendingSubmissions.length > 0 ? round3(driftCount / pendingSubmissions.length) : 0,
  };
}
