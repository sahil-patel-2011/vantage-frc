// Scout schema-version negotiation domain types. Pure data shapes — no I/O, no framework imports.
// Reconciles scouting submissions captured on an older tablet-side form schema instead of
// silently dropping them: each known schema version's field set is registered, and submissions
// tagged with a stale schema_version are staged with a computed field diff (missing/extra).

export type SubmissionStatus = "pending" | "reconciled" | "rejected";

export type ScoutSchemaVersion = {
  id: string;
  versionTag: string;
  fieldKeys: string[];
  isActive: boolean;
  notes: string | null;
  createdAt: string;
};

export type ScoutSchemaSubmission = {
  id: string;
  deviceId: string;
  schemaVersion: string;
  matchNumber: number | null;
  teamNumber: number | null;
  rawPayload: Record<string, unknown>;
  status: SubmissionStatus;
  missingFields: string[];
  extraFields: string[];
  notes: string | null;
  submittedAt: string;
  reconciledAt: string | null;
};

export type ScoutSchemaNegotiateSummary = {
  totalSubmissions: number;
  pending: number;
  reconciled: number;
  rejected: number;
  activeVersionTag: string | null;
  knownVersionCount: number;
  staleDeviceCount: number;
  fieldDriftRate: number;
};
